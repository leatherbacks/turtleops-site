import type { LotekActivityRecord } from '@/lib/types';
import { parseTimestamp } from '@/lib/timestamp';

/**
 * Lotek PSAT+ activity-log message — type 0xA0, the dive log over Argos.
 *
 * Nine in ten payloads these tags send are this message, and until October
 * 2026 the app read only its temperatures. The full layout was settled by
 * pairing raw payloads from a CLS export against Lotek's own decode of the
 * same records in their downloader container (argosContainer.ts), matched on
 * reception time to the second, and then checked on a second deployment
 * against the manufacturer's Dive Log CSV:
 *
 *   47128  88 of 89 CRC-clean samples exact on temperature and depth
 *   47125  block 1: 1704 of 1704 exact where its CRC passes
 *          block 2: 2293 of 2410 exact (95%) — no check byte identified
 *
 *   byte   field
 *   ----   ----------------------------------------------------------------
 *   0      message type, 0xA0
 *   1-4    u32 big-endian, SECONDS SINCE 2000-01-01 UTC, time of record 0.
 *          Byte 1 was previously read as a "format byte" (0x31 on one tag,
 *          0x32 on another) and bytes 2-5 as a relative 256 Hz counter. It is
 *          the top byte of an absolute clock: 0x31000000 s after 2000 is
 *          2026-01-18 20:33:04, the "shared epoch" the earlier decode had to
 *          assume. The health message carries the same clock in the same
 *          bytes. Nothing wraps.
 *   5      unidentified (0xE4 on nearly every clean message; 0xE2, 0xEC seen)
 *   6-14   records 0-2, three bytes each:
 *            temperature = b0<<4 | b1>>4       (12 bits, raw/50 − 20 °C)
 *            depth       = b2<<4 | (b1 & 0xF)  (12 bits, same units as the
 *                                              Lotek CSV Pressure column)
 *   15     CRC-8 of bytes 0-14: polynomial 0x07, init 0xFF, no reflection
 *   16-24  records 3-5, as above
 *   25     record 6 temperature, top 8 bits only (×16)
 *   26-27  record 6 depth, 12 bits: b26<<4 | b27>>4
 *   27-29  record 7 depth, 12 bits as (lo, hi, mid) nibbles:
 *            (b28>>4)<<8 | (b28&0xF)<<4 | (b27&0xF)
 *          record 7 temperature, low 4 of 8 bits in b29&0xF (×16), with the
 *          top nibble taken from record 6 — that is what Lotek's decode does
 *          and it is the only rule that reproduces their value on every pair
 *   30     block 2 check byte — NOT identified. Tried CRC-8 over every
 *          plausible range with every polynomial, init, reflection and xor,
 *          CRC-12 with the top nibble of byte 29, sums and xors, chained from
 *          block 1. None reproduce it. Block 2 is therefore screened on
 *          plausibility only, and callers get `verified` per record.
 *
 * Records are 300 s apart: record k is at the header time plus k×300 s.
 */

const ACTIVITY_TYPE_BYTE = 0xa0;
const PAYLOAD_LEN = 31;
const RECORD_INTERVAL_S = 300;
const EPOCH_2000_MS = Date.UTC(2000, 0, 1);

const MIN_PLAUSIBLE_TEMP_C = -5;
const MAX_PLAUSIBLE_TEMP_C = 45;
/** Raw depth units; the 12-bit field tops out at 4095 anyway. */
const MAX_PLAUSIBLE_DEPTH = 4000;
/**
 * A CRC-8 passes one random payload in 256. That is nothing while payloads
 * are intact, and it is a steady trickle once a tag starts sending noise:
 * PSAT+ 47128 emitted 2,517 failing dive messages between 3 and 7 Oct 2026
 * and three of them passed by chance, carrying clocks of July 2025 and
 * October 2028. The 2028 one became the tag's only "post-release" depth
 * reading and set the tag state to "submerged, 140 m" while the tag lay on
 * a beach. A record cannot be newer than the pass that delivered it, and no
 * PSAT+ archive is older than a year plus margin; a verified clock outside
 * that window is a chance pass and the whole message goes.
 */
const MAX_ARCHIVE_AGE_DAYS = 400;
/** Slack for tag clock drift ahead of the receiver's clock. */
const CLOCK_AHEAD_SLACK_MS = 60 * 60 * 1000;

export const ACTIVITY_CRC_POLY = 0x07;
export const ACTIVITY_CRC_INIT = 0xff;

export function crc8(data: Uint8Array, poly = ACTIVITY_CRC_POLY, init = ACTIVITY_CRC_INIT): number {
  let c = init;
  for (const x of Array.from(data)) {
    c ^= x;
    for (let i = 0; i < 8; i++) c = c & 0x80 ? ((c << 1) ^ poly) & 0xff : (c << 1) & 0xff;
  }
  return c;
}

function hexToBytes(hex: string): Uint8Array | null {
  const clean = hex.trim().toLowerCase();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/.test(clean)) return null;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

export interface DecodedActivityMessage {
  /** Seconds since 2000-01-01 UTC of record 0. */
  baseTagSeconds: number;
  /** Byte 5, kept for the day its meaning is found. */
  flagByte: number;
  /** Byte 15 matched its CRC. */
  block1Verified: boolean;
  /** Eight records; a record is null when its values are not physical. */
  records: ({ temperatureRaw: number; depth: number } | null)[];
}

