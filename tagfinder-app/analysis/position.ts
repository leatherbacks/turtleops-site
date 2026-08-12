import type { ArgosFix, DriftLabel } from '@/lib/types';
import { getPositionFixes } from './quality';

/** Window treated as "the tag has not meaningfully moved" for a drifting tag. */
const DRIFT_POSITION_WINDOW_HOURS = 2;
/** Never estimate a drifting tag's position from fewer than this many fixes. */
const DRIFT_MIN_FIXES = 3;

/**
 * Compute best-estimate position using inverse-error-squared weighting.
 * For stuck tags: use all non-outlier position-quality fixes.
 * For drifting tags: use only the final cluster of fixes.
 *
 * This deliberately does NOT average 24 hours of a moving tag. A tag drifting
 * at even 0.4 km/h covers ~10 km in a day, and the mean of that track is a
 * point the tag never occupied — for a reference PSAT+ deployment it landed 4.5 km from the last
 * known fix, which was itself nearly 9x the reported search radius away. The
 * question a recovery answers is "where was it last", not "where was it on
 * average", so only the final couple of hours are used.
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
    const last = positionFixes[positionFixes.length - 1];
    const cutoff = last.date.getTime() - DRIFT_POSITION_WINDOW_HOURS * 60 * 60 * 1000;
    const window = positionFixes.filter((f) => f.date.getTime() >= cutoff);
    // Sparse transmitters may deliver only one or two fixes in two hours; fall
    // back to a fix count rather than collapsing onto a single Argos position.
    subset =
      window.length >= DRIFT_MIN_FIXES
        ? window
        : positionFixes.slice(-Math.min(DRIFT_MIN_FIXES, positionFixes.length));
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
