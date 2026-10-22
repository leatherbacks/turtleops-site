import { solarElevationDeg } from './solar';

/**
 * What surrounds a stopped tag, from how its temperature follows the air.
 *
 * Each reading is set against the air measured at that reading's own hour, as
 * waterMatch does for water. Against a single "air now" figure the comparison
 * says nothing: on 33938 a dawn reading of 25.0 °C after a cold front was
 * compared with that afternoon's 27.0 °C and came out "pattern doesn't match
 * any known environment", when the air at that hour was 22.8 °C.
 *
 * Paired by hour, the readings answer a question the mean cannot: does the
 * tag follow the air, or lag it? Something in the open, or in light shade,
 * follows within a degree or so. Something with walls and mass round it — a
 * garage, storage unit, building, boat cabin — swings less than the air does,
 * so it reads below the air on a warm day and above it on a cool night. 33938
 * did exactly that in a boat lockup at Melbourne Beach: 27.1 and 27.75 °C on
 * a 28 °C morning, 28.5 °C on a 27.2 °C evening, 25.0 °C at a 22.8 °C dawn.
 * A car in the sun runs far above the air by day; air conditioning holds
 * steady at room temperature whatever the air does.
 *
 * It needs the tag to be out of the water already: the sea buffers better than
 * any building, so a floating tag would read "buffered" too. The caller only
 * applies it once the water has been ruled out.
 */

export interface AirSample {
  date: Date;
  temperatureC: number;
}

export interface AirPair {
  date: Date;
  tagC: number;
  airC: number;
  /** tag minus air at the same moment. */
  deltaC: number;
}

export type AirVerdict = 'tracks_air' | 'buffered' | 'climate_controlled' | 'sun_heated' | 'unclear';

export interface AirMatchAnalysis {
  pairs: AirPair[];
  /** Where the air was measured; set by the caller that fetched it. */
  station?: string | null;
  stationDistanceKm?: number | null;
  /** Spread of the air over the paired readings. */
  airRangeC: number;
  tagRangeC: number;
  /**
   * How much of the air's swing the tag follows: the slope of tag against
   * air, both about their means. 1 tracks the air; near 0 ignores it.
   */
  follows: number | null;
  verdict: AirVerdict;
  reasoning: string;
}

/** A reading pairs with air measured within this long of it. */
const MAX_PAIR_GAP_MS = 90 * 60_000;
/** Within this of the air, reading by reading, the tag is in the air. */
const TRACK_TOLERANCE_C = 1.5;
/** The air must swing this much over the readings before a lag can show. */
const MIN_AIR_RANGE_C = 3;
/**
 * Following less than this share of the air's swing is buffered. A tag in the
 * open follows nearly all of it; 33938 in the lockup followed 58%, so the bar
 * sits clear of both rather than on either. The sign check beside it (above
 * the air when cool, nearer or below it when warm) does the rest.
 */
const BUFFERED_MAX_FOLLOWS = 0.7;
/** By day, this far above the air is sun on a dark case or a closed car. */
const SUN_HEAT_C = 6;

/** Air at a moment: interpolated between the samples either side, or the nearest within the gap. */
export function airAt(air: AirSample[], date: Date): number | null {
  const t = date.getTime();
  let before: AirSample | null = null;
  let after: AirSample | null = null;
  for (const s of air) {
    const st = s.date.getTime();
    if (st <= t && (!before || st > before.date.getTime())) before = s;
    if (st >= t && (!after || st < after.date.getTime())) after = s;
  }
  const near = (s: AirSample | null) => s !== null && Math.abs(s.date.getTime() - t) <= MAX_PAIR_GAP_MS;
  if (near(before) && near(after)) {
    const span = after!.date.getTime() - before!.date.getTime();
    if (span === 0) return before!.temperatureC;
    const w = (t - before!.date.getTime()) / span;
    return before!.temperatureC + w * (after!.temperatureC - before!.temperatureC);
  }
  if (near(before)) return before!.temperatureC;
  if (near(after)) return after!.temperatureC;
  return null;
}

