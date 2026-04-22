import type { ArgosFix, DriftState, DriftLabel } from '@/lib/types';
import { haversineKm } from '@/lib/haversine';
import {
  STUCK_THRESHOLD_M,
  DRIFT_THRESHOLD_M,
  MIN_WINDOW_HOURS,
} from '@/lib/constants';
import { getDriftClassificationFixes } from './quality';

/**
 * Classify drift state using rolling windows over Q2/Q3 fixes.
 * Returns labels for recent (24h), medium (72h), and all-time,
 * plus a human-readable pattern string.
 */
export function classifyDrift(fixes: ArgosFix[]): DriftState {
  const hqFixes = getDriftClassificationFixes(fixes);

  if (hqFixes.length < 2) {
    return {
      recent: 'insufficient',
      medium: 'insufficient',
      allTime: 'insufficient',
      pattern: 'Insufficient data',
      recentSpreadKm: 0,
      mediumSpreadKm: 0,
      allTimeSpreadKm: 0,
    };
  }

  const now = hqFixes[hqFixes.length - 1].date.getTime();

  const recent24h = hqFixes.filter(
    (f) => now - f.date.getTime() <= 24 * 60 * 60 * 1000
  );
  const medium72h = hqFixes.filter(
    (f) => now - f.date.getTime() <= 72 * 60 * 60 * 1000
  );

  const recentSpread = maxPairwiseDistance(recent24h);
  const mediumSpread = maxPairwiseDistance(medium72h);
  const allTimeSpread = maxPairwiseDistance(hqFixes);

  const recentDuration = windowDurationHours(recent24h);
  const mediumDuration = windowDurationHours(medium72h);
  const allTimeDuration = windowDurationHours(hqFixes);

  const recent = classify(recentSpread, recentDuration);
  const medium = classify(mediumSpread, mediumDuration);
  const allTime = classify(allTimeSpread, allTimeDuration);

  // If ambiguous (insufficient label), check implied drift speed.
  // Slow implied speed (< 0.1 km/h) = likely stuck, not drifting.
  const refineAmbiguous = (
    label: DriftLabel,
    spreadKm: number,
    durationHours: number
  ): DriftLabel => {
    if (label !== 'insufficient') return label;
    if (durationHours < MIN_WINDOW_HOURS) return label;
    const impliedSpeedKmH = spreadKm / durationHours;
    if (impliedSpeedKmH < 0.1) return 'stuck';
    return label;
  };

  const recentRefined = refineAmbiguous(recent, recentSpread, recentDuration);
  const mediumRefined = refineAmbiguous(medium, mediumSpread, mediumDuration);
  const allTimeRefined = refineAmbiguous(allTime, allTimeSpread, allTimeDuration);

  const pattern = describePattern(recentRefined, mediumRefined, allTimeRefined);

  return {
    recent: recentRefined,
    medium: mediumRefined,
    allTime: allTimeRefined,
    pattern,
    recentSpreadKm: recentSpread,
    mediumSpreadKm: mediumSpread,
    allTimeSpreadKm: allTimeSpread,
  };
}

function classify(spreadKm: number, durationHours: number): DriftLabel {
  if (durationHours < MIN_WINDOW_HOURS) return 'insufficient';
  const spreadM = spreadKm * 1000;
  if (spreadM < STUCK_THRESHOLD_M) return 'stuck';
  if (spreadM > DRIFT_THRESHOLD_M) return 'drifting';
  return 'insufficient';
}

/**
 * Max pairwise distance, error-aware.
 * Subtracts combined fix error (in km) from raw distance so that spread
 * within measurement noise doesn't falsely indicate drift.
 */
function maxPairwiseDistance(fixes: ArgosFix[]): number {
  let maxDist = 0;
  for (let i = 0; i < fixes.length; i++) {
    for (let j = i + 1; j < fixes.length; j++) {
      const rawDist = haversineKm(
        fixes[i].latitude,
        fixes[i].longitude,
        fixes[j].latitude,
        fixes[j].longitude
      );
      // Subtract combined error (in km) from raw distance. If fixes are within
      // each other's error ellipses, effective spread is 0.
      const combinedErrorKm =
        (fixes[i].effectiveError + fixes[j].effectiveError) / 1000;
      const effectiveDist = Math.max(0, rawDist - combinedErrorKm);
      if (effectiveDist > maxDist) maxDist = effectiveDist;
    }
  }
  return maxDist;
}

function windowDurationHours(fixes: ArgosFix[]): number {
  if (fixes.length < 2) return 0;
  const first = fixes[0].date.getTime();
  const last = fixes[fixes.length - 1].date.getTime();
  return (last - first) / (1000 * 60 * 60);
}

function describePattern(
  recent: DriftLabel,
  medium: DriftLabel,
  allTime: DriftLabel
): string {
  if (recent === 'stuck' && medium === 'stuck' && allTime === 'stuck') {
    return 'Stationary (stuck)';
  }
  if (recent === 'drifting' && allTime === 'drifting') {
    return 'Actively drifting';
  }
  if (recent === 'stuck' && (medium === 'drifting' || allTime === 'drifting')) {
    return 'Drifted then stuck (grounded)';
  }
  if (recent === 'drifting' && allTime === 'stuck') {
    return 'Recently started drifting';
  }
  if (recent === 'insufficient') {
    return 'Insufficient recent data';
  }
  return 'Mixed drift pattern';
}
