/**
 * Lotek PSAT+ activity log, read from the tag's own offloaded .bin file.
 *
 * This is the archive as the tag stored it, not as Argos delivered it. On the
 * reference deployment the offloaded log holds 7888 records against the 3225 the
 * manufacturer could decode from the satellite stream, because the satellite
 * stream only ever contained what got through. Recovering the tag more than
 * doubled the archive.
 *
 * Layout, verified against the manufacturer's own decode of the same deployment:
 *
 *   byte    field
 *   -----   ---------------------------------------------------------------
 *   0       entry type, always A0
 *   1-3     u24 little-endian, seconds on the tag clock, time of record 0
 *   4       format/config byte, 0x31 on every entry seen
 *   5-20    eight u16 little-endian temperatures, raw/50 - 20 degrees C
 *   21-36   eight u16 little-endian pressures, dBar (1 dBar is about 1 m)
 *   37-39   constant 6A 7B DE — unidentified, invariant across all entries
 *
 * Eight records per entry at 300 s spacing, so entry timestamps advance by
 * exactly 2400 s. The eight-record grouping is what the manufacturer's
 * configurator calls "Dive (8 recs/msg)".
 *
 * AGREEMENT with the manufacturer's decode, over the 3219 records both hold:
 *   pressure     100.0% exact
 *   temperature   78.0% exact, 79.8% within 0.02 C, worst residual about 0.3 C
 *
 * Pressure is exact, so the field and its units are settled. The temperature
 * residual is small, one-sided and not a constant offset, which points at a
 * per-tag calibration: the file header carries a TagCalInfo block that is not
 * decoded here. Treat temperatures as good to a few tenths rather than exact,
 * and prefer the manufacturer's values where both exist.
 *
 * THE CLOCK IS RELATIVE, and getting this wrong cost two wrong diagnoses. The
 * seconds count from a reference shared across tags — 2026-01-18 20:33:04 on
 * this programme, matching two other tags to the second — and NOT from the
 * tag's own activation, which was 1 July. Nothing here converts to wall clock
 * on its own; callers must anchor it. See resolveEpoch.
 */

import type { LotekArchiveRecord } from '@/lib/types';

const ENTRY_TYPE = 0xa0;
const ENTRY_LEN = 40;
const RECORDS_PER_ENTRY = 8;
const RECORD_INTERVAL_S = 300;

/** Offsets within an entry. */
const TEMP_BASE = 5;
const PRESSURE_BASE = 21;

/** Physical screens — the log is flash, but a bad block still reads as numbers. */
const MIN_TEMP_C = -5;
const MAX_TEMP_C = 45;
const MAX_PRESSURE_DBAR = 2000;

const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);

/**
 * Find where the entries begin.
 *
 * The file opens with a variable-length header — a name tag, the deployment
 * parameters, the customer, log settings and calibration — so the offset is not
 * fixed and should not be hardcoded. Entries are self-identifying: the first
 * position whose byte is A0 and which repeats at a 40-byte stride is the start.
 */
function findEntryStart(data: Uint8Array): number {
  // Three markers rather than one, so a stray 0xA0 in the header cannot start
  // the stream. The bound is inclusive: a file that ends exactly on its last
  // entry is the normal case, and an exclusive test found nothing in it.
  for (let i = 0; i + ENTRY_LEN * 3 <= data.length; i++) {
    if (data[i] !== ENTRY_TYPE) continue;
    if (data[i + ENTRY_LEN] === ENTRY_TYPE && data[i + ENTRY_LEN * 2] === ENTRY_TYPE) {
      return i;
    }
  }
  return -1;
}

export interface LotekArchiveResult {
  records: LotekArchiveRecord[];
  entries: number;
  /** Readings dropped because they were not physically possible. */
  implausible: number;
  /** Set when the file carries no recognisable entry stream. */
  reason: string | null;
}

export function parseLotekActivityLog(data: Uint8Array): LotekArchiveResult {
  const start = findEntryStart(data);
  if (start < 0) {
    return {
      records: [],
      entries: 0,
      implausible: 0,
      reason:
        'No activity-log entries found. Expected a run of 40-byte entries each beginning 0xA0 — this may be a Basic Log or Day Log file, whose layouts differ.',
    };
  }

  const records: LotekArchiveRecord[] = [];
  let entries = 0;
  let implausible = 0;

  for (let p = start; p + ENTRY_LEN <= data.length; p += ENTRY_LEN) {
    if (data[p] !== ENTRY_TYPE) continue;
    entries++;
    const base = u24le(data, p + 1);
    const formatByte = data[p + 4];

    for (let k = 0; k < RECORDS_PER_ENTRY; k++) {
      const temperatureC = u16le(data, p + TEMP_BASE + 2 * k) / 50 - 20;
      const pressureDbar = u16le(data, p + PRESSURE_BASE + 2 * k);
      if (
        temperatureC <= MIN_TEMP_C ||
        temperatureC >= MAX_TEMP_C ||
        pressureDbar > MAX_PRESSURE_DBAR
      ) {
        implausible++;
        continue;
      }
      records.push({
        tagSeconds: base + k * RECORD_INTERVAL_S,
        temperatureC: Number(temperatureC.toFixed(2)),
        pressureDbar,
        formatByte,
      });
    }
  }

  records.sort((a, b) => a.tagSeconds - b.tagSeconds);
  return { records, entries, implausible, reason: null };
}

/**
 * Turn the tag's relative clock into wall time, given one known correspondence.
 *
 * Deliberately requires the caller to supply the anchor rather than guessing.
 * The obvious guess — that the clock starts at deployment — is wrong on this
 * hardware, and acting on it produced a confident diagnosis that a tag had
 * rebooted mid-deployment. The anchor has to come from outside: a manufacturer
 * decode of any single record, a deployment log, or another tag from the same
 * programme, since the reference is shared.
 */
export function resolveEpoch(knownRecordTime: Date, itsTagSeconds: number): Date {
  return new Date(knownRecordTime.getTime() - itsTagSeconds * 1000);
}

/** Wall time for a record, once an epoch is established. */
export function recordTime(record: LotekArchiveRecord, epoch: Date): Date {
  return new Date(epoch.getTime() + record.tagSeconds * 1000);
}
