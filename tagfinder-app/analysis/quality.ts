import type { ArgosFix } from '@/lib/types';
import { POSITION_QUALITIES, CONTEXT_QUALITIES } from '@/lib/constants';

/**
 * Filter fixes to those usable for position estimation.
 *
 * Deliberately gated on the class letter and not on a reported error radius,
 * even though the CLS message export supplies one. A reported radius describes
 * the residual of the Doppler frequency fit; it does not describe the mirror
 * ambiguity, and class B exists precisely because a solution built from fewer
 * than four messages is unreliable in ways the residual cannot see.
 *
 * One reference deployment settled it. Its final two positions were both
 * class B from two messages each, with reported radii of 1535 m and 24474 m —
 * so admitting on radius would have let the tighter one through. But the two
 * fixes are 4.04 km apart across 22 minutes, an implied 10.9 km/h, so at most
 * one of them can be true; and the 1535 m fix sits only 1.5x its own error from
 * the previous position, which is not a detection. Trusting the reported radius
 * would have moved the headline 2.4 km on evidence that does not support it.
 */
export function getPositionFixes(fixes: ArgosFix[]): ArgosFix[] {
  return fixes.filter(
    (f) => !f.isOutlier && POSITION_QUALITIES.includes(f.quality)
  );
}

/** Filter fixes to high-quality only (Q2, Q3) for drift classification */
export function getHighQualityFixes(fixes: ArgosFix[]): ArgosFix[] {
  return fixes.filter(
    (f) => !f.isOutlier && (f.quality === '3' || f.quality === '2')
  );
}

/**
 * Fixes usable for drift classification — expanded to include Q1/A when Q2/Q3
 * alone don't span enough time. Q1/A have larger error ellipses but still useful
 * for detecting drift vs stuck over longer time windows.
 */
export function getDriftClassificationFixes(fixes: ArgosFix[]): ArgosFix[] {
  const hq = getHighQualityFixes(fixes);

  // Compute time span of Q2/Q3 fixes
  if (hq.length >= 2) {
    const sorted = [...hq].sort((a, b) => a.date.getTime() - b.date.getTime());
    const spanHours =
      (sorted[sorted.length - 1].date.getTime() - sorted[0].date.getTime()) /
      (1000 * 60 * 60);
    // If Q2/Q3 span at least 24 hours, use only those
    if (spanHours >= 24) return hq;
  }

  // Otherwise include Q1 and A fixes for wider time coverage
  return fixes.filter(
    (f) => !f.isOutlier && POSITION_QUALITIES.includes(f.quality)
  );
}

/** Check if a fix is context-only (B quality) */
export function isContextOnly(fix: ArgosFix): boolean {
  return CONTEXT_QUALITIES.includes(fix.quality);
}
