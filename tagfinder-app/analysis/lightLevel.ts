import type { LightCurve, LightAnalysis, LightPattern, DeploySummary } from '@/lib/types';

/**
 * Analyze LightLoc curves to detect whether the tag is buried, shaded, or
 * indoors. Wildlife Computers light-level samples are 0-250 (Argos scaled).
 * Open-air midday readings typically exceed 200; deep shade drops below 50;
 * buried tags read near zero even at solar noon.
 */
export function analyzeLightLevel(
  curves: LightCurve[],
  summary: DeploySummary | null
): LightAnalysis {
  if (curves.length === 0) {
    return {
      pattern: 'unknown',
      reasoning: 'No LightLoc.csv provided — cannot diagnose light environment.',
      confidence: 0,
      meanDaytimeLight: null,
      meanNighttimeLight: null,
      curveCount: 0,
      postReleaseCurveCount: 0,
    };
  }

  const releaseTime = summary?.releaseDate?.getTime() ?? null;
  const postRelease = releaseTime
    ? curves.filter((c) => c.date.getTime() > releaseTime)
    : curves;

  if (postRelease.length < 2) {
    return {
      pattern: 'insufficient',
      reasoning: `Only ${postRelease.length} LightLoc curve(s) available${
        releaseTime ? ' after release' : ''
      } — need at least 2 to diagnose.`,
      confidence: 0.2,
      meanDaytimeLight: null,
      meanNighttimeLight: null,
      curveCount: curves.length,
      postReleaseCurveCount: postRelease.length,
    };
  }

  // "Daytime" = Begin + End curves (start/end of daylight window)
  // "Dawn/Dusk" = transition samples; we'll use them as daytime-ish references
  // Begin/End are WC's reference brightness measurements at full daylight bounds.
  const daytimeSamples: number[] = [];
  const nighttimeSamples: number[] = [];

  for (const c of postRelease) {
    const peakLight = c.lightSamples.length > 0 ? Math.max(...c.lightSamples) : 0;
    const minLight = c.lightSamples.length > 0 ? Math.min(...c.lightSamples) : 0;

    if (c.type === 'Begin' || c.type === 'End') {
      // These are full-daylight reference readings
      daytimeSamples.push(peakLight);
    } else if (c.type === 'Dawn' || c.type === 'Dusk') {
      // Transition — peak should reflect sky condition at twilight
      daytimeSamples.push(peakLight);
      nighttimeSamples.push(minLight);
    }
  }

  const meanDay =
    daytimeSamples.length > 0
      ? daytimeSamples.reduce((a, b) => a + b, 0) / daytimeSamples.length
      : null;
  const meanNight =
    nighttimeSamples.length > 0
      ? nighttimeSamples.reduce((a, b) => a + b, 0) / nighttimeSamples.length
      : null;

  // Classify
  let pattern: LightPattern;
  let reasoning: string;
  let confidence: number;

  if (meanDay === null) {
    pattern = 'insufficient';
    reasoning = 'No daytime (Begin/End/Dawn/Dusk) samples after release.';
    confidence = 0.2;
  } else if (meanDay < 5) {
    // Essentially no light even during daylight window
    pattern = 'fully_dark';
    reasoning = `Mean peak daytime light is ${meanDay.toFixed(
      1
    )} (essentially zero). The tag is entirely dark — buried deep, inside an opaque container, or with a fully obstructed light sensor.`;
    confidence = 0.9;
  } else if (meanDay < 30) {
    pattern = 'buried';
    reasoning = `Mean peak daytime light is only ${meanDay.toFixed(
      1
    )} (open-air midday typically exceeds 200). Consistent with the tag being buried under sand or sediment, where only diffuse light filters through.`;
    confidence = 0.85;
  } else if (meanDay < 100) {
    pattern = 'shaded';
    reasoning = `Mean peak daytime light is ${meanDay.toFixed(
      1
    )} — well below open-water values. The tag is likely under tree canopy, inside a sheltered building, or partially obscured.`;
    confidence = 0.7;
  } else if (meanNight !== null && meanNight > 40) {
    // Nighttime readings that shouldn't exist — suggests artificial lighting
    pattern = 'indoor';
    reasoning = `Daytime light is ${meanDay.toFixed(1)} but nighttime light is also elevated (${meanNight.toFixed(
      1
    )}). Artificial lighting at night suggests the tag is indoors or under streetlights.`;
    confidence = 0.75;
  } else {
    pattern = 'normal_diurnal';
    reasoning = `Normal diurnal pattern — daytime peak ${meanDay.toFixed(
      1
    )}${meanNight !== null ? `, nighttime ${meanNight.toFixed(1)}` : ''}. Consistent with open sky/water exposure.`;
    confidence = 0.85;
  }

  return {
    pattern,
    reasoning,
    confidence,
    meanDaytimeLight: meanDay,
    meanNighttimeLight: meanNight,
    curveCount: curves.length,
    postReleaseCurveCount: postRelease.length,
  };
}
