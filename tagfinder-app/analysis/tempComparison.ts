import type {
  SeriesReading,
  TagStatus,
  DeploySummary,
  TempComparison,
  TempEnvironment,
} from '@/lib/types';

interface TempSources {
  /** Most recent air temperature at the tag's position (°C) */
  airTempC: number | null;
  /** Most recent sea surface temperature at the tag's position (°C)
   *  — from SST.csv or environment API */
  sstTempC: number | null;
}

/**
 * Compare the tag's internal temperature to external references (air / SST)
 * to classify its environment. This helps disambiguate a stuck-on-land tag
 * from a floating-at-surface tag, or detect "in a car / inside a building"
 * signatures where the tag runs markedly warmer than ambient.
 */
export function compareTemperatures(
  seriesReadings: SeriesReading[],
  statuses: TagStatus[],
  summary: DeploySummary | null,
  sources: TempSources
): TempComparison {
  const releaseTime = summary?.releaseDate?.getTime() ?? null;

  // Prefer post-release Series readings (high-rate, calibrated sensor).
  // Fall back to Status reports if Series isn't available.
  const postReleaseSeries = releaseTime
    ? seriesReadings.filter((s) => s.date.getTime() > releaseTime && s.temperature !== null)
    : seriesReadings.filter((s) => s.temperature !== null);

  const tagTemps: number[] = postReleaseSeries
    .map((s) => s.temperature as number)
    .filter((t) => !isNaN(t));

  if (tagTemps.length === 0) {
    // Fall back to Status temperatures
    const statusTemps = (releaseTime
      ? statuses.filter((s) => s.date.getTime() > releaseTime)
      : statuses
    )
      .map((s) => s.temperature)
      .filter((t): t is number => t !== null && !isNaN(t));
    tagTemps.push(...statusTemps);
  }

  if (tagTemps.length === 0) {
    return {
      environment: 'insufficient',
      reasoning: 'No post-release tag temperature readings available.',
      tagTempRange: null,
      airTempC: sources.airTempC,
      sstTempC: sources.sstTempC,
      tagMinusSST: null,
      tagMinusAir: null,
      confidence: 0,
    };
  }

  const tagMin = Math.min(...tagTemps);
  const tagMax = Math.max(...tagTemps);
  const tagMean = tagTemps.reduce((a, b) => a + b, 0) / tagTemps.length;

  const tagMinusSST =
    sources.sstTempC !== null ? Number((tagMean - sources.sstTempC).toFixed(2)) : null;
  const tagMinusAir =
    sources.airTempC !== null ? Number((tagMean - sources.airTempC).toFixed(2)) : null;

  let environment: TempEnvironment;
  let reasoning: string;
  let confidence: number;

  // Heuristic classification
  // In-water: tag temp closely tracks SST (±2°C)
  // In-air exposed: tag temp tracks air temp (±3°C), diurnal swing visible
  // In-air insulated: tag temp warmer than both air and SST by several °C (vehicle, pocket, building)
  // Anomalous hot: tag is much warmer than any ambient — animal body heat, or inside a warm enclosure

  if (sources.sstTempC === null && sources.airTempC === null) {
    environment = 'unknown';
    reasoning = `Tag temperature ranges ${tagMin.toFixed(1)}–${tagMax.toFixed(
      1
    )}°C but no external reference (air or SST) is available to compare against.`;
    confidence = 0.2;
  } else if (tagMean > 32) {
    environment = 'anomalous_hot';
    reasoning = `Tag mean temperature is ${tagMean.toFixed(
      1
    )}°C — unusually warm. Likely held against a warm body (animal or human) or inside a heated enclosure.`;
    confidence = 0.75;
  } else if (tagMinusSST !== null && Math.abs(tagMinusSST) < 2) {
    environment = 'in_water';
    reasoning = `Tag mean ${tagMean.toFixed(1)}°C matches SST (${sources.sstTempC!.toFixed(
      1
    )}°C, Δ=${tagMinusSST > 0 ? '+' : ''}${tagMinusSST.toFixed(
      1
    )}°C). The tag is in or on the water.`;
    confidence = 0.85;
  } else if (tagMinusAir !== null && Math.abs(tagMinusAir) < 3 && (tagMinusSST === null || Math.abs(tagMinusSST) > 3)) {
    environment = 'in_air_exposed';
    reasoning = `Tag mean ${tagMean.toFixed(
      1
    )}°C tracks air temperature (${sources.airTempC!.toFixed(1)}°C, Δ=${
      tagMinusAir > 0 ? '+' : ''
    }${tagMinusAir.toFixed(
      1
    )}°C) rather than SST. The tag is out of water and exposed to air.`;
    confidence = 0.8;
  } else if (
    tagMinusAir !== null &&
    tagMinusAir > 4 &&
    (tagMinusSST === null || tagMinusSST > 4)
  ) {
    environment = 'in_air_insulated';
    reasoning = `Tag mean ${tagMean.toFixed(
      1
    )}°C is ${tagMinusAir.toFixed(1)}°C warmer than ambient air${
      sources.sstTempC !== null ? ` and ${tagMinusSST!.toFixed(1)}°C warmer than SST` : ''
    }. Suggests the tag is inside an insulated or heated space (vehicle, building, pocket).`;
    confidence = 0.7;
  } else {
    environment = 'unknown';
    reasoning = `Tag mean ${tagMean.toFixed(1)}°C${
      tagMinusSST !== null ? `, Δ vs SST ${tagMinusSST > 0 ? '+' : ''}${tagMinusSST.toFixed(1)}°C` : ''
    }${
      tagMinusAir !== null ? `, Δ vs air ${tagMinusAir > 0 ? '+' : ''}${tagMinusAir.toFixed(1)}°C` : ''
    } — pattern doesn't clearly match any known environment.`;
    confidence = 0.3;
  }

  return {
    environment,
    reasoning,
    tagTempRange: { min: tagMin, max: tagMax },
    airTempC: sources.airTempC,
    sstTempC: sources.sstTempC,
    tagMinusSST,
    tagMinusAir,
    confidence,
  };
}
