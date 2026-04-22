import type { ArgosPass } from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse a Wildlife Computers Argos.csv into ArgosPass[].
 */
export function parseArgos(rows: Record<string, string>[]): ArgosPass[] {
  const passes: ArgosPass[] = [];

  for (const row of rows) {
    const date = parseWCDate(row['Date'] || '');
    if (!date) continue;

    const lat = parseFloat(row['Latitude'] || '');
    const lon = parseFloat(row['Longitude'] || '');
    const lat2 = parseFloat(row['Latitude2'] || '');
    const lon2 = parseFloat(row['Longitude2'] || '');
    const freq = parseFloat(row['Frequency'] || '');

    passes.push({
      date,
      satellite: (row['Satellite'] || '').trim(),
      msgCount: parseInt(row['MsgCount'] || '0') || 0,
      duplicates: parseInt(row['Duplicates'] || '0') || 0,
      corrupt: parseInt(row['Corrupt'] || '0') || 0,
      avgInterval: parseFloat(row['AvgInterval'] || '0') || 0,
      locationQuality: (row['LocationQuality'] || '').trim(),
      latitude: isNaN(lat) ? null : lat,
      longitude: isNaN(lon) ? null : lon,
      latitude2: isNaN(lat2) ? null : lat2,
      longitude2: isNaN(lon2) ? null : lon2,
      frequencyHz: isNaN(freq) || freq === 0 ? null : freq,
    });
  }

  return passes.sort((a, b) => a.date.getTime() - b.date.getTime());
}
