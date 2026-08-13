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
/**
 * Diurnal swing above which the tag cannot be immersed.
 *
 * The sea's thermal mass holds a submerged object within roughly a degree over a
 * day; air carries it through several. This is the discriminator that works even
 * where air and sea temperatures sit close together, which on a summer coast is
 * most of the time.
 */
const AIR_SWING_MIN_C = 4;
/** Readings needed before a swing means anything. */
const MIN_READINGS_FOR_SWING = 5;

/**
 * Above this count a trimmed swing is computed alongside the raw one — not to
 * replace it, but to detect when the verdict is resting on a single reading at
 * each end and flag the result as weaker. See the note where it is computed.
 */
const MIN_READINGS_FOR_TRIMMED_SWING = 10;

export function compareTemperatures(
  seriesReadings: SeriesReading[],
  statuses: TagStatus[],
  summary: DeploySummary | null,
  sources: TempSources
): TempComparison {
  const releaseTime = summary?.releaseDate?.getTime() ?? null;

  if (releaseTime === null) {
    return {
      environment: 'insufficient',
      reasoning:
        "Summary.csv has no ReleaseDate — can't separate pre-release (in-water on the animal) temperatures from post-release (current environment) temperatures. Classifying without that filter would produce a misleading verdict.",
      tagTempRange: null,
      airTempC: sources.airTempC,
      sstTempC: sources.sstTempC,
      tagMinusSST: null,
      tagMinusAir: null,
      confidence: 0,
    };
  }

  // Prefer post-release Series readings (high-rate, calibrated sensor).
  // Fall back to Status reports if Series isn't available.
  const postReleaseSeries = seriesReadings.filter(
    (s) => s.date.getTime() > releaseTime && s.temperature !== null
  );

  const tagTemps: number[] = postReleaseSeries
    .map((s) => s.temperature as number)
    .filter((t) => !isNaN(t));

  if (tagTemps.length === 0) {
    // Fall back to Status temperatures (post-release only)
    const statusTemps = statuses
      .filter((s) => s.date.getTime() > releaseTime)
      .map((s) => s.temperature)
      .filter((t): t is number => t !== null && !isNaN(t));
    tagTemps.push(...statusTemps);
  }

  if (tagTemps.length === 0) {
    return {
      environment: 'insufficient',
      reasoning:
        'No post-release tag temperature readings have come through yet — the tag may still be replaying its pre-release archive.',
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

  const tagSwing = tagMax - tagMin;

  // Trimming the extremes was tried here and reverted. It is the obvious guard
  // against one corrupt record inventing a swing, and it is wrong for this data:
  // a tag heard a few times a day represents each end of the diurnal cycle with
  // a SINGLE reading, so the trim deletes the evidence rather than the noise. On
  // a tag later recovered lying in the open it turned a correct "out of the
  // water" into "in the water" — the 28.5 °C before dawn and 32.7 °C at midday
  // were both genuine.
  //
  // Temperature alone cannot separate a corrupt extreme from a real diurnal one
  // at this sampling rate; nothing in this series says which it is. What does is
  // an external reference — see analysis/waterMatch, which compares each reading
  // against water temperature at that reading's own moment and can therefore
  // judge a single reading on its own merits. The confidence below is lowered
  // when this verdict rests on one reading at each end, so the brief knows to
  // defer.
  const sortedTemps = [...tagTemps].sort((a, b) => a - b);
  const trimmedSwing =
    sortedTemps.length >= MIN_READINGS_FOR_TRIMMED_SWING
      ? sortedTemps[sortedTemps.length - 2] - sortedTemps[1]
      : tagSwing;
  const swingRestsOnExtremes =
    tagSwing > 0 && trimmedSwing < tagSwing * 0.5;

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
  // In-air insulated: tag temp warmer than both air and SST by several °C (vehicle, pocket,
  // building) Anomalous hot: tag is much warmer than any ambient — animal body heat, or inside a
  // warm enclosure

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
  } else if (tagSwing >= AIR_SWING_MIN_C && tagTemps.length >= MIN_READINGS_FOR_SWING) {
    // Checked BEFORE any mean comparison, because the mean is the weaker signal
    // and on a coast the two references sit close together: a tag whose mean
    // lands between air and sea will "match" SST within a couple of degrees no
    // matter where it actually is.
    //
    // The swing does not have that problem. The sea is a huge thermal reservoir,
    // so anything immersed in it holds within about a degree across a day. A
    // body in air follows the diurnal cycle and swings several. A tag reporting
    // a 7 C range is therefore not in the water, whatever its average says —
    // and reporting "in water" from a mean that sat 1.6 C from SST is exactly
    // the error this replaces.
    environment = 'in_air_exposed';
    reasoning =
      `Tag temperature ranges ${tagMin.toFixed(1)}–${tagMax.toFixed(1)}°C, a swing of ` +
      `${tagSwing.toFixed(1)}°C across ${tagTemps.length} post-release readings. Water is ` +
      `too large a thermal reservoir to allow that — anything immersed holds within about a ` +
      `degree over a day — so the tag is out of the water and following air temperature` +
      (tagMinusAir !== null
        ? ` (mean ${tagMean.toFixed(1)}°C against air ${sources.airTempC!.toFixed(1)}°C)`
        : '') +
      // Deliberately NOT "expect it to be visible". Both tags recovered from
      // this programme were out of the water and neither was seen until the
      // finder was standing over it — one wedged in a seawall corner, one lying
      // in dark wrack at a waterline. A popped tag is small, matte and dark
      // against exactly the substrates it strands on. Telling a field team to
      // expect a visual find sends them sweeping open ground with their eyes
      // instead of closing on the beacon, which is what actually worked.
      `. Out of the water does NOT mean easy to see: recovered tags of this type` +
      ` have been invisible until the searcher was on top of them. Plan on homing` +
      ` the recovery beacon rather than spotting the tag.` +
      (swingRestsOnExtremes
        ? ` Note the swing rests on a single reading at each end — with only ${tagTemps.length}` +
          ` readings a corrupt one cannot be told from a real diurnal peak here, so treat the` +
          ` water-temperature comparison as the stronger test where it is available.`
        : '');
    confidence = swingRestsOnExtremes ? 0.6 : 0.85;
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
  } else if (
    tagMinusAir !== null &&
    tagMinusAir < -4 &&
    tagMean >= 15 &&
    tagMean <= 26
  ) {
    // Tag notably cooler than outside air AND in a comfortable indoor range (~15-26°C)
    // = air-conditioned space, cooler, or refrigerator.
    environment = 'air_conditioned';
    reasoning = `Tag mean ${tagMean.toFixed(
      1
    )}°C is ${Math.abs(tagMinusAir).toFixed(
      1
    )}°C COOLER than ambient air (${sources.airTempC!.toFixed(
      1
    )}°C), and sits in a typical indoor climate-control range. Strongly suggests the tag is inside an air-conditioned building, a cooler, or a refrigerator.`;
    confidence = 0.8;
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
