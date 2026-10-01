import { solarElevationDeg } from './solar';

/**
 * Was the heat the sun's doing?
 *
 * "Above 35 °C means indoors, a car or a window" was true in January and
 * wrong every summer. PSAT+ 47127 read 41.6 °C at 12:36 local on 23 Jul 2026
 * with the sun 77° up, lying in the wrack against a seawall at Ocean Ridge;
 * MiniPAT 40996 read 38.8 °C mid-morning on 1 Oct by a wrack pile at Waves NC.
 * Dry sand in full sun reaches 45–50 °C at the surface and a dark tag on it
 * gets hotter than the sand. Both tags were reported "picked up and taken
 * indoors" and the briefs sent searchers to knock on doors.
 *
 * The thermometer alone cannot tell a beach from a house at noon. It can at
 * night: a beach tag falls to air temperature after dark, a room stays warm,
 * and an air-conditioned room holds flat in the low twenties through the
 * afternoon. So every reading is judged against the sun's elevation at its
 * timestamp and position, and only heat the sun cannot explain counts.
 */

export interface DatedTemp {
  date: Date;
  temp: number;
}

export interface HeatVerdict {
  /** Readings above HOT_C with the sun high enough to explain them. */
  sunlitHot: number;
  /** Readings above HOT_C at night or low sun, or above any sun-on-sand reading. */
  unexplainedHot: number;
  /** Hottest reading with the sun below SUN_HEAT_MIN_ELEVATION_DEG. */
  nightMax: number | null;
  /** Readings at night or low sun. */
  nightCount: number;
  /** Flat in the low twenties across day and night: an air-conditioned room. */
  airConditioned: boolean;
  /** One sentence for the panels, or null when there is nothing hot to explain. */
  note: string | null;
}

/** Above this a reading needs explaining. */
export const HOT_C = 35;
/** The sun has to be at least this high to be blamed for a hot reading. */
export const SUN_HEAT_MIN_ELEVATION_DEG = 20;
/** Nothing on a beach reads this hot; only an enclosure does. */
export const BEYOND_SUN_C = 52;
/** Air-conditioned: this many readings over at least this span, within this range. */
const AC_MIN_READINGS = 6;
const AC_MIN_SPAN_H = 12;
const AC_MAX_RANGE_C = 3;
const AC_MEAN_MIN_C = 17;
const AC_MEAN_MAX_C = 28;

export function classifyHeat(readings: DatedTemp[], lat: number | null, lon: number | null): HeatVerdict {
  const valid = readings.filter((r) => !isNaN(r.date.getTime()) && Number.isFinite(r.temp));
  let sunlitHot = 0, unexplainedHot = 0, nightCount = 0;
  let nightMax: number | null = null;
  let hottestSunlit: { temp: number; elev: number; date: Date } | null = null;
  for (const r of valid) {
    const elev = lat !== null && lon !== null ? solarElevationDeg(r.date, lat, lon) : null;
    const sunHigh = elev !== null && elev >= SUN_HEAT_MIN_ELEVATION_DEG;
    if (elev !== null && !sunHigh) {
      nightCount++;
      if (nightMax === null || r.temp > nightMax) nightMax = r.temp;
    }
    if (r.temp <= HOT_C) continue;
    if (r.temp > BEYOND_SUN_C || !sunHigh) unexplainedHot++;
    else {
      sunlitHot++;
      if (!hottestSunlit || r.temp > hottestSunlit.temp) hottestSunlit = { temp: r.temp, elev: elev!, date: r.date };
    }
  }

  let airConditioned = false;
  if (valid.length >= AC_MIN_READINGS) {
    const times = valid.map((r) => r.date.getTime());
    const spanH = (Math.max(...times) - Math.min(...times)) / 3600_000;
    const temps = valid.map((r) => r.temp);
    const mean = temps.reduce((s, v) => s + v, 0) / temps.length;
    airConditioned =
      spanH >= AC_MIN_SPAN_H &&
      Math.max(...temps) - Math.min(...temps) <= AC_MAX_RANGE_C &&
      mean >= AC_MEAN_MIN_C && mean <= AC_MEAN_MAX_C;
  }

  let note: string | null = null;
  if (unexplainedHot > 0) {
    note = `${unexplainedHot} reading${unexplainedHot > 1 ? 's' : ''} above ${HOT_C} °C at night or in low sun — heat the sun cannot explain, so the tag is in a warm enclosure or against a warm body.`;
  } else if (hottestSunlit) {
    note = `The ${hottestSunlit.temp.toFixed(1)} °C reading at ${hottestSunlit.date.toISOString().slice(11, 16)} UTC came with the sun ${hottestSunlit.elev.toFixed(0)}° up: sun on an exposed surface, which dry sand and a dark tag reach in summer. It does not point indoors${nightCount === 0 ? '; no night reading exists to test that' : nightMax !== null ? `; the night readings top out at ${nightMax.toFixed(1)} °C` : ''}.`;
  } else if (airConditioned) {
    note = `Temperature holds within ${AC_MAX_RANGE_C} °C across day and night in the low twenties — an air-conditioned space, not a beach.`;
  }
  return { sunlitHot, unexplainedHot, nightMax, nightCount, airConditioned, note };
}
