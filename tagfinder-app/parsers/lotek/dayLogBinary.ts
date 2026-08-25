/**
 * Lotek PSAT+ day log, read from a recovered tag's offloaded .bin file.
 *
 * One record per day: the tag's own light-based geolocation, sea-surface
 * temperature, and the sunrise and sunset it measured. The offloaded file holds
 * 28 days against the 22 the manufacturer could decode from the satellite
 * stream, so recovering the tag returned six days that never came over Argos.
 *
 * Record layout — 40 bytes, twenty u16 little-endian slots:
 *
 *   slot   field                        verified
 *   ----   --------------------------   --------------------------------------
 *   0      date, days since 2000-01-01  exact
 *   1      sunrise, minutes past 00:00  exact, zero error across 21 days
 *   2      sunset, minutes past 00:00   exact, zero error across 21 days
 *   3      latitude, northern solution  raw * 90/2047; 0.067 deg worst error
 *   4      latitude, southern solution  tracks slot 3
 *   5      longitude, northern solution slot identified, SCALE UNRESOLVED
 *   6      longitude, southern solution tracks slot 5
 *   11     sea-surface temperature      raw/50 - 20, exact
 *
 * Light-based geolocation produces two candidate latitudes, north and south of
 * the equator, because day length alone cannot distinguish them. Both are
 * carried here rather than resolved — picking one is the caller's problem and
 * needs outside information.
 *
 * SENTINELS. Three fields have them and all three are returned as null rather
 * than as numbers, because a sentinel that reaches a chart is a lie with a
 * plausible shape:
 *
 *   latitude       2047 (0x7FF, top of an 11-bit field). The manufacturer
 *                  renders these days as 100.00 degrees.
 *   sunrise/sunset 0xFFFF, and 0 on the first day before any twilight was seen.
 *   SST            raw 0, which would otherwise decode to a tidy -20.00 C —
 *                  inside the plausible range for a sea temperature sensor and
 *                  therefore invisible to a physical screen.
 *
 * LONGITUDE IS NOT DECODED. Its slot is certain — it tracks the manufacturer's
 * values monotonically — but no linear scaling reproduces them: the field moves
 * about 3.6 counts per degree, which is coarser than the 0.1 degree the
 * manufacturer reports, so their value is not a simple transform of this slot
 * alone. Reporting a fitted approximation would put a tag tens of kilometres
 * from where the tag itself said it was, so nothing is returned.
 *
 * The temperature scale is the same raw/50 - 20 used by the health message and
 * the activity log, which is a useful consistency check when identifying fields
 * in an unfamiliar Lotek record.
 */

import type { LotekDayRecord } from '@/lib/types';

const RECORD_LEN = 40;
const SLOTS = RECORD_LEN / 2;

/** Days from the Unix epoch back to the log's own 2000-01-01 reference. */
const DAY_EPOCH_MS = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;

/** Full scale of the 11-bit latitude field; also its no-fix sentinel. */
const LATITUDE_FULL_SCALE = 2047;
const LATITUDE_DEGREES = 90;

/** Plausible span of the date field, to find the record stream. */
const MIN_DAY = 7000; // 2019
const MAX_DAY = 20000; // 2054

/** Written when the tag has no value for the field. */
const NO_VALUE_U16 = 0xffff;

const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);

function latitude(raw: number): number | null {
  if (raw >= LATITUDE_FULL_SCALE) return null;
  return Number(((raw * LATITUDE_DEGREES) / LATITUDE_FULL_SCALE).toFixed(3));
}

export interface LotekDayLogResult {
  records: LotekDayRecord[];
  reason: string | null;
}

/**
 * Find the record stream.
 *
 * The header is variable-length, so the offset is discovered rather than
 * assumed: the first position from which consecutive 40-byte records all carry
 * a plausible date, each one day after the last.
 */
function findRecordStart(data: Uint8Array): number {
  for (let i = 0; i + RECORD_LEN * 3 <= data.length; i++) {
    const a = u16le(data, i);
    if (a < MIN_DAY || a > MAX_DAY) continue;
    const b = u16le(data, i + RECORD_LEN);
    const c = u16le(data, i + RECORD_LEN * 2);
    if (b === a + 1 && c === a + 2) return i;
  }
  return -1;
}

export function parseLotekDayLog(data: Uint8Array): LotekDayLogResult {
  const start = findRecordStart(data);
  if (start < 0) {
    return {
      records: [],
      reason:
        'No day-log records found. Expected 40-byte records opening with a day counter that advances by one — this may be an Activity Log or Basic Log file, whose layouts differ.',
    };
  }

  const records: LotekDayRecord[] = [];
  for (let p = start; p + RECORD_LEN <= data.length; p += RECORD_LEN) {
    const slot: number[] = [];
    for (let i = 0; i < SLOTS; i++) slot.push(u16le(data, p + 2 * i));
    const day = slot[0];
    if (day < MIN_DAY || day > MAX_DAY) break;

    const minutes = (raw: number) =>
      raw === NO_VALUE_U16 || raw === 0 ? null : raw;

    records.push({
      date: new Date(DAY_EPOCH_MS + day * DAY_MS),
      sunriseMinutesUtc: minutes(slot[1]),
      sunsetMinutesUtc: minutes(slot[2]),
      latitudeNorth: latitude(slot[3]),
      latitudeSouth: latitude(slot[4]),
      sstC: slot[11] === 0 ? null : Number((slot[11] / 50 - 20).toFixed(2)),
    });
  }

  return { records, reason: null };
}
