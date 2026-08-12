import type { DriftPrediction, LandfallPrediction } from '@/lib/types';
import { haversineKm, project } from '@/lib/haversine';

/**
 * Where and when will a drifting tag come ashore?
 *
 * Straight-line drift extrapolation has no idea where land is, so it happily
 * projects a floating tag inland — the reference deployment's +24h point landed 21 m above
 * sea level on the barrier island. Rather than just suppressing that, walk the
 * predicted path and report the first crossing. For a recovery that is the more
 * useful answer: a tag drifting under sustained onshore wind is going to
 * strand, and where and when is exactly what a search team needs.
 *
 * Split into a pure path generator and a pure evaluator so the elevation
 * lookups happen in the UI layer, where network calls belong.
 */

/** Probe budget — matches the elevation route's batch cap, so one request. */
const MAX_PROBES = 64;
/**
 * Target spacing along the path. Fine enough to resolve a narrow barrier island
 * or a key; the Florida Keys in particular are a chain of small islands that a
 * coarse walk would step straight over.
 */
const TARGET_STEP_KM = 0.25;
/** Elevation above which a sample counts as land, allowing for datum noise. */
const LAND_ELEVATION_M = 1;

export interface ProbePoint {
  lat: number;
  lon: number;
  /** Hours after the last fix that the tag would reach this point. */
  hours: number;
  distanceKm: number;
}

export interface ProbeSample extends ProbePoint {
  /** Metres above sea level; null when the lookup failed for this point. */
  elevationM: number | null;
}

/**
 * Points to sample along the predicted drift path.
 *
 * Resolution is held at TARGET_STEP_KM and the *horizon* is shortened to fit
 * the probe budget, rather than spreading the same budget more thinly over a
 * longer path. A confident "no landfall within 8 hours" beats a vague landfall
 * 30 hours out that stepped over three islands to get there.
 */
export function landfallProbePath(
  prediction: DriftPrediction,
  fromLat: number,
  fromLon: number,
  maxHours = 72
): ProbePoint[] {
  const speed = prediction.speedKmH;
  if (!Number.isFinite(speed) || speed <= 0) return [];

  const budgetKm = MAX_PROBES * TARGET_STEP_KM;
  const horizonKm = Math.min(speed * maxHours, budgetKm);
  const steps = Math.max(1, Math.min(MAX_PROBES, Math.round(horizonKm / TARGET_STEP_KM)));
  const stepKm = horizonKm / steps;

  const points: ProbePoint[] = [];
  for (let i = 1; i <= steps; i++) {
    const distanceKm = stepKm * i;
    const { lat, lon } = project(fromLat, fromLon, prediction.headingDeg, distanceKm);
    points.push({ lat, lon, hours: distanceKm / speed, distanceKm });
  }
  return points;
}

/**
 * First land crossing along the sampled path.
 *
 * `hoursSinceLastFix` lets the result say whether the tag is predicted to have
 * *already* stranded — the common case by the time anyone runs the analysis,
 * and the one that most changes where a team searches.
 */
export function findLandfall(
  samples: ProbeSample[],
  prediction: DriftPrediction,
  hoursSinceLastFix: number
): LandfallPrediction | null {
  if (samples.length === 0) return null;

  const usable = samples.filter((s) => s.elevationM !== null);
  if (usable.length === 0) return null;

  const resolutionKm =
    samples.length > 1 ? samples[1].distanceKm - samples[0].distanceKm : samples[0].distanceKm;
  const horizonHours = samples[samples.length - 1].hours;

  const hit = usable.find((s) => (s.elevationM as number) >= LAND_ELEVATION_M);

  if (!hit) {
    return {
      willStrand: false,
      lat: null,
      lon: null,
      hoursFromLastFix: null,
      alreadyPassed: false,
      distanceKm: null,
      uncertaintyKm: null,
      resolutionKm,
      horizonHours,
      reasoning:
        `No landfall within ${formatHours(horizonHours)} of drift along the ` +
        `predicted heading (${Math.round(prediction.headingDeg)}°). The path stays ` +
        `over water for the ${samples[samples.length - 1].distanceKm.toFixed(1)} km sampled.`,
    };
  }

  // Cone width at the landfall time, interpolated from the prediction points.
  const uncertaintyKm = interpolateUncertainty(prediction, hit.hours);
  const alreadyPassed = hit.hours < hoursSinceLastFix;

  const when = alreadyPassed
    ? `about ${formatHours(hoursSinceLastFix - hit.hours)} ago, ` +
      `${formatHours(hit.hours)} after the last fix`
    : `in about ${formatHours(hit.hours - hoursSinceLastFix)}, ` +
      `${formatHours(hit.hours)} after the last fix`;

  return {
    willStrand: true,
    lat: hit.lat,
    lon: hit.lon,
    hoursFromLastFix: hit.hours,
    alreadyPassed,
    distanceKm: hit.distanceKm,
    uncertaintyKm,
    resolutionKm,
    horizonHours,
    reasoning:
      `Drifting ${prediction.speedKmH.toFixed(2)} km/h on ${Math.round(prediction.headingDeg)}°, ` +
      `the path first reaches land ${hit.distanceKm.toFixed(1)} km along — ${when}. ` +
      (alreadyPassed
        ? 'The tag has most likely been ashore since then; search the strandline near this point rather than the last fix. '
        : '') +
      `Along-shore uncertainty about ±${uncertaintyKm.toFixed(1)} km. ` +
      `Path sampled every ${(resolutionKm * 1000).toFixed(0)} m.`,
  };
}

/** Linear interpolation of the prediction cone at an arbitrary time. */
function interpolateUncertainty(prediction: DriftPrediction, hours: number): number {
  const pts = prediction.predictions;
  if (pts.length === 0) return 0;
  if (hours <= pts[0].hoursAhead) {
    return (pts[0].uncertaintyRadiusKm * hours) / Math.max(pts[0].hoursAhead, 1e-6);
  }
  for (let i = 1; i < pts.length; i++) {
    if (hours <= pts[i].hoursAhead) {
      const a = pts[i - 1];
      const b = pts[i];
      const t = (hours - a.hoursAhead) / (b.hoursAhead - a.hoursAhead);
      return a.uncertaintyRadiusKm + t * (b.uncertaintyRadiusKm - a.uncertaintyRadiusKm);
    }
  }
  // Beyond the last prediction: extend the final growth rate.
  const last = pts[pts.length - 1];
  const prev = pts.length > 1 ? pts[pts.length - 2] : null;
  const rate = prev
    ? (last.uncertaintyRadiusKm - prev.uncertaintyRadiusKm) /
      Math.max(last.hoursAhead - prev.hoursAhead, 1e-6)
    : last.uncertaintyRadiusKm / Math.max(last.hoursAhead, 1e-6);
  return last.uncertaintyRadiusKm + rate * (hours - last.hoursAhead);
}

function formatHours(h: number): string {
  if (h < 1) return `${Math.round(h * 60)} min`;
  if (h < 48) return `${h.toFixed(1)} h`;
  return `${(h / 24).toFixed(1)} days`;
}

/** Distance between two points, re-exported for callers assembling probe paths. */
export { haversineKm };
