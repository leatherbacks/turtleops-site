import { parseWCDate } from './dates';

/**
 * A recovered Wildlife Computers tag's archive: every sample it logged, at
 * its archive rate (3 s on the animal for a MiniPAT, slower after release).
 *
 * Columns: Time, Depth, Temperature, Light Level, and on newer tags Ax/Ay/Az,
 * Dry and Events. Time comes as Wildlife Computers' "HH:MM:SS DD-Mon-YYYY",
 * or, once the file has been through Excel, as a serial day number — NOAA's
 * MiniPAT 40996 archive arrived as an .xlsx with the times as serials.
 *
 * Rows without a depth are event rows ("Data sampling started" and the like)
 * and are skipped.
 */

export interface WCArchiveSample {
  date: Date;
  depth: number | null;
  temperature: number | null;
  light: number | null;
  /** 1 = the wet/dry sensor read dry. */
  dry: number | null;
}

/** Excel's day zero, 30 Dec 1899, in UTC ms. */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);

export function parseArchiveTime(raw: string): Date | null {
  const s = (raw ?? '').trim();
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    // Rounded to the second: serials carry float noise.
    const ms = EXCEL_EPOCH_MS + parseFloat(s) * 86_400_000;
    return new Date(Math.round(ms / 1000) * 1000);
  }
  return parseWCDate(s);
}

const num = (v: string | undefined) => {
  if (v === undefined || v.trim() === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

export function parseWCArchive(rows: Record<string, string>[]): WCArchiveSample[] {
  const out: WCArchiveSample[] = [];
  for (const r of rows) {
    const date = parseArchiveTime(r['Time']);
    if (!date) continue;
    const depth = num(r['Depth']);
    const temperature = num(r['Temperature']);
    if (depth === null && temperature === null) continue;
    out.push({ date, depth, temperature, light: num(r['Light Level']), dry: num(r['Dry']) });
  }
  out.sort((a, b) => a.date.getTime() - b.date.getTime());
  return out;
}
