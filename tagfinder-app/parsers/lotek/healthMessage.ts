import type { LotekHealthRecord } from '@/lib/types';
import { parseTimestamp } from '@/lib/timestamp';

/**
 * Lotek PSAT+ activity-health message, decoded from the raw Argos payload.
 *
 * Reverse-engineered by pairing the `Raw data` column of a CLS per-message
 * export against Lotek's own decoded health log, matched on reception time. All
 * 31 records in that log paired at zero seconds offset, and this layout
 * reproduces Lotek's decoder exactly on every one — including reproducing its
 * *garbage* on the 20 corrupted records (a wrong serial, 652.62 V, a date in
 * 2127). Agreeing on the corrupt records is what makes this a field-layout
 * match rather than a curve fit.
 *
 * Worth having because it is the only post-release sensor data that exists for
 * these tags. The Day Log and Dive Log stop when the archive schedule ends —
 * on the reference deployment, nine days before the tag even released — so
 * temperature, light and depth after pop-off arrive only in these messages.
 * Decoding them here means a user needs the CLS export they already have,
 * rather than waiting for a manufacturer to email a spreadsheet.
 *
 *   byte  field                            verified
 *   ----  -------------------------------  ------------------------------
 *   0     message type, always ED           all three tags
 *   1     format/config version             constant per tag, varies between
 *   2-5   u32 counter at 256 Hz            exact against record timestamps,
 *                                          WRAPS every 194.181 days
 *   6     latched release cause            31/31 vs ReleaseCause
 *   7-8   u16 serial number                31/31 exact
 *   9-10  u16 depth, metres                11/11 exact
 *   11-12 u16 message counter              monotonic with time
 *   13-14 u16 corrosion time, seconds      31/31 exact
 *   15    unidentified
 *   16-17 u16 / 100 -> corrosion start V   31/31 exact
 *   18-19 u16 / 100 -> corrosion end V     31/31 exact
 *   20-21 u16 / 50 - 20 -> degrees C       11/11 exact
 *   22-23 u16 light, raw counts            11/11 exact
 *   24-29 latched lat/lon quartet          constant, quantised to 0.1 deg
 *   30    probable CRC                     unidentified
 *
 * NOT present anywhere in this message: a live battery voltage. Every
 * unidentified byte was range-checked for a value near the 3.6 V nominal at any
 * plausible scaling and none matches, so a quoted battery figure does not
 * originate here. The corrosion voltages are latched from the release event and
 * never change.
 *
 * The tag does sample battery — every 60 s, per the manufacturer's manual —
 * but into the onboard Basic Log, which is never transmitted. It comes back only
 * with the physical tag. So on a RECOVERED tag the battery history exists and is
 * worth downloading; on a tag still at sea it does not exist at any price, and a
 * battery figure in a report about one is invented.
 */

/**
 * Byte 0 identifies an activity-health message. Byte 1 does NOT — it is constant
 * within a deployment but differs between them (0x32 on one tag, 0x31 on two
 * others), so it is a format or configuration version rather than part of the
 * type marker. Requiring a fixed pair here rejected two entire tags outright.
 * It is treated as one more latched field instead, which both admits those tags
 * and strengthens the corruption screen.
 */
const HEALTH_TYPE_BYTE = 0xed;
const PAYLOAD_LEN = 31;

/**
 * The tag clock is 32 bits at 256 Hz, so it rolls over every 194.181 days and
 * tagSeconds is elapsed time MODULO that.
 *
 * This cost a wrong diagnosis and nearly a wrong warranty claim. A tag still
 * transmitting 200 days after activation reported a clock of 6.5 days. Working
 * back from that gave an apparent activation date months after the tag's own
 * archive proved it was already running, which reads exactly like a device that
 * rebooted — and two sibling tags on the same programme showed nothing similar,
 * which looked like corroboration. It was not: those two stopped transmitting a
 * few days before their own counters would have wrapped, so only the surviving
 * tag ever crossed it. Adding one wrap put all three activations within four
 * minutes of each other.
 *
 * Never derive an activation or release time from a single tagSeconds value.
 * Use estimateClockEpoch, which is explicit about the ambiguity.
 */
export const TAG_CLOCK_WRAP_S = 4_294_967_296 / 256;

/**
 * Lead on the undecoded traffic, recorded rather than acted on.
 *
 * Type 0xA0 is the overwhelming majority of what these tags send — over 80% of
 * payloads on every deployment seen — and is not decoded here. The
 * manufacturer's manual names three logs, and only two of them are transmitted:
 * the Activity Log (time-series pressure and temperature, or pressure,
 * temperature and light) and the Day Log (processed geolocation). The Basic Log
 * stays onboard and comes back only with the physical tag.
 *
 * The manual's configurator shows the Activity Log packing "Dive (8 recs/msg)",
 * which would put eight pressure/temperature pairs in a 31-byte payload — about
 * three bytes a record after a header, which is the right order of magnitude.
 * That makes 0xA0 most likely the Activity Log in Dive form. Not decoded on that
 * basis: a plausible field count is not a layout, and the way to settle it is
 * the way the health message was settled — pair raw payloads against the
 * manufacturer's own decode of the same deployment and require agreement on the
 * corrupt records as well as the clean ones.
 */