export function analyzeAirMatch(
  readings: { date: Date; temperatureC: number }[],
  air: AirSample[],
  lat: number | null = null,
  lon: number | null = null
): AirMatchAnalysis | null {
  const pairs: AirPair[] = readings.flatMap((r) => {
    const a = airAt(air, r.date);
    return a === null ? [] : [{ date: r.date, tagC: r.temperatureC, airC: a, deltaC: r.temperatureC - a }];
  });
  if (pairs.length === 0) return null;

  const airs = pairs.map((p) => p.airC);
  const tags = pairs.map((p) => p.tagC);
  const airRangeC = Math.max(...airs) - Math.min(...airs);
  const tagRangeC = Math.max(...tags) - Math.min(...tags);
  const airMean = airs.reduce((a, b) => a + b, 0) / airs.length;
  const tagMean = tags.reduce((a, b) => a + b, 0) / tags.length;
  const sxx = airs.reduce((s, a) => s + (a - airMean) ** 2, 0);
  const sxy = pairs.reduce((s, p) => s + (p.airC - airMean) * (p.tagC - tagMean), 0);
  const follows = pairs.length >= 3 && airRangeC >= MIN_AIR_RANGE_C ? sxy / sxx : null;

  const coolest = pairs.reduce((a, b) => (b.airC < a.airC ? b : a));
  const warmest = pairs.reduce((a, b) => (b.airC > a.airC ? b : a));
  const sunHot =
    lat !== null && lon !== null
      ? pairs.filter((p) => p.deltaC >= SUN_HEAT_C && solarElevationDeg(p.date, lat, lon) > 10)
      : pairs.filter((p) => p.deltaC >= SUN_HEAT_C);
  const list = pairs
    .map((p) => `${p.tagC.toFixed(1)} against ${p.airC.toFixed(1)}°C`)
    .join(', ');

  let verdict: AirVerdict = 'unclear';
  let reasoning = `Paired with the air at each reading's hour: ${list}.`;

  if (sunHot.length > 0) {
    verdict = 'sun_heated';
    reasoning += ` By day it ran up to ${Math.max(...sunHot.map((p) => p.deltaC)).toFixed(1)}°C above the air, which is sun on the case or a closed space heating in the sun — a car, a dark box, a boat cabin.`;
  } else if (pairs.length >= 3 && tagRangeC <= 1.5 && airRangeC >= 4 && tagMean >= 19 && tagMean <= 26) {
    verdict = 'climate_controlled';
    reasoning += ` The air swung ${airRangeC.toFixed(1)}°C and the tag ${tagRangeC.toFixed(1)}°C, holding near room temperature: air conditioning.`;
  } else if (follows !== null && follows <= BUFFERED_MAX_FOLLOWS && coolest.deltaC > 0 && warmest.deltaC < coolest.deltaC) {
    verdict = 'buffered';
    reasoning += ` It follows only ${Math.round(follows * 100)}% of the air's swing, reading ${coolest.deltaC >= 0 ? '+' : ''}${coolest.deltaC.toFixed(1)}°C when the air was coolest and ${warmest.deltaC >= 0 ? '+' : ''}${warmest.deltaC.toFixed(1)}°C when it was warmest. It lags the air: walls and mass round it, as in a garage, storage unit, building or boat cabin. Not open air, not a car in the sun, not air conditioning.`;
  } else if (pairs.every((p) => Math.abs(p.deltaC) <= TRACK_TOLERANCE_C) && (follows === null || follows > BUFFERED_MAX_FOLLOWS)) {
    verdict = 'tracks_air';
    reasoning += ` It stays within ${TRACK_TOLERANCE_C}°C of the air at every reading: open air or light shade — on the ground, under vegetation, in a carport.`;
  } else if (pairs.length < 3 || airRangeC < MIN_AIR_RANGE_C) {
    reasoning += ` The air moved ${airRangeC.toFixed(1)}°C across ${pairs.length} reading${pairs.length === 1 ? '' : 's'}; a lag needs three or more readings over a ${MIN_AIR_RANGE_C}°C swing to show.`;
  }

  return { pairs, airRangeC, tagRangeC, follows, verdict, reasoning };
}
