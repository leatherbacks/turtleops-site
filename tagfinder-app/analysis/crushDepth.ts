import type { SeriesReading, DailyDiveSummary, DeploySummary } from '@/lib/types';

const CRUSH_DEPTH_THRESHOLD_M = 1500;

/**
 * Detect whether the tag reached crush-depth range before release.
 * Signal: mortality + sinking descent.
 *
 * Looks at pre-release depth data (Series.csv + MinMaxDepth.csv) and flags
 * anything >= 1500m as approaching the typical failsafe threshold (~1700m).
 */
export function detectCrushDepthEvent(
  series: SeriesReading[],
  dailyDives: DailyDiveSummary[] | null,
  summary: DeploySummary | null
): { detected: boolean; maxDepthM: number; reasoning: string } | null {
  if (!summary) return null;

  const releaseTime = summary.releaseDate?.getTime() ?? Infinity;

  // Collect pre-release depths from both sources
  const depths: number[] = [];
  for (const r of series) {
    if (r.depth !== null && r.date.getTime() < releaseTime) {
      depths.push(r.depth);
    }
  }
  if (dailyDives) {
    for (const d of dailyDives) {
      if (d.date.getTime() < releaseTime) {
        depths.push(d.maxDepth);
      }
    }
  }

  if (depths.length === 0) {
    return null;
  }

  const maxDepth = Math.max(...depths);

  if (maxDepth >= CRUSH_DEPTH_THRESHOLD_M) {
    return {
      detected: true,
      maxDepthM: maxDepth,
      reasoning: `Pre-release dive data shows depths reaching ${maxDepth.toFixed(0)}m — approaching the typical MiniPAT crush-depth failsafe (~1700m). This strongly suggests the animal died and sank; the tag may have released via the failsafe just above crush depth.`,
    };
  }

  return {
    detected: false,
    maxDepthM: maxDepth,
    reasoning: `Max pre-release depth was ${maxDepth.toFixed(0)}m — well above the crush-depth threshold.`,
  };
}
