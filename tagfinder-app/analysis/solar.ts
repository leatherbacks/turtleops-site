/**
 * Solar elevation at a position and instant.
 *
 * Needed because the question "is this tag in the water" is answered by whether
 * its temperature follows the sun, and that comparison has to be made against
 * where the sun actually was — not against clock time. A reading at 09:00 is
 * near solar noon in December and mid-morning in June, and a tag drifting
 * across a timezone boundary would otherwise have its day and night silently
 * swapped.
 *
 * Low-precision algorithm (NOAA / Astronomical Almanac "approximate" solar
 * position). Accurate to roughly 0.01 degrees over the years around 2000-2100,
 * which is several orders of magnitude better than this analysis needs: the
 * thresholds here are civil-twilight-scale, tens of degrees wide.
 */

const RAD = Math.PI / 180;

/** Below this the sun contributes no meaningful heating. */
export const NIGHT_ELEVATION_DEG = -6;
/** Above this the sun is unambiguously up and warming an exposed object. */
export const DAY_ELEVATION_DEG = 0;

export function solarElevationDeg(date: Date, lat: number, lon: number): number {
  const t = date.getTime();
  if (!Number.isFinite(t)) return NaN;

  // Days since J2000.0.
  const n = t / 86_400_000 + 2_440_587.5 - 2_451_545.0;

  const meanLon = (280.46 + 0.9856474 * n) % 360;
  const meanAnom = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const eclipticLon =
    (meanLon + 1.915 * Math.sin(meanAnom) + 0.02 * Math.sin(2 * meanAnom)) * RAD;
  const obliquity = (23.439 - 0.0000004 * n) * RAD;

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon));
  const rightAscension = Math.atan2(
    Math.cos(obliquity) * Math.sin(eclipticLon),
    Math.cos(eclipticLon)
  );

  // Greenwich mean sidereal time -> local hour angle.
  const gmstHours = (18.697374558 + 24.06570982441908 * n) % 24;
  const localSidereal = (gmstHours * 15 + lon) * RAD;
  const hourAngle = localSidereal - rightAscension;

  const sinEl =
    Math.sin(lat * RAD) * Math.sin(declination) +
    Math.cos(lat * RAD) * Math.cos(declination) * Math.cos(hourAngle);

  return Math.asin(Math.max(-1, Math.min(1, sinEl))) / RAD;
}

export type DayPhase = 'day' | 'night' | 'twilight';

/**
 * Twilight is deliberately a third category rather than being folded into one
 * side. It is the interval where an exposed object is neither being heated nor
 * has finished cooling, so its temperature says nothing either way — counting
 * those readings as "day" or "night" only dilutes the contrast that the
 * exposure test depends on.
 */
export function dayPhase(elevationDeg: number): DayPhase {
  if (!Number.isFinite(elevationDeg)) return 'twilight';
  if (elevationDeg > DAY_ELEVATION_DEG) return 'day';
  if (elevationDeg < NIGHT_ELEVATION_DEG) return 'night';
  return 'twilight';
}
