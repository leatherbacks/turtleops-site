import type {
  TagStatus,
  TagStateInfo,
  DeploySummary,
  TagPhase,
  EnvironmentData,
  SeriesReading,
  SatCoverage,
  ArgosFix,
} from '@/lib/types';
import { LAND_THRESHOLD_M } from '@/lib/constants';
import { haversineKm } from '@/lib/haversine';

/** Max depth (m) for "partially submerged" classification */
const PARTIAL_SUBMERSION_MAX_DEPTH_M = 2;

/** Depth std dev above this (m) = oscillating / bobbing */
const DEPTH_VARIABILITY_THRESHOLD = 0.3;

/** Max reports to keep in recent series */
const RECENT_SERIES_LIMIT = 20;

/**
 * Derive tag phase by fusing Status.csv depth/temperature data with
 * environmental context (elevation, etc.)
 *
 * Priority order (strongest signal wins):
 * 1. Pre-popoff (no release date yet) — regardless of other signals
 * 2. On land (elevation > 0.5m) — tag has washed up, regardless of depth reading
 * 3. Rich depth series:
 *    - Stable at 0: surface
 *    - Oscillating in shallow: partially submerged
 *    - Deep consistently: submerged
 * 4. Sparse depth data: simple 0/non-0 check
 * 5. No data: unknown
 */
/** Signals suggesting the tag was picked up by a person and taken home */
interface RecoverySignals {
  /** Elevation > 3m — well inland, not intertidal */
  wellInland: boolean;
  /** Max pairwise distance of recent fixes < 100m — consistent with a yard/building */
  tightlyClustered: boolean;
  /** Max temperature > 35°C — consistent with indoor/car/window, not natural beach */
  hotTemp: boolean;
  /** Transmissions ended abruptly (many fixes in short burst, then silence) */
  shortBurst: boolean;
}

function detectRecoverySignals(
  fixes: ArgosFix[] | undefined,
  env: EnvironmentData | null | undefined,
  tempRange: { min: number; max: number } | null,
  mostRecent: Date | null
): RecoverySignals {
  const wellInland = !!(env?.elevation && env.elevation.meters > 3);

  let tightlyClustered = false;
  if (fixes && fixes.length >= 3) {
    const valid = fixes.filter((f) => !f.isOutlier);
    if (valid.length >= 3) {
      let maxDist = 0;
      for (let i = 0; i < valid.length; i++) {
        for (let j = i + 1; j < valid.length; j++) {
          const d = haversineKm(
            valid[i].latitude,
            valid[i].longitude,
            valid[j].latitude,
            valid[j].longitude
          );
          if (d > maxDist) maxDist = d;
        }
      }
      tightlyClustered = maxDist < 0.1; // < 100m
    }
  }

  const hotTemp = !!(tempRange && tempRange.max > 35);

  // Short burst: many fixes crammed into < 3 days, then silence > 14 days
  let shortBurst = false;
  if (fixes && fixes.length >= 5 && mostRecent) {
    const valid = fixes.filter((f) => !f.isOutlier);
    if (valid.length >= 5) {
      const sortedByTime = [...valid].sort(
        (a, b) => a.date.getTime() - b.date.getTime()
      );
      const burstSpanHours =
        (sortedByTime[sortedByTime.length - 1].date.getTime() -
          sortedByTime[0].date.getTime()) /
        (1000 * 60 * 60);
      const silenceDays =
        (Date.now() - sortedByTime[sortedByTime.length - 1].date.getTime()) /
        (1000 * 60 * 60 * 24);
      shortBurst = burstSpanHours < 72 && silenceDays > 14;
    }
  }

  return { wellInland, tightlyClustered, hotTemp, shortBurst };
}

