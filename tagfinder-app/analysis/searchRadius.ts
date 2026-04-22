import type { ArgosFix } from '@/lib/types';
import { MIN_SEARCH_RADIUS_M, EXPANDED_RADIUS_MULTIPLIER } from '@/lib/constants';

/**
 * Compute primary and expanded search radii.
 * Primary: max of largest Q3 error radius and minimum threshold.
 * Expanded: primary × 1.5.
 */
export function computeSearchRadius(fixes: ArgosFix[]): {
  primaryM: number;
  expandedM: number;
} {
  const q3Fixes = fixes.filter((f) => f.quality === '3' && !f.isOutlier);

  let maxError = 0;
  for (const fix of q3Fixes) {
    const err = fix.semiMajor > 0 ? fix.semiMajor : fix.effectiveError;
    if (err > maxError) maxError = err;
  }

  const primaryM = Math.max(maxError, MIN_SEARCH_RADIUS_M);
  const expandedM = primaryM * EXPANDED_RADIUS_MULTIPLIER;

  return { primaryM, expandedM };
}