/** Physical screens, since the raw feed carries no CRC column of its own. */
const MAX_PLAUSIBLE_VOLTS = 10;
const MIN_PLAUSIBLE_TEMP_C = -5;
const MAX_PLAUSIBLE_TEMP_C = 45;
const MAX_PLAUSIBLE_DEPTH_M = 2000;

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u24 = (b: Uint8Array, i: number) => (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

/** Decode one payload, or null if it is not a health message. */
export function decodeHealthMessage(
  payload: Uint8Array,
  receivedAt: Date
): LotekHealthRecord | null {
  if (payload.length !== PAYLOAD_LEN) return null;
  if (payload[0] !== HEALTH_TYPE_BYTE) return null;

  const status = payload[6];
  return {
    date: receivedAt,
    /** Format/config version — constant per deployment, varies between them. */
    formatByte: payload[1],
    // bytes[2:6] as fixed-point at 256 Hz reproduces the record timestamps to
    // 0.01 s. It is a 32-bit field, so it is elapsed time MODULO 194.181 days —
    // see TAG_CLOCK_WRAP_S. A single message cannot tell you how many wraps have
    // passed.
    tagSeconds: (u24(payload, 2) * 256 + payload[5]) / 256,
    statusByte: status,
    // A latched release cause, not a live conductivity reading. The
    // manufacturer's manual settles it: the PSAT+ offers exactly three
    // programmed release conditions — a scheduled number of days, a minimum
    // time above an overpressure threshold, and no change in pressure over
    // several days ("inactivity"). Three conditions, and exactly three values
    // observed across deployments, each constant within its own deployment and
    // matching the ReleaseCause string in the manufacturer's own decode:
    //
    //   0x80  scheduled elapsed time
    //   0x81  overpressure
    //   0x82  inactivity / constant depth
    //
    // The manual is explicit that the inactivity trigger is ambiguous by
    // design: it fires either because the tag was shed and is floating, or
    // because the animal died and the tag sank to the bottom and stopped
    // moving. A tag reporting 0x82 has not told you which.
    //
    // wetFlag is kept because the high bit is what Lotek renders as "Wet", but
    // it says nothing about whether the tag is wet NOW.
    wetFlag: (status & 0x80) !== 0,
    serial: u16(payload, 7),
    depthM: u16(payload, 9),
    messageCounter: u16(payload, 11),
    corrosionTimeS: u16(payload, 13),
    corrosionStartV: u16(payload, 16) / 100,
    corrosionEndV: u16(payload, 18) / 100,
    temperatureC: u16(payload, 20) / 50 - 20,
    light: u16(payload, 22),
  };
}

/**
 * Screen on physics.
 *
 * Deliberately does NOT screen on the status byte. Filtering on it would
 * discard the one record worth watching for — the first message where the tag
 * reports something other than wet — as though it were corrupt.
 */
export function isPlausibleHealthRecord(r: LotekHealthRecord): boolean {
  return (
    r.corrosionStartV < MAX_PLAUSIBLE_VOLTS &&
    r.corrosionEndV < MAX_PLAUSIBLE_VOLTS &&
    r.temperatureC > MIN_PLAUSIBLE_TEMP_C &&
    r.temperatureC < MAX_PLAUSIBLE_TEMP_C &&
    r.depthM < MAX_PLAUSIBLE_DEPTH_M
  );
}

/** Records needed before the latched-field consistency check is worth running. */
const MIN_RECORDS_FOR_MODE = 5;

export interface LotekHealthResult {
  records: LotekHealthRecord[];
  /** Payloads that looked like health messages but failed a screen. */
  corrupt: number;
  /** Rejected specifically because their latched fields disagreed with the rest. */
  inconsistent: number;
  /** Health messages whose reception time could not be parsed — see parseTimestamp. */
  undated: number;
  /** True when the status byte ever differed — see wetFlag above. */
  statusChanged: boolean;
  statusValues: number[];
}

/**
 * Decode every health message in a CLS per-message export.
 *
 * Deduplicated on the tag's own clock: the same record is retransmitted and
 * received by several satellites, and counting it twice would imply sensor
 * readings the tag never took.
 */
export function parseLotekHealthMessages(
  rows: Record<string, string>[]
): LotekHealthResult {
  const seen = new Map<number, LotekHealthRecord>();
  let corrupt = 0;
  let undated = 0;

  for (const row of rows) {
    const raw = (row['Raw data'] ?? row['Raw Data'] ?? '').trim();
    if (!raw) continue;
    const bytes = hexToBytes(raw);
    if (!bytes) continue;

    const receivedAt = parseTimestamp(row['Message date (UTC)']);
    const rec = decodeHealthMessage(bytes, receivedAt);
    if (!rec) continue;

    // A record with no usable time is worse than no record: it sorts to the
    // epoch and drags the reported start of the series with it, so a caller
    // asking "when did sensing stop" gets an answer off by decades. Counted
    // rather than silently dropped — a run of these means the export's date
    // column is in a shape parseTimestamp does not yet cover, which is exactly
    // the failure that hid 36% of one deployment's records.
    if (isNaN(rec.date.getTime())) {
      undated++;
      continue;
    }

    if (!isPlausibleHealthRecord(rec)) {
      corrupt++;
      continue;
    }
    if (!seen.has(rec.tagSeconds)) seen.set(rec.tagSeconds, rec);
  }

  let records = Array.from(seen.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  // Second pass: the corrosion fields are latched at the release event and never
  // change, so any record whose copy disagrees with the majority was corrupted
  // in transit. The raw feed carries no CRC column of its own — this recovers
  // most of that discrimination from the data's own redundancy, and it is what
  // separates a record the manufacturer's decoder would have marked bad from one
  // it would have accepted.
  let inconsistent = 0;
  const latchedFinal = modalLatched(records);
  if (latchedFinal) {
    const before = records.length;
    records = records.filter(
      (r) =>
        r.formatByte === latchedFinal.formatByte &&
        r.serial === latchedFinal.serial &&
        r.corrosionTimeS === latchedFinal.corrosionTimeS &&
        r.corrosionStartV === latchedFinal.corrosionStartV &&
        r.corrosionEndV === latchedFinal.corrosionEndV
    );
    inconsistent = before - records.length;
  }


  const statusValues = Array.from(
    new Set(records.map((r) => r.statusByte))
  ).sort((a, b) => a - b);

  return {
    records,
    corrupt,
    undated,
    inconsistent,
    statusChanged: statusValues.length > 1,
    statusValues,
  };
}

/**
 * The latched values, taken field by field rather than as a combination.
 *
 * A joint mode — the most common full tuple — is far stricter than intended: a
 * single bit error anywhere in the block makes the whole record a minority of
 * one, so it is discarded even though four of its five constants are intact. On
 * one deployment that threw away 54 otherwise-good records. Taking each field's
 * own mode lets a record be judged on all five independently.
 */
function modalLatched(records: LotekHealthRecord[]) {
  if (records.length < MIN_RECORDS_FOR_MODE) return null;
  const modeOf = <K extends keyof LotekHealthRecord>(field: K) => {
    const counts = new Map<LotekHealthRecord[K], number>();
    for (const r of records) counts.set(r[field], (counts.get(r[field]) ?? 0) + 1);
    let best = records[0][field];
    let bestN = 0;
    for (const [v, n] of Array.from(counts.entries())) if (n > bestN) { bestN = n; best = v; }
    return best;
  };
  return {
    formatByte: modeOf('formatByte'),
    serial: modeOf('serial'),
    corrosionTimeS: modeOf('corrosionTimeS'),
    corrosionStartV: modeOf('corrosionStartV'),
    corrosionEndV: modeOf('corrosionEndV'),
  };
}


/**
 * Recover the moment the tag's clock started, allowing for rollover.
 *
 * Returns every epoch consistent with the records — one per possible wrap count
 * — rather than a single answer, because the data genuinely does not contain
 * one. A caller with an outside constraint (a known deployment date, a sibling
 * tag from the same batch) can pick; a caller without one should say the record
 * is ambiguous rather than take the smallest.
 *
 * `wraps` is capped by the plausible life of the hardware rather than by
 * arithmetic: at roughly 194 days a wrap, four covers more than two years.
 */
export function estimateClockEpoch(
  records: LotekHealthRecord[],
  maxWraps = 4
): { wraps: number; epoch: Date; residualS: number }[] {
  const dated = records.filter((r) => !isNaN(r.date.getTime()));
  if (dated.length === 0) return [];

  const out: { wraps: number; epoch: Date; residualS: number }[] = [];
  for (let w = 0; w <= maxWraps; w++) {
    // Each record implies an epoch; a correct wrap count makes them agree.
    const implied = dated.map(
      (r) => r.date.getTime() - (r.tagSeconds + w * TAG_CLOCK_WRAP_S) * 1000
    );
    const mean = implied.reduce((a, b) => a + b, 0) / implied.length;
    const spread = Math.max(...implied) - Math.min(...implied);
    out.push({ wraps: w, epoch: new Date(mean), residualS: spread / 1000 });
  }
  return out;
}