export function analyzeTagState(
  statuses: TagStatus[],
  summary: DeploySummary | null,
  env?: EnvironmentData | null,
  series?: SeriesReading[] | null,
  satCoverage?: SatCoverage | null,
  fixes?: ArgosFix[] | null
): TagStateInfo {
  const now = Date.now();

  // 1. Pre-popoff check (always takes priority)
  if (summary && (!summary.releaseDate || summary.releaseDate.getTime() > now)) {
    return {
      ...emptyFields(statuses.length + (series?.length || 0)),
      phase: 'pre_popoff',
      reasoning: summary.releaseDate
        ? 'Release date is in the future'
        : 'No release date in Summary',
    };
  }

  // Depth/temperature series with no release date cannot be split into
  // pre-release (the animal diving) and post-release (the tag's current
  // situation). Reporting the animal's dive record as the tag's present state
  // is confidently wrong: a reference PSAT+ deployment came back "SUBMERGED, 40 m" off 3,222 July
  // readings while the tag had actually been ashore for three days.
  //
  // Status.csv readings are exempt — a tag self-reporting status is describing
  // itself, not the animal. This mirrors the guard tempComparison and
  // burialDetection already apply.
  const hasReleaseDate = Boolean(summary?.releaseDate);
  if (!hasReleaseDate && statuses.length === 0 && series && series.length > 0) {
    return {
      // 0 reports used — the series exists but none of it could be attributed
      // to the post-release period, so none of it informed a verdict.
      ...emptyFields(0),
      phase: 'unknown',
      reasoning:
        'No release date available, so the depth/temperature series cannot be ' +
        'split into pre-release (animal diving) and post-release (current tag ' +
        'environment) readings. Classifying the whole series would describe the ' +
        'animal, not where the tag is now.',
    };
  }

  // Combine Series.csv + Status.csv data — Series is much richer when present
  type DepthPoint = { date: Date; depth: number };
  type TempPoint = { date: Date; temp: number };

  const depthPoints: DepthPoint[] = [];
  const tempPoints: TempPoint[] = [];

  // For PSAT tags, filter Series readings to post-release-date only.
  // Pre-release readings reflect animal diving behavior, not current tag state.
  const postReleaseCutoff = summary?.releaseDate?.getTime() ?? 0;
  if (series && series.length > 0) {
    for (const r of series) {
      if (r.date.getTime() < postReleaseCutoff) continue;
      if (r.depth !== null) depthPoints.push({ date: r.date, depth: r.depth });
      if (r.temperature !== null) tempPoints.push({ date: r.date, temp: r.temperature });
    }
  }
  for (const s of statuses) {
    if (s.depth !== null) depthPoints.push({ date: s.date, depth: s.depth });
    if (s.temperature !== null) tempPoints.push({ date: s.date, temp: s.temperature });
  }

  depthPoints.sort((a, b) => b.date.getTime() - a.date.getTime());
  tempPoints.sort((a, b) => b.date.getTime() - a.date.getTime());

  const sorted = [...statuses].sort((a, b) => b.date.getTime() - a.date.getTime());
  const mostRecent = sorted[0];

  const recentDepths = depthPoints.slice(0, RECENT_SERIES_LIMIT);
  const recentTemps = tempPoints.slice(0, RECENT_SERIES_LIMIT);

  const depthValues = recentDepths.map((d) => d.depth);
  const lastDepth = depthValues[0] ?? null;
  // Robust spread, not standard deviation. Transmitted sensor data carries
  // occasional impossible values, and a single bad reading inflates a standard
  // deviation enough to turn a tag sitting flat at 0 m into one "oscillating in
  // surf". The median absolute deviation ignores a couple of outliers among
  // many good readings, which is exactly the failure mode here.
  const depthVariability =
    depthValues.length >= 2 ? medianAbsoluteDeviation(depthValues) : null;

  const tempValues = recentTemps.map((t) => t.temp);
  const lastTemperature = tempValues[0] ?? null;
  const avgTemperature = tempValues.length > 0 ? mean(tempValues) : null;
  const tempRange =
    tempValues.length > 0
      ? { min: Math.min(...tempValues), max: Math.max(...tempValues) }
      : null;

  // 2. Elevation-based override: if tag is on land
  const elevation = env?.elevation;
  if (elevation && elevation.meters > LAND_THRESHOLD_M) {
    // Recovery signals — tag likely picked up by a person
    const signals = detectRecoverySignals(
      fixes || undefined,
      env,
      tempRange,
      mostRecent?.date ?? null
    );
    const signalCount =
      (signals.wellInland ? 1 : 0) +
      (signals.tightlyClustered ? 1 : 0) +
      (signals.hotTemp ? 1 : 0) +
      (signals.shortBurst ? 1 : 0);

    if (signalCount >= 2) {
      const reasons: string[] = [];
      if (signals.wellInland)
        reasons.push(`position is well inland (elev ${elevation.meters.toFixed(1)}m)`);
      if (signals.tightlyClustered)
        reasons.push('fixes cluster tightly (<100m, consistent with a building/yard)');
      if (signals.hotTemp && tempRange)
        reasons.push(`temperatures reached ${tempRange.max.toFixed(1)}°C (indoor/car/window)`);
      if (signals.shortBurst)
        reasons.push('transmissions ended abruptly after a short burst');

      return {
        phase: 'likely_recovered',
        reasoning: `Tag appears to have been picked up and taken indoors: ${reasons.join('; ')}.`,
        lastDepth,
        lastTemperature,
        avgTemperature,
        tempRange,
        depthVariability,
        lastReportDate: mostRecent?.date ?? depthPoints[0]?.date ?? null,
        reportCount: depthPoints.length,
        recentDepths,
        recentTemps,
      };
    }

    // BURIED detection: on land + non-trivial depth reading + poor sat reception
    // The "depth" is really sand/sediment weight on the pressure sensor
    const hasNonZeroDepth = lastDepth !== null && lastDepth > 0.5;
    const poorReception =
      satCoverage &&
      satCoverage.totalPredicted >= 20 &&
      satCoverage.receptionRate < 0.1;

    if (hasNonZeroDepth && poorReception) {
      return {
        phase: 'buried',
        reasoning: `Position is on land (elevation ${elevation.meters.toFixed(1)}m) with a non-zero depth reading (${lastDepth!.toFixed(1)}m of sand/sediment pressure) and poor satellite reception (${(satCoverage!.receptionRate * 100).toFixed(0)}%). Tag is likely buried with only antenna exposed.`,
        lastDepth,
        lastTemperature,
        avgTemperature,
        tempRange,
        depthVariability,
        lastReportDate: mostRecent?.date ?? depthPoints[0]?.date ?? null,
        reportCount: depthPoints.length,
        recentDepths,
        recentTemps,
      };
    }

    // BURIED (depth only) — if we don't have sat coverage data but depth suggests burial
    if (hasNonZeroDepth && !satCoverage) {
      return {
        phase: 'buried',
        reasoning: `Position is on land (elevation ${elevation.meters.toFixed(1)}m) with a non-zero depth reading (${lastDepth!.toFixed(1)}m). May indicate burial \u2014 the depth sensor could be reading sand/sediment pressure.`,
        lastDepth,
        lastTemperature,
        avgTemperature,
        tempRange,
        depthVariability,
        lastReportDate: mostRecent?.date ?? depthPoints[0]?.date ?? null,
        reportCount: depthPoints.length,
        recentDepths,
        recentTemps,
      };
    }

    return {
      phase: 'stranded_on_land',
      reasoning: `Position is on land (elevation ${elevation.meters.toFixed(1)}m)${
        lastDepth !== null && lastDepth > 0 ? ` — depth reading (${lastDepth.toFixed(1)}m) may indicate partial burial` : ''
      }`,
      lastDepth,
      lastTemperature,
      avgTemperature,
      tempRange,
      depthVariability,
      lastReportDate: mostRecent?.date ?? depthPoints[0]?.date ?? null,
      reportCount: depthPoints.length,
      recentDepths,
      recentTemps,
    };
  }

  // 3. Depth-based classification (requires data)
  let phase: TagPhase = 'unknown';
  let reasoning = 'No depth data available';

  if (lastDepth !== null) {
    if (depthValues.length >= 3 && depthVariability !== null) {
      const maxDepth = Math.max(...depthValues);
      // Judged on the MEDIAN, not the maximum. A single bad reading is common
      // in transmitted sensor data — the Lotek health message carries occasional
      // impossible depths — and one 32 m outlier among eighteen zeros used to be
      // enough to report a surfaced tag as "consistently submerged". The maximum
      // still describes the oscillation range, which is what it is good for.
      const sortedDepths = depthValues.slice().sort((a, b) => a - b);
      const medianDepth = sortedDepths[sortedDepths.length >> 1];
      const isShallow = medianDepth <= PARTIAL_SUBMERSION_MAX_DEPTH_M;
      const isOscillating = depthVariability > DEPTH_VARIABILITY_THRESHOLD;

      if (lastDepth === 0 && !isOscillating) {
        phase = 'surface';
        reasoning = 'Depth stable at 0m — tag is at surface';
      } else if (isShallow && isOscillating) {
        phase = 'partially_submerged';
        // Quote a robust upper bound rather than the raw maximum, which on this
        // data is usually the one corrupt reading in the set.
        const p90 = sortedDepths[Math.min(sortedDepths.length - 1,
          Math.floor(sortedDepths.length * 0.9))];
        reasoning = `Depth oscillating 0–${p90.toFixed(1)}m — tag bobbing in surf`;
      } else if (medianDepth > PARTIAL_SUBMERSION_MAX_DEPTH_M) {
        phase = 'submerged';
        reasoning =
          `Median depth ${medianDepth.toFixed(1)}m across ${depthValues.length} readings ` +
          `(max ${maxDepth.toFixed(1)}m) — tag submerged`;
      } else {
        phase = 'surface';
        reasoning = 'Depth near surface with low variability';
      }
    } else if (depthValues.length >= 2) {
      phase = lastDepth === 0 ? 'surface' : 'submerged';
      reasoning = `Limited data (${depthValues.length} readings) — using simple depth check`;
    } else {
      // Only 1 report — classify tentatively, mark low confidence
      phase = lastDepth === 0 ? 'surface' : 'submerged';
      reasoning = `Single depth reading of ${lastDepth.toFixed(1)}m — low confidence`;
    }
  }

  // 4. Sanity check with intertidal / water classification
  if (elevation && elevation.classification === 'intertidal' && phase === 'surface') {
    reasoning += '. Position is in intertidal zone — may wash up at high tide';
  }

  return {
    phase,
    reasoning,
    lastDepth,
    lastTemperature,
    avgTemperature,
    tempRange,
    depthVariability,
    lastReportDate: mostRecent?.date ?? depthPoints[0]?.date ?? null,
    reportCount: depthPoints.length,
    recentDepths,
    recentTemps,
  };
}

function emptyFields(reportCount: number) {
  return {
    lastDepth: null,
    lastTemperature: null,
    avgTemperature: null,
    tempRange: null,
    depthVariability: null,
    lastReportDate: null,
    reportCount,
    recentDepths: [],
    recentTemps: [],
  };
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdDev(values: number[]): number {
  const m = mean(values);
  const variance =
    values.reduce((s, v) => s + (v - m) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/**
 * Median absolute deviation — spread that a couple of bad readings cannot inflate.
 */
function medianAbsoluteDeviation(values: number[]): number {
  const med = (xs: number[]) => {
    const s = xs.slice().sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const m = med(values);
  // 1.4826 scales MAD to be comparable with a standard deviation on normal data,
  // so existing thresholds keep their meaning.
  return 1.4826 * med(values.map((v) => Math.abs(v - m)));
}
