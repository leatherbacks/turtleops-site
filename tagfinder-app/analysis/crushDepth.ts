import type { SeriesReading, DailyDiveSummary, DeploySummary } from '@/lib/types';

const CRUSH_DEPTH_THRESHOLD_M = 1500;

/**
 * A crush event is terminal, and that is what makes it checkable.
 *
 * An animal that sinks past 1500 m does not come back and resume normal diving:
 * the tag is destroyed or the failsafe fires. So a deep record followed by
 * ordinary dives is not a mortality — it is a corrupt record. Any later reading
 * shallower than this disqualifies the event.
 *
 * The check exists because the old rule was a bare Math.max over every
 * pre-release depth, which meant one bad record could assert that an animal had
 * died. That is the highest-stakes sentence this codebase produces and it had
 * the weakest evidence behind it.
 */
const RESUMED_DIVING_M = CRUSH_DEPTH_THRESHOLD_M / 2;

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

  // Collect pre-release depths from both sources, keeping the time of each so
  // the sequence can be checked rather than only its maximum.
  const points: { t: number; d: number }[] = [];
  for (const r of series) {
    if (r.depth !== null && r.date.getTime() < releaseTime) {
      points.push({ t: r.date.getTime(), d: r.depth });
    }
  }
  if (dailyDives) {
    for (const d of dailyDives) {
      if (d.date.getTime() < releaseTime) {
        points.push({ t: d.date.getTime(), d: d.maxDepth });
      }
    }
  }

  if (points.length === 0) {
    return null;
  }

  points.sort((a, b) => a.t - b.t);
  const depths = points.map((p) => p.d);
  const maxDepth = Math.max(...depths);

  const deepestAt = points.reduce((a, b) => (b.d > a.d ? b : a));
  const resumedNormalDiving = points.some(
    (p) => p.t > deepestAt.t && p.d < RESUMED_DIVING_M
  );

  if (maxDepth >= CRUSH_DEPTH_THRESHOLD_M && resumedNormalDiving) {
    return {
      detected: false,
      maxDepthM: maxDepth,
      reasoning:
        `A single reading of ${maxDepth.toFixed(0)} m appears in the pre-release record, ` +
        `but normal dives continue after it. An animal that sinks past crush depth does ` +
        `not resume diving — the tag does not survive it — so this is a corrupt reading ` +
        `rather than a mortality signal, and no crush event is reported.`,
    };
  }

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
