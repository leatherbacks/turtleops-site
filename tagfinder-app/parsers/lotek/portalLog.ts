import type {
  DailyDiveSummary,
  SSTReading,
  SeriesReading,
  LotekDayRecord,
  LotekHealthRecord,
} from '@/lib/types';
import { parseTimestamp } from '@/lib/timestamp';
import type { XlsxSheet } from '@/parsers/xlsx';
import type { LotekDailyPosition } from './dayLog';
import { isPlausibleHealthRecord, type LotekHealthResult } from './healthMessage';

/**
 * Lotek's portal export: one workbook, "Day, Dive, and Health Log_ID NNNNN_
 * YYYY-MM-DD.xlsx", with a sheet per decoded log.
 *
 * This is the third shape Lotek data arrives in, after the per-file CSVs
 * (dayLog.ts, diveLog.ts) and the recovered-tag offload (offload.ts). It
 * carries the same numbers as the CSVs but shares no headers with them —
 * `Date` for `TimeS`, `MaxDepth` for `MaxPress`, `LatN` for `TFLatN` — and the
 * workbook is built by hand in Excel from a comma-joined text export, so each
 * record sits in ONE cell as a comma-separated line, under a title row and a
 * header row that are also single cells. Lines are re-split here.
 *
 * Two things the CSVs never had, both used:
 *
 *  - A CRC status per message block. The Day Log and Health Log records are
 *    each relayed in two Argos message blocks with a CRC apiece, rendered as
 *    two status columns; a block that failed is printed anyway, with whatever
 *    bytes arrived. Each field is trusted only when its own block passed.
 *    Which fields belong to which block was settled from duplicate receptions
 *    of the same day: copies whose second status failed disagree on MinDepth
 *    and the error radii and agree on everything before `crcStatus1`.
 *
 *  - A reception time per row. The same record arrives via several satellite
 *    passes and appears once per reception, so records are deduplicated on
 *    the tag's own timestamp, keeping the first copy whose block passed.
 *
 * Depth is left in the same units the CSV parsers use, so a tag uploaded either
 * way reads the same. Timestamps are unambiguous ISO, so the CSV parsers'
 * day/month-order resolution does not apply.
 */

export interface LotekPortalDayLog {
  dailyDives: DailyDiveSummary[];
  sst: SSTReading[];
  positions: LotekDailyPosition[];
  /** Same days in the shape the archive display uses. */
  dayRecords: LotekDayRecord[];
  /** Rows whose first block passed CRC, after deduplication. */
  records: number;
  /** Rows dropped because neither block passed, or the date was unreadable. */
  rejected: number;
}

export interface LotekPortalDiveLog {
  readings: SeriesReading[];
  records: number;
  rejected: number;
  duplicatesDropped: number;
}

export interface LotekPortalLogResult {
  dayLog: LotekPortalDayLog | null;
  diveLog: LotekPortalDiveLog | null;
  healthLog: LotekHealthResult | null;
  /** Sheet names that were recognised, for the file list. */
  sheets: string[];
}

const DAY_FIELDS = ['Date', 'LatN', 'LonN', 'crcStatus1', 'MinDepth', 'MaxDepth', 'crcStatus2'];
const DIVE_FIELDS = ['Date/Time', 'Temperature', 'Depth', 'crcStatus'];
const HEALTH_FIELDS = ['Date/Time', 'ReleaseCause', 'SerialNo', 'CorrosionTime', 'crcStatus1', 'Light'];

/** Readings closer together than this are the same sample — see diveLog.ts. */
const MIN_SAMPLE_GAP_MS = 30_000;

/**
 * Per-field no-data sentinels, as printed. The Day Log uses 100 for a missing
 * latitude, -179.x for a missing longitude, -20 for a missing SST and 1000000
 * for an unbounded error, exactly as the CSV export does.
 */
const NO_LAT = 100;
const NO_LON_MAX = -179;
const NO_SST = -20;
const NO_ERR = 1_000_000;