/** Decode one activity payload, or null if it is not one. */
export function decodeActivityMessage(payload: Uint8Array): DecodedActivityMessage | null {
  if (payload.length !== PAYLOAD_LEN) return null;
  if (payload[0] !== ACTIVITY_TYPE_BYTE) return null;
  const b = payload;
  const baseTagSeconds = ((b[1] << 24) >>> 0) + (b[2] << 16) + (b[3] << 8) + b[4];
  const block1Verified = crc8(b.subarray(0, 15)) === b[15];

  const raw: { temperatureRaw: number; depth: number }[] = [];
  for (const base of [6, 9, 12, 16, 19, 22]) {
    raw.push({
      temperatureRaw: (b[base] << 4) | (b[base + 1] >> 4),
      depth: (b[base + 2] << 4) | (b[base + 1] & 0x0f),
    });
  }
  const temp6 = b[25] << 4;
  raw.push({ temperatureRaw: temp6, depth: (b[26] << 4) | (b[27] >> 4) });
  raw.push({
    temperatureRaw: (temp6 & 0xf00) | ((b[29] & 0x0f) << 4),
    depth: ((b[28] >> 4) << 8) | ((b[28] & 0x0f) << 4) | (b[27] & 0x0f),
  });

  const records = raw.map((r) => {
    const t = r.temperatureRaw / 50 - 20;
    const physical = t > MIN_PLAUSIBLE_TEMP_C && t < MAX_PLAUSIBLE_TEMP_C && r.depth <= MAX_PLAUSIBLE_DEPTH;
    return physical ? r : null;
  });
  return { baseTagSeconds, flagByte: b[5], block1Verified, records };
}

export interface LotekActivityResult {
  records: LotekActivityRecord[];
  /** Payloads whose first block failed its CRC; dropped whole, timestamp and all. */
  crcFailed: number;
  /**
   * Payloads that passed the CRC with a clock later than their own reception
   * or more than MAX_ARCHIVE_AGE_DAYS before it — chance passes, dropped whole.
   */
  clockRejected: number;
  /** Records dropped because their values were not physical. */
  implausible: number;
  /**
   * Per reception day (UTC, YYYY-MM-DD): how the dive payloads fared. This is
   * the only view of the sensor stream's health a CLS export offers, and on
   * PSAT+ 47128 it is where the stream went from 57% readable to 0.4% at
   * 17:00 UTC on 3 Oct while the Doppler fixes carried on as normal.
   */
  daily: Record<string, { passed: number; failed: number; clockRejected: number }>;
}

/**
 * Decode every activity message in a CLS per-message export.
 *
 * A message whose first block fails its CRC is dropped whole: the timestamp
 * lives in that block, and a corrupt timestamp turns a pre-release archive
 * sample into a fake post-release reading, which is exactly the kind that
 * drives a tag-state verdict. Within a passing message, records 0-2 are
 * verified; records 3-7 have no check that could be identified, so they are
 * kept when physical and marked unverified — on the reference deployment 95%
 * of them match the manufacturer exactly, good enough for a profile and not
 * for a single reading. Deduplicated on the tag's own clock; a verified copy
 * beats an unverified one.
 */
export function parseLotekActivityMessages(rows: Record<string, string>[]): LotekActivityResult {
  const seen = new Map<number, LotekActivityRecord>();
  let crcFailed = 0;
  let clockRejected = 0;
  let implausible = 0;
  const daily: Record<string, { passed: number; failed: number; clockRejected: number }> = {};
  const tally = (receivedAt: Date, key: 'passed' | 'failed' | 'clockRejected') => {
    if (isNaN(receivedAt.getTime())) return;
    const day = receivedAt.toISOString().slice(0, 10);
    (daily[day] ??= { passed: 0, failed: 0, clockRejected: 0 })[key]++;
  };
  for (const row of rows) {
    const raw = (row['Raw data'] ?? row['Raw Data'] ?? '').trim();
    if (!raw) continue;
    const bytes = hexToBytes(raw);
    if (!bytes) continue;
    const decoded = decodeActivityMessage(bytes);
    if (!decoded) continue;
    const receivedAt = parseTimestamp(row['Message date (UTC)']);
    if (!decoded.block1Verified) {
      crcFailed++;
      tally(receivedAt, 'failed');
      continue;
    }
    if (!isNaN(receivedAt.getTime())) {
      const baseMs = EPOCH_2000_MS + decoded.baseTagSeconds * 1000;
      const rxMs = receivedAt.getTime();
      if (
        baseMs > rxMs + CLOCK_AHEAD_SLACK_MS ||
        baseMs < rxMs - MAX_ARCHIVE_AGE_DAYS * 24 * 60 * 60 * 1000
      ) {
        clockRejected++;
        tally(receivedAt, 'clockRejected');
        continue;
      }
    }
    tally(receivedAt, 'passed');
    decoded.records.forEach((r, k) => {
      if (r === null) {
        implausible++;
        return;
      }
      const verified = k < 3;
      const tagSeconds = decoded.baseTagSeconds + k * RECORD_INTERVAL_S;
      const existing = seen.get(tagSeconds);
      if (existing && (existing.verified || !verified)) return;
      seen.set(tagSeconds, {
        tagSeconds,
        date: new Date(EPOCH_2000_MS + tagSeconds * 1000),
        temperatureC: Number((r.temperatureRaw / 50 - 20).toFixed(2)),
        depth: r.depth,
        verified,
        receivedAt,
      });
    });
  }
  return {
    records: Array.from(seen.values()).sort((a, b) => a.tagSeconds - b.tagSeconds),
    crcFailed,
    clockRejected,
    implausible,
    daily,
  };
}
