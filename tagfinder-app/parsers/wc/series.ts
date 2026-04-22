import type { SeriesReading } from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse a Wildlife Computers Series.csv into SeriesReading[].
 * Series.csv has separate Day and Time columns, unlike most WC files.
 * Per WC spec: "Day" (e.g., "31-Oct-2025") and "Time" (e.g., "08:00:00")
 */
export function parseSeries(rows: Record<string, string>[]): SeriesReading[] {
  const readings: SeriesReading[] = [];

  for (const row of rows) {
    const day = (row['Day'] || '').trim();
    const time = (row['Time'] || '').trim();
    if (!day || !time) continue;

    // Combine into WC date format "HH:MM:SS DD-Mon-YYYY"
    const dateStr = `${time} ${day}`;
    const date = parseWCDate(dateStr);
    if (!date) continue;

    const depthStr = row['Depth'] || '';
    const tempStr = row['Temperature'] || '';
    const depthRangeStr = row['DRange'] || '';
    const tempRangeStr = row['TRange'] || '';

    const depth = depthStr ? parseFloat(depthStr) : null;
    const temperature = tempStr ? parseFloat(tempStr) : null;
    const depthRange = depthRangeStr ? parseFloat(depthRangeStr) : null;
    const temperatureRange = tempRangeStr ? parseFloat(tempRangeStr) : null;

    readings.push({
      date,
      depth: depth !== null && !isNaN(depth) ? depth : null,
      depthRange: depthRange !== null && !isNaN(depthRange) ? depthRange : null,
      temperature: temperature !== null && !isNaN(temperature) ? temperature : null,
      temperatureRange:
        temperatureRange !== null && !isNaN(temperatureRange) ? temperatureRange : null,
    });
  }

  return readings.sort((a, b) => a.date.getTime() - b.date.getTime());
}
