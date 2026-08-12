import type { ArgosFix, DriftPrediction } from '@/lib/types';
import { haversineKm, project } from '@/lib/haversine';
import { PREDICTION_HOURS } from '@/lib/constants';
import { getHighQualityFixes } from './quality';

/**
 * Hours of track used to fit the drift vector.
 *
 * This is a time window, deliberately not a fix count. Counting fixes was the
 * original approach and it fails badly on a fast-reporting tag: the last five
 * high-quality fixes from a reference PSAT+ deployment spanned 50 minutes and 321 m of net
 * movement, against Argos errors of 514-762 m. The displacement was smaller
 * than the noise, so the fitted heading was pure noise — it reported the tag
 * drifting south-southwest at 1.0 km/h when it was in fact tracking north at
 * roughly 0.2 km/h, and projected it 24 km inland.
 */
const DRIFT_WINDOW_HOURS = 12;
/** Widen the window rather than fit fewer points than this. */
const MIN_FIXES_FOR_FIT = 4;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32;

/**
 * Predict future positions for a drifting tag.
 *
 * Fits a least-squares velocity over the recent track rather than averaging
 * per-segment speeds. Consecutive Argos fixes are often only minutes apart, so
 * position noise between them implies several km/h of apparent travel, and
 * averaging those segments lets the noise dominate both speed and heading.
 *
 * Returns null when drift cannot be resolved above the fix error — refusing to
 * predict is far better than emitting a confident vector built from noise.
 */
export function predictDrift(fixes: ArgosFix[]): DriftPrediction | null {
  const hqFixes = getHighQualityFixes(fixes);
  if (hqFixes.length < 2) return null;

  const lastFix = hqFixes[hqFixes.length - 1];

  // Take a time window; widen to a minimum fix count if the tag reports slowly.
  const cutoff = lastFix.date.getTime() - DRIFT_WINDOW_HOURS * 3_600_000;
  let window = hqFixes.filter((f) => f.date.getTime() >= cutoff);
  if (window.length < MIN_FIXES_FOR_FIT) {
    window = hqFixes.slice(-Math.min(MIN_FIXES_FOR_FIT, hqFixes.length));
  }
  if (window.length < 2) return null;

  const t0 = window[0].date.getTime();
  const hours = window.map((f) => (f.date.getTime() - t0) / 3_600_000);
  const spanHours = hours[hours.length - 1];
  if (spanHours <= 0) return null;

  // Least-squares velocity in degrees per hour.
  const dLatPerHour = slope(hours, window.map((f) => f.latitude));
  const dLonPerHour = slope(hours, window.map((f) => f.longitude));

  const meanLatRad = (window.reduce((s, f) => s + f.latitude, 0) / window.length) * (Math.PI / 180);
  const northKmH = dLatPerHour * KM_PER_DEG_LAT;
  const eastKmH = dLonPerHour * KM_PER_DEG_LON * Math.cos(meanLatRad);

  const avgSpeed = Math.hypot(northKmH, eastKmH);
  const avgHeading = ((Math.atan2(eastKmH, northKmH) * 180) / Math.PI + 360) % 360;

  // Is the movement bigger than our ability to measure it? Compare the fitted
  // displacement across the window against typical fix error.
  const fittedDisplacementM = avgSpeed * spanHours * 1000;
  const errors = window.map((f) => f.effectiveError).sort((a, b) => a - b);
  const medianErrorM = errors[Math.floor(errors.length / 2)];
  if (fittedDisplacementM < medianErrorM) return null;

  // Uncertainty from scatter about the fitted line.
  const residualsKm = window.map((f, i) => {
    const expected = project(
      window[0].latitude,
      window[0].longitude,
      avgHeading,
      avgSpeed * hours[i]
    );
    return haversineKm(expected.lat, expected.lon, f.latitude, f.longitude);
  });
  const meanResidualKm = residualsKm.reduce((s, r) => s + r, 0) / residualsKm.length;
  const speedStd = Math.max(meanResidualKm / spanHours, avgSpeed * 0.25);

  const predictions = PREDICTION_HOURS.map((h) => {
    const { lat, lon } = project(
      lastFix.latitude,
      lastFix.longitude,
      avgHeading,
      avgSpeed * h
    );
    const uncertaintyRadiusKm = lastFix.effectiveError / 1000 + speedStd * h;
    return { hoursAhead: h, lat, lon, uncertaintyRadiusKm };
  });

  return {
    speedKmH: avgSpeed,
    headingDeg: avgHeading,
    fitFrom: window[0].date,
    fitTo: lastFix.date,
    predictions,
  };
}

/** Ordinary least-squares slope of y on x. */
function slope(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - meanX) * (y[i] - meanY);
    den += (x[i] - meanX) ** 2;
  }
  return den === 0 ? 0 : num / den;
}