// ─── Line handling ───

/** One record per row, whether it arrived as one cell or was split by Excel. */
function rowLine(row: string[]): string {
  const filled = row.filter((c) => c.trim() !== '');
  if (filled.length <= 1) return (filled[0] ?? '').trim();
  return row.join(',').trim();
}

function splitLine(line: string): string[] {
  return line.split(',').map((s) => s.trim());
}

function hasAll(fields: string[], required: string[]): boolean {
  const set = new Set(fields.map((f) => f.toLowerCase()));
  return required.every((r) => set.has(r.toLowerCase()));
}

/** Header row index and field names, or null if this sheet is not that log. */
function findHeader(sheet: XlsxSheet, required: string[]): { index: number; fields: string[] } | null {
  const limit = Math.min(sheet.rows.length, 10);
  for (let i = 0; i < limit; i++) {
    const fields = splitLine(rowLine(sheet.rows[i]));
    if (hasAll(fields, required)) return { index: i, fields };
  }
  return null;
}

function records(sheet: XlsxSheet, header: { index: number; fields: string[] }): Record<string, string>[] {
  const out: Record<string, string>[] = [];
  for (let i = header.index + 1; i < sheet.rows.length; i++) {
    const line = rowLine(sheet.rows[i]);
    if (!line) continue;
    const vals = splitLine(line);
    const rec: Record<string, string> = {};
    header.fields.forEach((f, j) => (rec[f] = vals[j] ?? ''));
    out.push(rec);
  }
  return out;
}

const ok = (s: string | undefined) => (s ?? '').trim().toUpperCase() === 'OK';

function num(s: string | undefined): number | null {
  const v = parseFloat((s ?? '').trim());
  return Number.isFinite(v) ? v : null;
}

/** "10:40:00" -> 640; anything outside a day (Lotek prints 68:15:00 for none) -> null. */
function minutesOfDay(s: string | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec((s ?? '').trim());
  if (!m) return null;
  const mins = parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return mins >= 0 && mins < 1440 ? mins : null;
}

function dayDate(s: string | undefined): Date | null {
  const t = (s ?? '').trim();
  if (!/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) return null;
  const d = parseTimestamp(`${t} 00:00`);
  return isNaN(d.getTime()) ? null : d;
}

// ─── Day Log ───

