import type { SeriesReading, DiveProfile } from '@/lib/types';

const MAX_DISPLAY_POINTS = 300;
const SURFACE_DEPTH_THRESHOLD = 1; // meters — below this is "at surface"

/**
 * Build a dive profile summary from Series.csv readings.
 * Downsamples to MAX_DISPLAY_POINTS for rendering.
 */
export function buildDiveProfile(readings: SeriesReading[]): DiveProfile | null {
  const withDepth = readings.filter((r) => r.depth !== null);
  if (withDepth.length === 0) return null;

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
  const displaySeries = downsample(readings, MAX_DISPLAY_POINTS).map((r) => ({
    date: r.date,
    depth: r.depth,
    temp: r.temperature,
  }));

  return {
    totalReadings: readings.length,
    firstReading: readings[0].date,
    lastReading: readings[readings.length - 1].date,
    maxDepth,
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
