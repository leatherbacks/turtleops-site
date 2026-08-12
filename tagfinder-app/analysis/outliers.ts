import type { ArgosFix, DriftLabel } from '@/lib/types';
import { haversineKm } from '@/lib/haversine';
import { STUCK_OUTLIER_DISTANCE_KM, MAX_DRIFT_SPEED_KMH } from '@/lib/constants';
import { getHighQualityFixes } from './quality';

/**
 * Mark outlier fixes in-place. Detection method depends on drift state.
 * Call this AFTER drift classification or with a preliminary drift label.
 */
export function markOutliers(
  fixes: ArgosFix[],
  driftLabel: DriftLabel
): void {
  if (driftLabel === 'stuck') {
    markOutliersStuck(fixes);
  } else {
    markOutliersDrifting(fixes);
  }
}

/**
 * Stuck tag: flag any fix >50 km from median of Q2/Q3 fixes.
 */
function markOutliersStuck(fixes: ArgosFix[]): void {
  const hqFixes = getHighQualityFixes(fixes);
  if (hqFixes.length === 0) return;

  const medLat = median(hqFixes.map((f) => f.latitude));
  const medLon = median(hqFixes.map((f) => f.longitude));

  for (const fix of fixes) {
    const dist = haversineKm(fix.latitude, fix.longitude, medLat, medLon);
    if (dist > STUCK_OUTLIER_DISTANCE_KM) {
      fix.isOutlier = true;
    }
  }
}

/**
 * Drifting tag: flag any fix whose apparent speed from the previous good fix
 * exceeds the plausible cap (5 km/h).
 *
 * The separation between two fixes is only evidence of movement to the extent
 * it exceeds their combined positional error. Comparing raw coordinates treats
 * a class-B fix as if it were surveyed, which inverts the result on exactly the
 * tags that need it most: on a reference PSAT+ deployment a 24 km-error fix passed the gate on
 * its own (a long gap makes any speed look slow), became the reference, and
 * then flagged the genuinely good 1535 m fix 22 minutes later as an impossible
 * 10.9 km/h jump. The best position in the file was discarded by the worst.
 *
 * Charging displacement only for the part that outruns the error means two
 * fixes that cannot be told apart never accuse each other, while a real jump
 * between two tight fixes still trips the cap.
 */
function markOutliersDrifting(fixes: ArgosFix[]): void {
  const sorted = [...fixes].sort((a, b) => a.date.getTime() - b.date.getTime());

  let lastGood: ArgosFix | null = null;

  for (const fix of sorted) {
    if (fix.isOutlier) continue;

    if (lastGood) {
      const dist = haversineKm(
        lastGood.latitude,
        lastGood.longitude,
        fix.latitude,
        fix.longitude
      );
      const hours =
        (fix.date.getTime() - lastGood.date.getTime()) / (1000 * 60 * 60);

      if (hours > 0) {
        const combinedErrorKm =
          (finiteError(lastGood.effectiveError) + finiteError(fix.effectiveError)) / 1000;
        const resolvableDist = Math.max(0, dist - combinedErrorKm);
        const speed = resolvableDist / hours;
        if (speed > MAX_DRIFT_SPEED_KMH) {
          fix.isOutlier = true;
          continue;
        }
      }
    }

    lastGood = fix;
  }
}

/** Class Z carries an Infinite empirical error, which would swallow every test. */
function finiteError(metres: number): number {
  return Number.isFinite(metres) ? metres : 0;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}