function parseDayLog(sheet: XlsxSheet): LotekPortalDayLog | null {
  const header = findHeader(sheet, DAY_FIELDS);
  if (!header) return null;

  // Block 1 (through crcStatus1): the date, both geolocation solutions, the
  // threshold estimate and the SST sample. Block 2 (through crcStatus2): the
  // depth range and the error radii. Sunrise/sunset sit in block 1.
  interface Day {
    date: Date;
    block1: Record<string, string> | null;
    block2: Record<string, string> | null;
  }
  const byDate = new Map<number, Day>();
  let rejected = 0;

  for (const r of records(sheet, header)) {
    const date = dayDate(r['Date']);
    const b1 = ok(r['crcStatus1']);
    const b2 = ok(r['crcStatus2']);
    if (!date || (!b1 && !b2)) {
      rejected++;
      continue;
    }
    const key = date.getTime();
    const day = byDate.get(key) ?? { date, block1: null, block2: null };
    if (b1 && !day.block1) day.block1 = r;
    if (b2 && !day.block2) day.block2 = r;
    byDate.set(key, day);
  }

  const dailyDives: DailyDiveSummary[] = [];
  const sst: SSTReading[] = [];
  const positions: LotekDailyPosition[] = [];
  const dayRecords: LotekDayRecord[] = [];

  const lat = (s: string | undefined) => {
    const v = num(s);
    return v === null || v === NO_LAT ? null : v;
  };
  const lon = (s: string | undefined) => {
    const v = num(s);
    return v === null || v <= NO_LON_MAX ? null : v;
  };
  const err = (s: string | undefined) => {
    const v = num(s);
    return v === null || v === NO_ERR ? null : v;
  };

  for (const day of Array.from(byDate.values()).sort((a, b) => a.date.getTime() - b.date.getTime())) {
    const b1 = day.block1;
    const b2 = day.block2;

    if (b2) {
      const minDepth = num(b2['MinDepth']);
      const maxDepth = num(b2['MaxDepth']);
      if (minDepth !== null && maxDepth !== null) {
        dailyDives.push({ date: day.date, minDepth, maxDepth, minAccuracy: 0, maxAccuracy: 0 });
      }
    }

    let sstC: number | null = null;
    if (b1) {
      const temp = num(b1['SSTTemp']);
      if (temp !== null && temp !== NO_SST) {
        sstC = temp;
        const at = new Date(day.date.getTime());
        const minute = minutesOfDay(b1['SSTTime']);
        if (minute !== null) at.setUTCMinutes(minute);
        sst.push({ date: at, depth: num(b1['SSTDepth']) ?? 0, temperature: temp, source: 'lotek-sst' });
      }
    }

    positions.push({
      date: day.date,
      latNorth: b1 ? lat(b1['LatN']) : null,
      latSouth: b1 ? lat(b1['LatS']) : null,
      lonNorth: b1 ? lon(b1['LonN']) : null,
      lonSouth: b1 ? lon(b1['LonS']) : null,
      latErrNorth: b2 ? err(b2['LatErrN']) : null,
      latErrSouth: b2 ? err(b2['LatErrS']) : null,
      lonErrNorth: b2 ? err(b2['LonErrN']) : null,
      lonErrSouth: b2 ? err(b2['LonErrS']) : null,
      thresholdLat: b1 ? lat(b1['TRLat']) : null,
      thresholdLon: b1 ? num(b1['TRLon']) : null,
    });

    dayRecords.push({
      date: day.date,
      sunriseMinutesUtc: b1 ? minutesOfDay(b1['Sunrise']) : null,
      sunsetMinutesUtc: b1 ? minutesOfDay(b1['Sunset']) : null,
      latitudeNorth: b1 ? lat(b1['LatN']) : null,
      latitudeSouth: b1 ? lat(b1['LatS']) : null,
      sstC,
    });
  }

  return {
    dailyDives,
    sst,
    positions,
    dayRecords,
    records: Array.from(byDate.values()).filter((d) => d.block1).length,
    rejected,
  };
}

// ─── Dive Log ───

