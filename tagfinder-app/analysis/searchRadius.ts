import type { ArgosFix, DriftLabel } from '@/lib/types';
import { MIN_SEARCH_RADIUS_M, EXPANDED_RADIUS_MULTIPLIER } from '@/lib/constants';
import { getPositionFixes } from './quality';

/** Beyond this, a position is history rather than a current location. */
const STALE_POSITION_HOURS = 12;

export interface SearchRadiusResult {
  primaryM: number;
  expandedM: number;
  /** Contribution from Argos fix precision alone. */
  fixErrorM: number;
  /** Contribution from drift since the last fix (0 for a stationary tag). */
  driftM: number;
  /** Hours between the last fix and the reference time. */
  hoursSinceLastFix: number;
  /** Plain-English basis, for display alongside the number. */
  basis: string;
}

export interface SearchRadiusOptions {
  driftLabel?: DriftLabel;
  /** Drift speed from predictDrift, km/h. */
  speedKmH?: number | null;
  /** Reference time; defaults to now. */
  now?: Date;
}

/**
 * Compute primary and expanded search radii.
 *
 * For a stationary tag the radius is Argos fix precision, as before.
 *
 * For a drifting tag that is NOT enough. Fix precision describes how well we
 * knew the tag's position at the moment of the last fix; it says nothing about
 * how far the tag has travelled since. A reference PSAT+ deployment reported a 514 m radius while
 * drifting ~0.19 km/h with almost three days of silence behind it — the tag
 * could be over 10 km away and the circle claimed half a kilometre. The drift
 * term makes that uncertainty visible instead of hiding it.
 */
export function computeSearchRadius(
  fixes: ArgosFix[],
  options: SearchRadiusOptions = {}
): SearchRadiusResult {
  const q3Fixes = fixes.filter((f) => f.quality === '3' && !f.isOutlier);

  let maxError = 0;
  for (const fix of q3Fixes) {
    const err = fix.semiMajor > 0 ? fix.semiMajor : fix.effectiveError;
    if (err > maxError) maxError = err;
  }

  const fixErrorM = Math.max(maxError, MIN_SEARCH_RADIUS_M);

  // Staleness must be measured against the fixes the *position* rests on, not
  // against any fix in the file. A degrading tag keeps producing class-B
  // solutions long after it stops producing usable ones, and those are excluded
  // from the position — so counting them here dates the circle to a fix that
  // never moved it. A reference PSAT+ deployment read as "0.9 hours since last fix" on a
  // position whose newest supporting fix was 71 hours old.
  const dating = getPositionFixes(fixes).filter((f) => !isNaN(f.date.getTime()));
  const fallback = fixes.filter((f) => !f.isOutlier && !isNaN(f.date.getTime()));
  const valid = dating.length > 0 ? dating : fallback;
  const lastFixDate =
    valid.length > 0
      ? valid.reduce((a, b) => (a.date > b.date ? a : b)).date
      : null;

  const nowMs = (options.now ?? new Date()).getTime();
  const hoursSinceLastFix = lastFixDate
    ? Math.max(0, (nowMs - lastFixDate.getTime()) / 3_600_000)
    : 0;

  const speed = options.speedKmH ?? 0;
  const drifting = options.driftLabel === 'drifting' && speed > 0;
  const driftM = drifting ? speed * hoursSinceLastFix * 1000 : 0;

  const primaryM = fixErrorM + driftM;

  // "Not drifting" and "we have not had a usable position in days" produce the
  // same number here but mean opposite things in the field, so never let the
  // second render as the first.
  const stale = hoursSinceLastFix >= STALE_POSITION_HOURS;

  const basis = drifting
    ? `Argos precision ${Math.round(fixErrorM)} m, plus ${(driftM / 1000).toFixed(1)} km ` +
      `of possible drift at ${speed.toFixed(2)} km/h over the ${formatHours(hoursSinceLastFix)} ` +
      `since the last fix.`
    : stale
      ? `Argos precision ${Math.round(fixErrorM)} m around a position last supported ` +
        `${formatHours(hoursSinceLastFix)} ago. This circle describes where the tag was ` +
        `then, not where it is now — no usable position has been received since, so treat ` +
        `it as a starting point rather than a bound.`
      : `Argos fix precision only — tag is not drifting.`;

  return {
    primaryM,
    expandedM: primaryM * EXPANDED_RADIUS_MULTIPLIER,
    fixErrorM,
    driftM,
    hoursSinceLastFix,
    basis,
  };
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} minutes`;
  if (h < 48) return `${h.toFixed(1)} hours`;
  return `${(h / 24).toFixed(1)} days`;
}
