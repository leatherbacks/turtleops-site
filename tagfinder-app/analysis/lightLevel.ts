import type { LightCurve, LightAnalysis, LightPattern, DeploySummary } from '@/lib/types';

/**
 * Analyze LightLoc curves to detect whether the tag is buried, shaded, or
 * indoors. Wildlife Computers light-level samples are 0–250 (Argos scaled).
 * Open-air midday readings typically exceed 200; deep shade drops below 50;
 * buried tags read near zero even at solar noon.
 *
 * Only post-release curves are diagnostic of the tag's CURRENT environment.
 * Pre-release curves reflect the animal's water column, not where the tag sits
 * after popoff. If the summary has no release date we cannot safely filter,
 * so we refuse to classify rather than risk a false positive.
 *
 * Indoor/artificial-light detection requires a TRUE nighttime reading. Dawn
 * and Dusk curves only span the solar transition — their minimum samples are
 * pre-sunrise or post-sunset twilight, NOT true darkness, and routinely
 * register 60–100 light units even in open sky. To avoid the false "indoor"
 * that results from treating twilight as night, we only trust indoor signals
 * when Begin/End curves (which can include true dark samples) are present.
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

  if (releaseTime === null) {
    return {
      pattern: 'insufficient',
      reasoning: `Summary.csv has no ReleaseDate — can't separate pre-release (in-water) curves from post-release (current environment) curves. ${curves.length} total curves available but none can be confidently attributed to the tag's current state.`,
      confidence: 0.1,
      meanDaytimeLight: null,
      meanNighttimeLight: null,
      curveCount: curves.length,
      postReleaseCurveCount: 0,
    };
  }

  const postRelease = curves.filter((c) => c.date.getTime() > releaseTime);

  if (postRelease.length < 2) {
    return {
      pattern: 'insufficient',
      reasoning: `Only ${postRelease.length} LightLoc curve(s) after release — need at least 2 to diagnose.`,
      confidence: 0.2,
      meanDaytimeLight: null,
      meanNighttimeLight: null,
      curveCount: curves.length,
      postReleaseCurveCount: postRelease.length,
    };
  }

  // Collect daytime peaks — prefer Begin/End over Dawn/Dusk since they're
  // full-daylight references, not transitional.
  const daytimeSamplesBeginEnd: number[] = [];
  const daytimeSamplesDawnDusk: number[] = [];
  // True-darkness samples only come from Begin/End curves configured to span
  // the full day (which includes the dark portion). Dawn/Dusk mins are
  // twilight, not true night.
  const trueNightSamples: number[] = [];

  for (const c of postRelease) {
    if (c.lightSamples.length === 0) continue;
    const peakLight = Math.max(...c.lightSamples);
    const minLight = Math.min(...c.lightSamples);

    if (c.type === 'Begin' || c.type === 'End') {
      daytimeSamplesBeginEnd.push(peakLight);
      trueNightSamples.push(minLight);
    } else if (c.type === 'Dawn' || c.type === 'Dusk') {
      daytimeSamplesDawnDusk.push(peakLight);
      // Intentionally NOT adding min to trueNightSamples — this is twilight
    }
  }

  const daytimeSamples =
    daytimeSamplesBeginEnd.length > 0
      ? daytimeSamplesBeginEnd
      : daytimeSamplesDawnDusk;
  const daytimeKind =
    daytimeSamplesBeginEnd.length > 0 ? 'Begin/End' : 'Dawn/Dusk';

  const meanDay =
    daytimeSamples.length > 0
      ? daytimeSamples.reduce((a, b) => a + b, 0) / daytimeSamples.length
      : null;
  const meanNight =
    trueNightSamples.length > 0
      ? trueNightSamples.reduce((a, b) => a + b, 0) / trueNightSamples.length
      : null;

  let pattern: LightPattern;
  let reasoning: string;
  let confidence: number;

  if (meanDay === null) {
    pattern = 'insufficient';
    reasoning = 'No usable daytime samples in post-release curves.';
    confidence = 0.2;
  } else if (meanDay < 5) {
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
    // Indoor requires TRUE nighttime (from Begin/End curves). Dawn/Dusk mins
    // are twilight and routinely elevated even in open sky.
    pattern = 'indoor';
    reasoning = `Daytime peak is ${meanDay.toFixed(
      1
    )} but even true nighttime light is elevated (${meanNight.toFixed(
      1
    )}). Artificial lighting at night suggests the tag is indoors or under streetlights.`;
    confidence = 0.75;
  } else {
    pattern = 'normal_diurnal';
    const nightStr =
      meanNight !== null
        ? `, true nighttime ${meanNight.toFixed(1)}`
        : daytimeKind === 'Dawn/Dusk'
          ? ' (no true nighttime samples — only Dawn/Dusk curves available, so indoor detection cannot run)'
          : '';
    reasoning = `Normal diurnal pattern — daytime peak ${meanDay.toFixed(
      1
    )}${nightStr}. Consistent with open sky/water exposure.`;
    confidence = daytimeKind === 'Begin/End' ? 0.85 : 0.55;
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
