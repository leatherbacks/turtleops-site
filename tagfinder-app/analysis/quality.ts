import type { ArgosFix } from '@/lib/types';
import { POSITION_QUALITIES, CONTEXT_QUALITIES } from '@/lib/constants';

/** Filter fixes to those usable for position estimation */
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
