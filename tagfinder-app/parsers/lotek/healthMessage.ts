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
 *   2-4   u24 seconds counter              exact against record timestamps
 *   5     sub-second, units of 1/256 s     bytes[2:6] as u32 at 256 Hz
 *   6     status flags, 0x80 = wet         31/31 vs ReleaseCause
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
 * unidentified byte was range-checked for a value near 3.5 V at any plausible
 * scaling and none matches, so a quoted battery figure does not originate here.
 * The corrosion voltages are latched from the release event and never change.
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
    // 0.01 s, so byte 5 is the fractional second rather than a separate field.
    tagSeconds: (u24(payload, 2) * 256 + payload[5]) / 256,
    statusByte: status,
    // Lotek renders 0x80 as "Wet Schedule". Whether that is a live conductivity
    // reading or a latched release-cause enum is unresolved: it has never once
    // differed on a coherently-decoding message, so it cannot currently
    // distinguish "wet now" from "always says wet". Exposed rather than
    // interpreted.
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

