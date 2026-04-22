import type { SeriesReading, TagStatus, DeploySummary, TidalIntrusion } from '@/lib/types';

/** Depth (m) below which the tag is considered "dry" */
const DRY_THRESHOLD_M = 0.2;

/** Depth variability cutoff: only meaningful if tag is not continuously submerged */
const MAX_MEAN_DEPTH_FOR_TIDAL = 3;

/**
 * Detect if a tag is being tidally flooded after release.
 * Looks for oscillation between "dry" and "wet" states on a ~12 or ~24 hour cycle.
 *
 * Only makes sense for post-release data — pre-popoff depth is animal diving behavior.
 */
export function analyzeTidalIntrusion(
  series: SeriesReading[],
  statuses: TagStatus[],
  summary: DeploySummary | null
): TidalIntrusion | null {
  const releaseDate = summary?.releaseDate;
  if (!releaseDate) return null;

  // Collect post-release depth readings
  type DepthPoint = { t: number; d: number };
  const points: DepthPoint[] = [];

  for (const r of series) {
    if (r.date.getTime() < releaseDate.getTime()) continue;
    if (r.depth !== null) points.push({ t: r.date.getTime(), d: r.depth });
  }
  for (const s of statuses) {
    if (s.date.getTime() < releaseDate.getTime()) continue;
    if (s.depth !== null) points.push({ t: s.date.getTime(), d: s.depth });
  }

  if (points.length < 10) {
    return {
      detected: false,
      confidence: 0,
      reasoning: 'Not enough post-release depth readings for tidal analysis',
      wetPct: 0,
      maxPostReleaseDepth: points.length > 0 ? Math.max(...points.map((p) => p.d)) : 0,
      cyclePeriodHours: null,
    };
  }

  points.sort((a, b) => a.t - b.t);

  const depths = points.map((p) => p.d);
  const maxDepth = Math.max(...depths);
  const meanDepth = depths.reduce((s, v) => s + v, 0) / depths.length;
  const wetCount = depths.filter((d) => d > DRY_THRESHOLD_M).length;
  const wetPct = (wetCount / depths.length) * 100;

  // If tag is consistently submerged (mean depth too high), it's not tidal — it's underwater
  if (meanDepth > MAX_MEAN_DEPTH_FOR_TIDAL) {
    return {
      detected: false,
      confidence: 0,
      reasoning: `Tag appears continuously submerged (mean depth ${meanDepth.toFixed(1)}m). Not a tidal pattern.`,
      wetPct,
      maxPostReleaseDepth: maxDepth,
      cyclePeriodHours: null,
    };
  }

  // If tag is always dry, no tidal flooding
  if (wetPct < 5) {
    return {
      detected: false,
      confidence: 0,
      reasoning: `Tag is consistently dry (depth <${DRY_THRESHOLD_M}m in ${(100 - wetPct).toFixed(0)}% of readings). Above tide line.`,
      wetPct,
      maxPostReleaseDepth: maxDepth,
      cyclePeriodHours: null,
    };
  }

  // If tag is always wet, might be submerged near tide line
  if (wetPct > 95) {
    return {
      detected: false,
      confidence: 0.3,
      reasoning: `Tag is consistently wet (depth >${DRY_THRESHOLD_M}m in ${wetPct.toFixed(0)}% of readings). Likely submerged below the tide line.`,
      wetPct,
      maxPostReleaseDepth: maxDepth,
      cyclePeriodHours: null,
    };
  }

  // Periodicity analysis: compute autocorrelation on binary wet/dry signal
  // Check for peaks near 12h (semidiurnal) and 24h (diurnal)
  const firstT = points[0].t;
  const lastT = points[points.length - 1].t;
  const durationHours = (lastT - firstT) / (1000 * 60 * 60);

  if (durationHours < 18) {
    return {
      detected: true,
      confidence: 0.4,
      reasoning: `Tag is alternating wet (${wetPct.toFixed(0)}%) and dry (${(100 - wetPct).toFixed(0)}%). Insufficient duration (${durationHours.toFixed(1)}h) to confirm tidal periodicity, but pattern is consistent with tidal flooding.`,
      wetPct,
      maxPostReleaseDepth: maxDepth,
      cyclePeriodHours: null,
    };
  }

  const cyclePeriod = estimateCyclePeriod(points);

  // Tidal periods: semidiurnal ≈ 12.42h, diurnal ≈ 24.84h
  let confidence = 0.5;
  let periodLabel = 'irregular';
  if (cyclePeriod !== null) {
    if (cyclePeriod > 10 && cyclePeriod < 15) {
      confidence = 0.85;
      periodLabel = 'semidiurnal (~12h)';
    } else if (cyclePeriod > 22 && cyclePeriod < 27) {
      confidence = 0.75;
      periodLabel = 'diurnal (~24h)';
    } else {
      confidence = 0.4;
      periodLabel = `~${cyclePeriod.toFixed(1)}h`;
    }
  }

  return {
    detected: true,
    confidence,
    reasoning: `Tag is tidally flooded. Wet ${wetPct.toFixed(0)}% of the time, max depth ${maxDepth.toFixed(1)}m. Cycle period: ${periodLabel}.`,
    wetPct,
    maxPostReleaseDepth: maxDepth,
    cyclePeriodHours: cyclePeriod,
  };
}

/**
 * Estimate dominant cycle period via autocorrelation.
 * Converts depth series to binary wet/dry signal, resamples to 1-hour bins,
 * then finds the lag with peak autocorrelation in the tidal range.
 */
function estimateCyclePeriod(points: { t: number; d: number }[]): number | null {
  const firstT = points[0].t;
  const lastT = points[points.length - 1].t;
  const durationHours = (lastT - firstT) / (1000 * 60 * 60);

  // Resample to 1-hour bins with binary wet/dry values
  const bins = Math.floor(durationHours);
  if (bins < 20) return null;
  const signal: number[] = new Array(bins).fill(0);
  const counts: number[] = new Array(bins).fill(0);

  for (const p of points) {
    const binIdx = Math.min(
      bins - 1,
      Math.floor((p.t - firstT) / (1000 * 60 * 60))
    );
    signal[binIdx] += p.d > DRY_THRESHOLD_M ? 1 : 0;
    counts[binIdx] += 1;
  }

  // Average per bin
  const resampled = signal.map((v, i) => (counts[i] > 0 ? v / counts[i] : 0));
  const mean = resampled.reduce((s, v) => s + v, 0) / resampled.length;
  const centered = resampled.map((v) => v - mean);

  // Autocorrelation at tidal lags (6-30 hours)
  let bestLag = 0;
  let bestCorr = -Infinity;
  for (let lag = 6; lag <= Math.min(30, bins - 10); lag++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < bins - lag; i++) {
      sum += centered[i] * centered[i + lag];
      n++;
    }
    const corr = sum / n;
    if (corr > bestCorr) {
      bestCorr = corr;
      bestLag = lag;
    }
  }

  // Require positive autocorrelation above a small threshold
  if (bestCorr < 0.01 || bestLag === 0) return null;
  return bestLag;
}
