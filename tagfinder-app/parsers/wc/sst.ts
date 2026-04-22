import type { SSTReading } from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse a Wildlife Computers SST.csv into SSTReading[].
 * Standard WC date format in the Date column.
 */
export function parseSST(rows: Record<string, string>[]): SSTReading[] {
  const readings: SSTReading[] = [];

  for (const row of rows) {
    const date = parseWCDate(row['Date'] || '');
    if (!date) continue;

    const depth = parseFloat(row['Depth'] || '');
    const temperature = parseFloat(row['Temperature'] || '');
    if (isNaN(temperature)) continue;

    readings.push({
      date,
      depth: isNaN(depth) ? 0 : depth,
      temperature,
      source: (row['Source'] || '').trim(),
    });
  }

  return readings.sort((a, b) => a.date.getTime() - b.date.getTime());
}
