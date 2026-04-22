import type { ArgosFix, ArgosQuality } from '@/lib/types';
import { EMPIRICAL_ERRORS, DISCARD_QUALITIES } from '@/lib/constants';
import { parseWCDate } from './dates';

const VALID_QUALITIES = new Set(['3', '2', '1', '0', 'A', 'B', 'Z']);

/**
 * Parse a Wildlife Computers Locations.csv into ArgosFix[].
 * Applies empirical error fallback when error fields are 0.
 */
export function parseLocations(rows: Record<string, string>[]): ArgosFix[] {
  const fixes: ArgosFix[] = [];

  for (const row of rows) {
    const dateStr = row['Date'] || row['date'] || '';
    const date = parseWCDate(dateStr);
    if (!date) continue;

    const quality = (row['Quality'] || '').trim() as ArgosQuality;
    if (!VALID_QUALITIES.has(quality)) continue;
    if (DISCARD_QUALITIES.includes(quality)) continue;

    const lat = parseFloat(row['Latitude'] || '');
    const lon = parseFloat(row['Longitude'] || '');
    if (isNaN(lat) || isNaN(lon)) continue;

    const errorRadius = parseFloat(row['Error radius'] || '0') || 0;
    const semiMajor = parseFloat(row['Error Semi-major axis'] || '0') || 0;
    const semiMinor = parseFloat(row['Error Semi-minor axis'] || '0') || 0;
    const orientation = parseFloat(row['Error Ellipse orientation'] || '0') || 0;

    // Effective error: use reported error, then semi-major, then empirical fallback
    let effectiveError = errorRadius;
    if (effectiveError === 0 && semiMajor > 0) {
      effectiveError = semiMajor;
    }
    if (effectiveError === 0) {
      effectiveError = EMPIRICAL_ERRORS[quality] || 5000;
    }

    fixes.push({
      date,
      latitude: lat,
      longitude: lon,
      quality,
      errorRadius,
      semiMajor,
      semiMinor,
      orientation,
      effectiveError,
      isOutlier: false,
    });
  }

  return fixes.sort((a, b) => a.date.getTime() - b.date.getTime());
}
