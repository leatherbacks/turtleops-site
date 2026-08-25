import type { SeriesReading, DiveProfile } from '@/lib/types';
import { screenIsolatedDepths } from './depthScreen';

const MAX_DISPLAY_POINTS = 300;
const SURFACE_DEPTH_THRESHOLD = 1; // meters — below this is "at surface"

/**
 * Build a dive profile summary from Series.csv readings.
 * Downsamples to MAX_DISPLAY_POINTS for rendering.
 */
export function buildDiveProfile(readings: SeriesReading[]): DiveProfile | null {
  const allWithDepth = readings.filter((r) => r.depth !== null);
  if (allWithDepth.length === 0) return null;

  // A corrupt decode reading 32 m in an otherwise flat surface record is not a
  // dive, and quoting it as the maximum is the single most misleading number
  // this panel can produce.
  const screen = screenIsolatedDepths(
    allWithDepth,
    (r) => r.depth!,
    (r) => r.date.getTime()
  );
  const withDepth = screen.kept.length > 0 ? screen.kept : allWithDepth;

  const depths = withDepth.map((r) => r.depth!);
  const temps = readings
    .filter((r) => r.temperature !== null)
    .map((r) => r.temperature!);

  const maxDepth = Math.max(...depths);
  const avgDepth = depths.reduce((s, v) => s + v, 0) / depths.length;
  const surfaceCount = depths.filter((d) => d < SURFACE_DEPTH_THRESHOLD).length;
  const surfaceTimePct = (surfaceCount / depths.length) * 100;

  const tempRange =
    temps.length > 0
      ? { min: Math.min(...temps), max: Math.max(...temps) }
      : null;

  // Downsample by taking evenly-spaced points
  // The chart must not contradict the stats above it. The screen removed the
  // isolated corrupt depths from every number, but the plotted series bypassed
  // it, so one report showed "MAX 0.0 m" over a line dipping to 32 m with the
  // axis labelled from the corrupt value. Rejected depths plot as gaps; their
  // temperatures are genuine and stay.
  const rejected = new Set(screen.rejected);
  const displaySeries = downsample(readings, MAX_DISPLAY_POINTS).map((r) => ({
    date: r.date,
    depth: rejected.has(r) ? null : r.depth,
    temp: r.temperature,
  }));

  return {
    totalReadings: readings.length,
    firstReading: readings[0].date,
    lastReading: readings[readings.length - 1].date,
    maxDepth,
    screenedReadings: screen.rejected.length,
    screenNote: screen.reason,
    avgDepth,
    tempRange,
    surfaceTimePct,
    displaySeries,
  };
}

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = arr.length / maxPoints;
  const result: T[] = [];
  for (let i = 0; i < maxPoints; i++) {
    result.push(arr[Math.floor(i * step)]);
  }
  return result;
}
