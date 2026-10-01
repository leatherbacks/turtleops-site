import type { ArgosFix, ArgosQuality } from '@/lib/types';
import { EMPIRICAL_ERRORS, DISCARD_QUALITIES } from '@/lib/constants';
import { parseTimestamp } from '@/lib/timestamp';

/**
 * CLS positions export — one row per Doppler location.
 *
 *   Device ID, Location class, Doppler Error radius (m), Location date (UTC),
 *   Longitude, Latitude
 *
 * The lightest product the CLS/Kinéis downloader offers and the one a user is
 * most likely to pull on its own. It carries the per-fix error radius, which
 * is the whole reason to prefer CLS exports over the DS dump, and nothing
 * else: no messages, no payloads, no passes. So it ranks above the messages
 * export for the fixes themselves and contributes nothing to transmission
 * health or the Lotek health decode.
 *
 * Programme-wide like every CLS export: the file of 1 Oct 2026 held eight
 * devices. Rows are kept for the device with the most rows; the rest are
 * counted so the file list can say so.
 */

export const ARGOS_POSITIONS_REQUIRED = [
  'Location class',
  'Location date (UTC)',
  'Latitude',
  'Longitude',
];

export interface ArgosPositionsResult {
  fixes: ArgosFix[];
  ptt: number | null;
  otherDevices: number;
  droppedRows: number;
}

const col = (row: Record<string, string>, name: string) => (row[name] ?? '').trim();
const num = (s: string) => {
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

export function parseArgosPositions(allRows: Record<string, string>[]): ArgosPositionsResult {
  const counts = new Map<number, number>();
  for (const row of allRows) {
    const ptt = num(col(row, 'Device ID'));
    if (ptt !== null) counts.set(ptt, (counts.get(ptt) ?? 0) + 1);
  }
  let ptt: number | null = null;
  let bestN = -1;
  for (const [p, n] of Array.from(counts.entries())) if (n > bestN) { ptt = p; bestN = n; }
  const rows = counts.size > 1 ? allRows.filter((r) => num(col(r, 'Device ID')) === ptt) : allRows;

  const seen = new Map<string, ArgosFix>();
  for (const row of rows) {
    const date = parseTimestamp(col(row, 'Location date (UTC)'));
    const lat = num(col(row, 'Latitude'));
    const lon = num(col(row, 'Longitude'));
    const quality = col(row, 'Location class').toUpperCase() as ArgosQuality;
    if (isNaN(date.getTime()) || lat === null || lon === null || !quality) continue;
    if (DISCARD_QUALITIES.includes(quality)) continue;
    const key = `${date.getTime()}|${lat}|${lon}`;
    if (seen.has(key)) continue;
    const errorRadius = num(col(row, 'Doppler Error radius (m)')) ?? num(col(row, 'Doppler Error radius')) ?? 0;
    seen.set(key, {
      date,
      latitude: lat,
      longitude: lon,
      quality,
      errorRadius,
      semiMajor: 0,
      semiMinor: 0,
      orientation: 0,
      effectiveError: errorRadius > 0 ? errorRadius : (EMPIRICAL_ERRORS[quality] ?? 5000),
      isOutlier: false,
    });
  }
  const fixes = Array.from(seen.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  return {
    fixes,
    ptt,
    otherDevices: Math.max(0, counts.size - 1),
    droppedRows: allRows.length - rows.length,
  };
}
