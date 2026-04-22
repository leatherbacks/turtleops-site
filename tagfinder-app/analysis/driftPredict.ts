import type { ArgosFix, DriftPrediction } from '@/lib/types';
import { haversineKm, bearing, project } from '@/lib/haversine';
import { PREDICTION_HOURS, DRIFT_TRAJECTORY_FIX_COUNT } from '@/lib/constants';
import { getHighQualityFixes } from './quality';

/**
 * Predict future positions for a drifting tag.
 * Uses the last N high-quality fixes to compute drift speed and heading,
 * then extrapolates forward with an expanding uncertainty cone.
 */
export function predictDrift(fixes: ArgosFix[]): DriftPrediction | null {
  const hqFixes = getHighQualityFixes(fixes);
  if (hqFixes.length < 2) return null;

  // Use last N fixes for trajectory
  const recent = hqFixes.slice(-DRIFT_TRAJECTORY_FIX_COUNT);
  if (recent.length < 2) return null;

  // Compute segment speeds and headings
  const segments: { speedKmH: number; headingDeg: number }[] = [];

  for (let i = 1; i < recent.length; i++) {
    const dist = haversineKm(
      recent[i - 1].latitude,
      recent[i - 1].longitude,
      recent[i].latitude,
      recent[i].longitude
    );
    const hours =
      (recent[i].date.getTime() - recent[i - 1].date.getTime()) /
      (1000 * 60 * 60);

    if (hours <= 0) continue;

    const hdg = bearing(
      recent[i - 1].latitude,
      recent[i - 1].longitude,
      recent[i].latitude,
      recent[i].longitude
    );

    segments.push({ speedKmH: dist / hours, headingDeg: hdg });
  }

  if (segments.length === 0) return null;

  // Average speed and heading (circular mean for heading)
  const avgSpeed =
    segments.reduce((s, seg) => s + seg.speedKmH, 0) / segments.length;

  const avgHeading = circularMean(segments.map((s) => s.headingDeg));

  // Speed variance for uncertainty cone
  const speedVariance =
    segments.length > 1
      ? segments.reduce((s, seg) => s + (seg.speedKmH - avgSpeed) ** 2, 0) /
        (segments.length - 1)
      : avgSpeed * 0.5; // fallback: 50% uncertainty
  const speedStd = Math.sqrt(speedVariance);

  // Last known position
  const lastFix = recent[recent.length - 1];

  // Project forward at each prediction interval
  const predictions = PREDICTION_HOURS.map((hours) => {
    const distanceKm = avgSpeed * hours;
    const { lat, lon } = project(
      lastFix.latitude,
      lastFix.longitude,
      avgHeading,
      distanceKm
    );

    // Uncertainty grows with time: base error + speed uncertainty × time
    const baseUncertaintyKm = lastFix.effectiveError / 1000;
    const uncertaintyRadiusKm = baseUncertaintyKm + speedStd * hours;

    return { hoursAhead: hours, lat, lon, uncertaintyRadiusKm };
  });

  return {
    speedKmH: avgSpeed,
    headingDeg: avgHeading,
    predictions,
  };
}

/** Circular mean of angles in degrees */
function circularMean(angles: number[]): number {
  let sinSum = 0;
  let cosSum = 0;
  for (const a of angles) {
    const rad = (a * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const meanRad = Math.atan2(sinSum / angles.length, cosSum / angles.length);
  return ((meanRad * 180) / Math.PI + 360) % 360;
}
