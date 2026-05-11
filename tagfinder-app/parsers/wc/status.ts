import type { TagStatus } from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse a Wildlife Computers Status.csv into TagStatus[].
 */
export function parseStatus(rows: Record<string, string>[]): TagStatus[] {
  const statuses: TagStatus[] = [];

  for (const row of rows) {
    const dateStr = row['Received'] || row['Date'] || '';
    const date = parseWCDate(dateStr);
    if (!date) continue;

    const lat = parseFloat(row['Latitude'] || '');
    const lon = parseFloat(row['Longitude'] || '');

    // Temperature and Depth columns vary — try common positions
    const temp = parseFloat(row['Temperature'] || row['Temp'] || '');
    const depth = parseFloat(row['Depth'] || '');
    const wetDry = parseFloat(row['WetDry'] || '');
    const minWetDry = parseFloat(row['MinWetDry'] || '');
    const maxWetDry = parseFloat(row['MaxWetDry'] || '');

    statuses.push({
      date,
      latitude: isNaN(lat) ? null : lat,
      longitude: isNaN(lon) ? null : lon,
      temperature: isNaN(temp) ? null : temp,
      depth: isNaN(depth) ? null : depth,
      type: (row['Type'] || '').trim(),
      wetDry: isNaN(wetDry) ? null : wetDry,
      minWetDry: isNaN(minWetDry) ? null : minWetDry,
      maxWetDry: isNaN(maxWetDry) ? null : maxWetDry,
    });
  }

  return statuses.sort((a, b) => a.date.getTime() - b.date.getTime());
}
