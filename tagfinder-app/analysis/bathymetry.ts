import type { Bathymetry, SeriesReading, TagStatus, DeploySummary } from '@/lib/types';

interface BathymetryInput {
  seabedDepthM: number | null; // positive = meters below sea level; null = on land
  source: 'gebco' | 'unavailable';
}

/**
 * Compare the tag's reported depth to the seabed depth at its position.
 * If the tag is sitting at ~seabed depth, it's on the bottom (sunk/crushed
 * at bottom). If the tag is at 0m but seabed is 40m below, it's floating at
 * the surface.
 */
export function analyzeBathymetry(
  input: BathymetryInput,
  seriesReadings: SeriesReading[],
  statuses: TagStatus[],
  summary: DeploySummary | null
): Bathymetry {
  const { seabedDepthM, source } = input;

  if (source === 'unavailable' || seabedDepthM === null) {
    return {
      seabedDepthM: null,
      source: 'unavailable',
      interpretation:
        seabedDepthM === null && source === 'gebco'
          ? 'Position is on land (above sea level) per GEBCO.'
          : 'Seabed depth unavailable for this position.',
      tagOnSeabed: false,
    };
  }

  const releaseTime = summary?.releaseDate?.getTime() ?? null;

  // Without a release date, a depth series cannot be attributed to the tag's
  // current situation — it is the animal's dive record. Comparing that against
  // the seabed under the tag's present position produces a confident
  // nonsense: a reference PSAT+ deployment reported "tag mean depth 79.3 m, in the water column"
  // from July diving while the tag was ashore. Status readings are exempt,
  // being the tag describing itself rather than the animal.
  const seriesUsable = releaseTime !== null;
  const postReleaseDepths = (
    seriesUsable
      ? seriesReadings.filter((s) => s.date.getTime() > (releaseTime as number))
      : []
  )
    .map((s) => s.depth)
    .filter((d): d is number => d !== null && !isNaN(d));

  const statusDepths = (releaseTime
    ? statuses.filter((s) => s.date.getTime() > releaseTime)
    : statuses
  )
    .map((s) => s.depth)
    .filter((d): d is number => d !== null && !isNaN(d));

  const depths = postReleaseDepths.length > 0 ? postReleaseDepths : statusDepths;

  if (depths.length === 0) {
    return {
      seabedDepthM,
      source,
      interpretation:
        seriesReadings.length > 0 && !seriesUsable
          ? `Seabed at this position is ${seabedDepthM.toFixed(0)}m deep. The ` +
            `depth series cannot be compared against it without a release date — ` +
            `those readings are the animal's dive record, not the tag's current depth.`
          : `Seabed at this position is ${seabedDepthM.toFixed(0)}m deep, but no ` +
            `post-release tag depth readings are available to compare.`,
      tagOnSeabed: false,
    };
  }

  const maxTagDepth = Math.max(...depths);
  const meanTagDepth = depths.reduce((a, b) => a + b, 0) / depths.length;

  // Consider the tag "on the seabed" if its max depth is within 15m of bathymetry
  // (GEBCO has ~450m horizontal resolution so depth can easily differ locally).
  const depthDelta = Math.abs(seabedDepthM - maxTagDepth);
  const tagOnSeabed = depthDelta < 15 && maxTagDepth > 5;

  let interpretation: string;
  if (tagOnSeabed) {
    interpretation = `Tag max depth (${maxTagDepth.toFixed(
      1
    )}m) is at the seabed (${seabedDepthM.toFixed(
      0
    )}m per GEBCO, Δ=${depthDelta.toFixed(
      1
    )}m). Tag is resting on or near the bottom — likely crushed, sunk, or anchored.`;
  } else if (meanTagDepth < 2 && seabedDepthM > 20) {
    interpretation = `Tag is near the surface (mean depth ${meanTagDepth.toFixed(
      1
    )}m) but seabed is ${seabedDepthM.toFixed(
      0
    )}m deep. Tag is floating rather than sunk.`;
  } else if (seabedDepthM < 5) {
    interpretation = `Seabed at this position is only ${seabedDepthM.toFixed(
      1
    )}m deep — shallow water, intertidal zone, or sandbar.`;
  } else {
    interpretation = `Seabed depth ${seabedDepthM.toFixed(
      0
    )}m; tag mean depth ${meanTagDepth.toFixed(
      1
    )}m (max ${maxTagDepth.toFixed(1)}m). Tag is in the water column, not at the bottom.`;
  }

  return {
    seabedDepthM,
    source,
    interpretation,
    tagOnSeabed,
  };
}
