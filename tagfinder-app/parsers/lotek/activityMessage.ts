import type { LotekActivityRecord } from '@/lib/types';
import { parseTimestamp } from '@/lib/timestamp';

/**
 * Lotek PSAT+ activity-log message — PARTIAL decode.
 *
 * Type 0xA0 is the bulk of what these tags transmit: 1165 of 1346 payloads on
 * the reference deployment, and comparable shares on the others. It is the
 * Activity Log the manufacturer's manual describes, a time series of the tag's
 * own sensors packaged into Argos messages, and until now the app skipped all of
 * it. Temperature is decoded here. Pressure is NOT — see the note at the end,
 * which records what was ruled out so the next attempt does not repeat it.
 *
 * Layout, established by pairing raw payloads against the manufacturer's decode
 * of the same deployment:
 *
 *   byte   field                              verified
 *   ----   --------------------------------   -----------------------------
 *   0      message type, always A0            all deployments
 *   1      format/config version              0x31 here against 0x32 on the
 *                                             same tag's health messages, so it
 *                                             varies by message type and is not
 *                                             one per-deployment constant
 *   2-5    u32 at 256 Hz, time of record 0    98.1% land inside the archive
 *                                             window the manufacturer decoded
 *   6-14   three 3-byte records
 *   15     unidentified — NOT part of a record
 *   16-27  four more 3-byte records
 *   28-30  unidentified
 *
 * Each 3-byte record carries temperature in its top 12 bits, on the same
 * raw/50-20 scale as the health message. The remaining 12 bits are not
 * temperature and are not pressure.
 *
 * Records are 5 minutes apart, and record k sits at the header time plus k*300 s.
 * Against the manufacturer's own decoded values, slot by slot: 95%, 92%, 88%,
 * then 43%, 40%, 38%, 44%. The decline is corruption accumulating along the
 * payload — later bytes are likelier to be wrong — not a layout change, since a
 * layout error would read as noise rather than as a clean majority.
 *
 * WHY BYTE 15 IS SKIPPED: with a uniform three-byte stride the fourth record
 * onward decodes to nothing (0-2 matches in ~600 attempts). Skipping byte 15
 * restores them. Something occupies that byte; what, is unknown.
 *
 * PRESSURE IS UNRESOLVED, and these were eliminated:
 *   - the record's low 12 bits, in either nibble order (r = 0.03 to 0.10
 *     against the decoded pressure)
 *   - every contiguous bit field of width 6-12 anywhere in the payload. Two
 *     positions correlate at r = 0.93 and 0.92, both once per record, but they
 *     reproduce the actual value only 5.7% of the time. The correlation is an
 *     artifact of pooling slots: pressure changes slowly over a dive, so any
 *     field tracking the profile's trend scores well against every slot at once.
 *     Correlation was the wrong test; exact reproduction is the right one.
 *
 * The obvious next step is a deployment where the manufacturer's decode and the
 * raw payloads disagree about pressure, or a recovered tag's onboard Basic Log,
 * which stores the same series at full rate and would give an unambiguous
 * pairing rather than one mediated by their decoder.
 *
 * CONFIDENCE, measured rather than asserted. Against the manufacturer's decode of
 * the same deployment: 6192 samples recovered against their 3225, and where both
 * hold the same sample the temperatures agree 92.0% of the time.
 *
 * That 8% matters and is why this is not treated the way the health message is.
 * The health decoder screens on five latched constants that a corrupt payload
 * almost never reproduces, so a record surviving it is trustworthy individually.
 * This message carries no such redundancy — only the format byte, and screening
 * on it moves agreement from 92.0% to 92.7% while discarding 318 records, which
 * is barely worth the loss. A corrupt payload here decodes to a plausible
 * temperature and there is nothing in the message to catch it.
 *
 * So: use these records in aggregate, for a series, a range, a diurnal cycle.
 * Do NOT hang a conclusion on any single one, and do not present a count of them
 * as "more than the manufacturer recovered" — roughly two thousand have no
 * counterpart in their decode and whether those are genuine recoveries or
 * plausible-looking corruption is not established.
 */

const ACTIVITY_TYPE_BYTE = 0xa0;
const PAYLOAD_LEN = 31;

/** Byte offsets of the seven records. Byte 15 is deliberately absent. */
const RECORD_OFFSETS = [6, 9, 12, 16, 19, 22, 25];

/** Sampling interval of the activity log on the deployments seen. */
const RECORD_INTERVAL_S = 300;

/** Same scale as the health message: raw/50 - 20. */
const MIN_PLAUSIBLE_TEMP_C = -5;
const MAX_PLAUSIBLE_TEMP_C = 45;

/**
 * The clock is the same 32-bit counter at 256 Hz the health message carries, so
 * it wraps on the same period and a value alone cannot say how many wraps have
 * passed. Callers get elapsed time and resolve it against a known epoch.
 */
const u32 = (b: Uint8Array, i: number) =>
  ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export interface LotekActivityResult {
  records: LotekActivityRecord[];
  /** Payloads of the right type that failed the temperature screen. */
  implausible: number;
}

/** Decode one activity payload, or null if it is not one. */
export function decodeActivityMessage(payload: Uint8Array): {
  formatByte: number;
  baseTagSeconds: number;
  temperaturesC: (number | null)[];
} | null {
  if (payload.length !== PAYLOAD_LEN) return null;
  if (payload[0] !== ACTIVITY_TYPE_BYTE) return null;

  const temperaturesC = RECORD_OFFSETS.map((o) => {
    const raw = (payload[o] << 4) | (payload[o + 1] >> 4);
    const t = raw / 50 - 20;
    return t > MIN_PLAUSIBLE_TEMP_C && t < MAX_PLAUSIBLE_TEMP_C ? t : null;
  });

  return {
    formatByte: payload[1],
    baseTagSeconds: u32(payload, 2) / 256,
    temperaturesC,
  };
}

/**
 * Decode every activity message in a CLS per-message export.
 *
 * Records are keyed on the tag's own clock, so a message received several times
 * contributes its samples once. Reception time is not used to date the samples —
 * the archive is replayed long after it was recorded, so a record's own clock is
 * the only thing that places it.
 */
export function parseLotekActivityMessages(
  rows: Record<string, string>[]
): LotekActivityResult {
  const seen = new Map<number, LotekActivityRecord>();
  let implausible = 0;

  for (const row of rows) {
    const raw = (row['Raw data'] ?? row['Raw Data'] ?? '').trim();
    if (!raw) continue;
    const bytes = hexToBytes(raw);
    if (!bytes) continue;
    const decoded = decodeActivityMessage(bytes);
    if (!decoded) continue;

    const receivedAt = parseTimestamp(row['Message date (UTC)']);
    decoded.temperaturesC.forEach((t, k) => {
      if (t === null) {
        implausible++;
        return;
      }
      const tagSeconds = decoded.baseTagSeconds + k * RECORD_INTERVAL_S;
      if (!seen.has(tagSeconds)) {
        seen.set(tagSeconds, {
          tagSeconds,
          temperatureC: t,
          formatByte: decoded.formatByte,
          receivedAt,
        });
      }
    });
  }

  return {
    records: Array.from(seen.values()).sort((a, b) => a.tagSeconds - b.tagSeconds),
    implausible,
  };
}
