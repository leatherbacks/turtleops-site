import type { ArgosFix, DriftLabel } from '@/lib/types';
import { getPositionFixes } from './quality';
import { haversineKm } from '@/lib/haversine';

/** Window treated as "the tag has not meaningfully moved" for a drifting tag. */
const DRIFT_POSITION_WINDOW_HOURS = 2;
/** Never estimate a drifting tag's position from fewer than this many fixes. */
const DRIFT_MIN_FIXES = 3;
/**
 * How far back the fix-count fallback may reach for a drifting tag.
 *
 * The fallback exists for sparse transmitters, where two hours may hold one
 * fix. It used to take the last three position-quality fixes whatever their
 * age, and on PSAT+ 47128 that averaged one fix on the Ponte Vedra shoreline
 * with two from 39 hours and 41 km earlier, before a northeaster moved the
 * tag. The headline landed in open water 28 km from the tag, between places
 * it had been and was. Averaging is only defensible across a span the tag
 * could not have crossed by more than its fix error; at the 0.5 km/h this
 * drift model treats as slow, six hours is already 3 km. Past that, one
 * fresh fix beats a mean of stale ones.
 */
const DRIFT_FALLBACK_MAX_HOURS = 6;
/**
 * A stopped tag is averaged over the fixes since it stopped, not over the file.
 *
 * "Stuck" used to mean "every fix in the record", which is right for a tag that
 * never moved and badly wrong for one that drifted and then stopped. On MiniPAT
 * 33938 the drift classifier correctly read the last day as stuck at Melbourne
 * Beach, and the headline then averaged all 73 fixes, three days of them adrift,
 * into a point 13 km out at sea on the 13 Oct track, where the tag had been for
 * an hour. The stopped tag's fixes are the ones that agree with the newest
 * fixes: walking back from the newest, a fix joins while it sits within
 * CLUSTER_SIGMA of its own error (plus CLUSTER_FLOOR_KM) of the cluster's
 * weighted centre, and the first fix that does not is where the tag stopped.
 * On 33938 that drops the class 2 fix 1.9 km offshore 95 minutes before
 * landfall and keeps all seven position fixes from the island.
 */
const CLUSTER_SIGMA = 2;
const CLUSTER_FLOOR_KM = 0.5;

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
export interface PositionEstimate {
  lat: number;
  lon: number;
  method: 'weighted_mean' | 'recent_only';
  /** The fixes the estimate averages. */
  basis: ArgosFix[];
}

export function computePosition(fixes: ArgosFix[], driftLabel: DriftLabel): PositionEstimate {
  const positionFixes = getPositionFixes(fixes);

  if (positionFixes.length === 0) {
    // Fallback to raw median
    const allValid = fixes.filter((f) => !f.isOutlier);
    if (allValid.length === 0) return { lat: 0, lon: 0, method: 'weighted_mean', basis: [] };
    return {
      lat: allValid.reduce((s, f) => s + f.latitude, 0) / allValid.length,
      lon: allValid.reduce((s, f) => s + f.longitude, 0) / allValid.length,
      method: 'weighted_mean',
      basis: allValid,
    };
  }

  let subset: ArgosFix[];
  let method: 'weighted_mean' | 'recent_only';

  if (driftLabel === 'drifting') {
    const last = positionFixes[positionFixes.length - 1];
    const cutoff = last.date.getTime() - DRIFT_POSITION_WINDOW_HOURS * 60 * 60 * 1000;
    const window = positionFixes.filter((f) => f.date.getTime() >= cutoff);
    // Sparse transmitters may deliver only one or two fixes in two hours; fall
    // back to a fix count rather than collapsing onto a single Argos position —
    // but never reach back past DRIFT_FALLBACK_MAX_HOURS to find them. If the
    // recent fixes are all there is, they are the answer, down to one.
    if (window.length >= DRIFT_MIN_FIXES) {
      subset = window;
    } else {
      const floor = last.date.getTime() - DRIFT_FALLBACK_MAX_HOURS * 60 * 60 * 1000;
      subset = positionFixes
        .slice(-Math.min(DRIFT_MIN_FIXES, positionFixes.length))
        .filter((f) => f.date.getTime() >= floor);
      if (subset.length === 0) subset = [last];
    }
    method = 'recent_only';
  } else {
    subset = stoppedCluster(positionFixes);
    method = 'weighted_mean';
  }

  return { ...weightedMean(subset), method, basis: subset };
}

/** The newest run of fixes that agree with each other: where a stopped tag stopped. */
export function stoppedCluster(positionFixes: ArgosFix[]): ArgosFix[] {
  const dated = positionFixes
    .filter((f) => !isNaN(f.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (dated.length === 0) return positionFixes;
  const cluster = [dated[dated.length - 1]];
  for (let i = dated.length - 2; i >= 0; i--) {
    const f = dated[i];
    const c = weightedMean(cluster);
    const errKm = Number.isFinite(f.effectiveError) ? f.effectiveError / 1000 : 0;
    if (haversineKm(f.latitude, f.longitude, c.lat, c.lon) > CLUSTER_SIGMA * errKm + CLUSTER_FLOOR_KM) break;
    cluster.push(f);
  }
  return cluster.reverse();
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
