import type { SeriesReading } from '@/lib/types';
import { resolveDateOrder, parseLotekDate, type DateOrder } from './dates';

/**
 * Lotek PSAT "Dive Log" — the depth/temperature time series.
 *
 * Columns: TimeS, ExtTemp, Pressure
 *
 * Pressure is depth in metres. Lotek specifies the PSAT depth sensor as
 * 500 / 1000 / 2000 m full scale at 0.05% resolution, which gives 1 m steps on
 * the 2000 m unit — matching the integer values seen in the the reference deployment export.
 * Accuracy is +/-1% of full scale, so absolute depths from a 2000 m sensor
 * carry roughly +/-20 m; treat individual readings accordingly.
 *
 * Sampling is nominally every 5 minutes, with gaps wherever archive blocks
 * have not been transmitted yet. Note this is the *transmitted* series, which
 * is a decimated subset of the tag's onboard archive.
 */

export interface LotekDiveLogResult {
  readings: SeriesReading[];
  /** Null when the date order could not be established — nothing is parsed. */
  dateOrder: DateOrder | null;
  /** Explanation of the date-order decision, for display. */
  dateNote: string;
  /** Rows dropped because they carried duplicate or near-duplicate timestamps. */
  duplicatesDropped: number;
}

/**
 * Readings closer together than this are treated as the same sample. The the reference deployment
 * export contains pairs 3 seconds apart against a 5-minute nominal interval;
 * left in, they produce vertical speeds of 5 m/s that are an artefact of the
 * export rather than the animal.
 */
const MIN_SAMPLE_GAP_MS = 30_000;

export function parseLotekDiveLog(rows: Record<string, string>[]): LotekDiveLogResult {
  const { order, reason } = resolveDateOrder(rows.map((r) => r['TimeS'] || ''));
  if (!order) {
    return { readings: [], dateOrder: null, dateNote: reason, duplicatesDropped: 0 };
  }

  const parsed: SeriesReading[] = [];
  for (const row of rows) {
    const date = parseLotekDate(row['TimeS'] || '', order);
    if (!date) continue;

    const temp = parseFloat(row['ExtTemp'] ?? '');
    const depth = parseFloat(row['Pressure'] ?? '');

    parsed.push({
      date,
      depth: Number.isFinite(depth) ? depth : null,
      depthRange: null, // Lotek does not report per-sample depth uncertainty
      temperature: Number.isFinite(temp) ? temp : null,
      temperatureRange: null,
    });
  }

  parsed.sort((a, b) => a.date.getTime() - b.date.getTime());

  const readings: SeriesReading[] = [];
  let duplicatesDropped = 0;
  for (const r of parsed) {
    const prev = readings[readings.length - 1];
    if (prev && r.date.getTime() - prev.date.getTime() < MIN_SAMPLE_GAP_MS) {
      duplicatesDropped++;
      continue;
    }
    readings.push(r);
  }

  return { readings, dateOrder: order, dateNote: reason, duplicatesDropped };
}