function parseDiveLog(sheet: XlsxSheet): LotekPortalDiveLog | null {
  const header = findHeader(sheet, DIVE_FIELDS);
  if (!header) return null;

  const byTime = new Map<number, SeriesReading>();
  let rejected = 0;
  for (const r of records(sheet, header)) {
    const date = parseTimestamp(r['Date/Time']);
    if (!ok(r['crcStatus']) || isNaN(date.getTime())) {
      rejected++;
      continue;
    }
    const key = date.getTime();
    if (byTime.has(key)) continue;
    byTime.set(key, {
      date,
      depth: num(r['Depth']),
      depthRange: null,
      temperature: num(r['Temperature']),
      temperatureRange: null,
    });
  }

  const sorted = Array.from(byTime.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const readings: SeriesReading[] = [];
  let duplicatesDropped = 0;
  for (const r of sorted) {
    const prev = readings[readings.length - 1];
    if (prev && r.date.getTime() - prev.date.getTime() < MIN_SAMPLE_GAP_MS) {
      duplicatesDropped++;
      continue;
    }
    readings.push(r);
  }
  return { readings, records: readings.length, rejected, duplicatesDropped };
}

// ─── Health Log ───

/**
 * The status byte behind Lotek's ReleaseCause string — see healthMessage.ts,
 * where the three programmed release conditions were matched to 0x80 / 0x81 /
 * 0x82. The portal prints the rendered string, not the byte, so it is mapped
 * back; an unrecognised string keeps its own text and a zero byte.
 */
function statusByteFor(cause: string): number {
  const c = cause.toLowerCase();
  if (c.includes('schedule')) return 0x80;
  if (c.includes('pressure')) return 0x81;
  if (c.includes('inactiv') || c.includes('constant')) return 0x82;
  return 0;
}

function parseHealthLog(sheet: XlsxSheet): LotekHealthResult | null {
  const header = findHeader(sheet, HEALTH_FIELDS);
  if (!header) return null;

  // The second status column is simply named crcStatus; it covers the block
  // that carries the voltages, temperature, light and the latched position.
  const byTagTime = new Map<string, LotekHealthRecord>();
  let corrupt = 0;
  let undated = 0;

  for (const r of records(sheet, header)) {
    if (!ok(r['crcStatus1']) || !ok(r['crcStatus'])) {
      corrupt++;
      continue;
    }
    const tagTime = (r['Date/Time'] ?? '').trim();
    const received = parseTimestamp(r['Rx Date/Time']);
    const date = isNaN(received.getTime()) ? parseTimestamp(tagTime) : received;
    if (isNaN(date.getTime())) {
      undated++;
      continue;
    }
    const cause = (r['ReleaseCause'] ?? '').trim();
    const status = statusByteFor(cause);
    const rec: LotekHealthRecord = {
      date,
      // The portal export does not carry the raw payload, so the format byte,
      // tag clock and message counter — all read straight from bytes in
      // healthMessage.ts — are not available here. Zero, not guessed.
      formatByte: 0,
      tagSeconds: 0,
      statusByte: status,
      wetFlag: (status & 0x80) !== 0,
      releaseCause: cause || undefined,
      serial: num(r['SerialNo']) ?? 0,
      depthM: num(r['Depth']) ?? 0,
      messageCounter: 0,
      corrosionTimeS: num(r['CorrosionTime']) ?? 0,
      corrosionStartV: num(r['CorrosionStartV']) ?? 0,
      corrosionEndV: num(r['CorrosionEndV']) ?? 0,
      temperatureC: num(r['Temperature']) ?? NaN,
      light: num(r['Light']) ?? 0,
    };
    if (!isPlausibleHealthRecord(rec)) {
      corrupt++;
      continue;
    }
    if (!byTagTime.has(tagTime)) byTagTime.set(tagTime, rec);
  }

  const out = Array.from(byTagTime.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const statusValues = Array.from(new Set(out.map((r) => r.statusByte))).sort((a, b) => a - b);
  return {
    records: out,
    corrupt,
    inconsistent: 0,
    undated,
    statusChanged: statusValues.length > 1,
    statusValues,
  };
}

// ─── Workbook ───

/**
 * Parse a Lotek portal workbook. Returns null when no sheet carries one of the
 * three logs — i.e. this is some other spreadsheet.
 */
export function parseLotekPortalWorkbook(sheets: XlsxSheet[]): LotekPortalLogResult | null {
  let dayLog: LotekPortalDayLog | null = null;
  let diveLog: LotekPortalDiveLog | null = null;
  let healthLog: LotekHealthResult | null = null;
  const found: string[] = [];

  for (const sheet of sheets) {
    // Health before Dive: both have Date/Time, Temperature and Depth, and only
    // the health header carries ReleaseCause.
    if (!healthLog) {
      const h = parseHealthLog(sheet);
      if (h) { healthLog = h; found.push(sheet.name); continue; }
    }
    if (!diveLog) {
      const d = parseDiveLog(sheet);
      if (d) { diveLog = d; found.push(sheet.name); continue; }
    }
    if (!dayLog) {
      const d = parseDayLog(sheet);
      if (d) { dayLog = d; found.push(sheet.name); continue; }
    }
  }

  if (!dayLog && !diveLog && !healthLog) return null;
  return { dayLog, diveLog, healthLog, sheets: found };
}
