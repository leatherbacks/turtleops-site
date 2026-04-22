import type { ArgosFix, DriftLabel } from '@/lib/types';
import { getPositionFixes } from './quality';

/**
 * Compute best-estimate position using inverse-error-squared weighting.
 * For stuck tags: use all non-outlier position-quality fixes.
 * For drifting tags: use only the last 24 hours of fixes.
 */
export function computePosition(
  fixes: ArgosFix[],
  driftLabel: DriftLabel
): { lat: number; lon: number; method: 'weighted_mean' | 'recent_only' } {
  const positionFixes = getPositionFixes(fixes);

  if (positionFixes.length === 0) {
    // Fallback to raw median
    const allValid = fixes.filter((f) => !f.isOutlier);
    if (allValid.length === 0) return { lat: 0, lon: 0, method: 'weighted_mean' };
    return {
      lat: allValid.reduce((s, f) => s + f.latitude, 0) / allValid.length,
      lon: allValid.reduce((s, f) => s + f.longitude, 0) / allValid.length,
      method: 'weighted_mean',
    };
  }

  let subset: ArgosFix[];
  let method: 'weighted_mean' | 'recent_only';

  if (driftLabel === 'drifting') {
    // Use only last 24h of fixes
    const cutoff = positionFixes[positionFixes.length - 1].date.getTime() - 24 * 60 * 60 * 1000;
    const recent = positionFixes.filter((f) => f.date.getTime() >= cutoff);
    subset = recent.length > 0 ? recent : [positionFixes[positionFixes.length - 1]];
    method = 'recent_only';
  } else {
    subset = positionFixes;
    method = 'weighted_mean';
  }

  return { ...weightedMean(subset), method };
}

function weightedMean(fixes: ArgosFix[]): { lat: number; lon: number } {
  let sumLat = 0;
  let sumLon = 0;
  let sumWeight = 0;

  for (const fix of fixes) {
    const w = 1 / (fix.effectiveError ** 2);
    sumLat += fix.latitude * w;
    sumLon += fix.longitude * w;
    sumWeight += w;
  }

  return {
    lat: sumLat / sumWeight,
    lon: sumLon / sumWeight,
  };
}
