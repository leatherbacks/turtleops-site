/**
 * Longitude from the tag's own solar-noon estimate.
 *
 * Lotek's day-log longitude fields are not longitudes. They are the minute of
 * the UTC day at which the tag saw solar noon, one for each latitude solution.
 * Longitude follows from the time of local noon: the sun crosses a meridian
 * four minutes later for every degree west of Greenwich, corrected by the
 * equation of time — the seasonal drift, up to ±16 minutes, between clock noon
 * and sun noon.
 *
 *   longitude = (720 − noonMinute − equationOfTime) / 4
 *
 * This is what the CSV parser's note that "predicting solar noon from TFLon
 * reproduces TFNoon to within 4–5 minutes" was seeing: the residual it could
 * not close was the equation of time. With it applied, the formula reproduces
 * the manufacturer's own longitude to within 0.16° on every day of two
 * deployments (20 days of one, 15 of another), the remainder being their
 * rounding to 0.1° and the noon field's one-minute resolution. That closes the
 * "longitude is not decoded" gap in the offload day-log parser.
 */

const MINUTES_PER_DEGREE = 4;
const NOON_UTC_MINUTES = 720;
const MINUTES_PER_DAY = 1440;

/**
 * Equation of time in minutes for a calendar date (UTC), positive when the sun
 * runs ahead of the clock. Spencer-style three-term approximation, accurate to
 * about half a minute, which is far inside the noon field's own resolution.
 */
export function equationOfTimeMinutes(date: Date): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = Math.floor((date.getTime() - start) / 86_400_000) + 1;
  const b = (2 * Math.PI * (dayOfYear - 81)) / 365;
  return 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);
}

/**
 * Longitude in degrees east from a solar-noon minute of the UTC day, or null
 * when the field holds no reading (outside a day, or the 0xFFFF / 0 sentinels).
 */
export function longitudeFromNoonMinute(noonMinute: number, date: Date): number | null {
  if (!Number.isFinite(noonMinute) || noonMinute <= 0 || noonMinute >= MINUTES_PER_DAY) return null;
  const lon = (NOON_UTC_MINUTES - noonMinute - equationOfTimeMinutes(date)) / MINUTES_PER_DEGREE;
  return Number(lon.toFixed(2));
}
