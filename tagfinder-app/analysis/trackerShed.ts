import type { ArgosFix, TagStatus, TrackerShedDetection, TrackerShedVerdict } from '@/lib/types';
import { haversineKm } from '@/lib/haversine';

const STATIONARY_WINDOW_HOURS = 72;
const STATIONARY_MIN_FIXES = 5;
const STATIONARY_MAX_SPREAD_M = 500;
const MOVEMENT_PROOF_MIN_SPREAD_KM = 5;
// Wet/dry signal: WC sensor returns 0–255 where 255 = fully dry. When the
// MIN of recent status reports stays near 255, the tag has not been wet at
// any point in the report window — i.e. it's no longer on a turtle that
// surfaces/dives. This is far more decisive than position spread (Argos
// noise alone can produce 1–3 km spread on a perfectly stationary tag).
const DRY_THRESHOLD = 200;
const DRY_MIN_REPORTS = 3;
const DRY_LOOKBACK_HOURS = 72;

/**
 * Detect whether a live-tracker tag has stopped moving — i.e. been removed
 * from the animal, shed naturally, or sitting in a lab/parking lot after
 * recovery. The behavioral signature is identical to a PSAT post-popoff:
 * many recent fixes clustered tight, with prior history showing movement.
 *
 * Logic:
 *   1. Take fixes from the last STATIONARY_WINDOW_HOURS (72h default).
 *   2. Require at least STATIONARY_MIN_FIXES of them, with spread under
 *      STATIONARY_MAX_SPREAD_M (500 m default — accommodates Argos error).
 *   3. Require historic fixes (everything older than the stationary window)
 *      to span at least MOVEMENT_PROOF_MIN_SPREAD_KM (5 km default) — proves
 *      the tag actually DID move at some point and isn't just a freshly
 *      deployed tag that hasn't gone anywhere yet.
 *   4. Walk backwards from the latest fix to find the actual onset time
 *      of stationarity (the duration claim should be honest, not just 72h).
 *
 * Returns 'separated' when all conditions hold; 'still_moving' when there's
 * historic movement but the tag is still active; 'insufficient' otherwise.
 */
export function detectTrackerShed(
  fixes: ArgosFix[],
  statuses: TagStatus[] = []
): TrackerShedDetection {
  // Wet/dry signal first — it's authoritative when available. If recent
  // status reports show the tag has been continuously dry, the tag is off
  // the animal regardless of what position spread says.
  const wetDrySignal = analyzeWetDrySignal(statuses);

  if (fixes.length < STATIONARY_MIN_FIXES) {
    if (wetDrySignal.continuouslyDry) {
      return separationFromWetDry(wetDrySignal, fixes, [], 0);
    }
    return baseline('insufficient', 'Not enough fixes to assess tracker separation.', 0);
  }

  // Filter out outliers and ultra-low quality. Use Q1/A or better.
  const useful = fixes.filter((f) => !f.isOutlier && f.quality !== 'B' && f.quality !== 'Z');
  if (useful.length < STATIONARY_MIN_FIXES) {
    return baseline('insufficient', 'Not enough Q1+ fixes available.', 0);
  }

  const sorted = [...useful].sort((a, b) => a.date.getTime() - b.date.getTime());
  const latestT = sorted[sorted.length - 1].date.getTime();
  const windowStart = latestT - STATIONARY_WINDOW_HOURS * 60 * 60 * 1000;

  const recent = sorted.filter((f) => f.date.getTime() >= windowStart);
  const historic = sorted.filter((f) => f.date.getTime() < windowStart);

  if (recent.length < STATIONARY_MIN_FIXES) {
    return baseline(
      'insufficient',
      `Only ${recent.length} fix(es) in the last ${STATIONARY_WINDOW_HOURS}h — need at least ${STATIONARY_MIN_FIXES} to test for stationarity.`,
      0
    );
  }

  const recentSpreadM = bboxDiagonalKm(recent) * 1000;
  const historicSpreadKm = historic.length > 0 ? bboxDiagonalKm(historic) : 0;

  // Centroid of stationary cluster
  const meanLat = recent.reduce((s, f) => s + f.latitude, 0) / recent.length;
  const meanLon = recent.reduce((s, f) => s + f.longitude, 0) / recent.length;

  if (recentSpreadM > STATIONARY_MAX_SPREAD_M) {
    // Position spread alone says "still moving" — but wet/dry can override.
    // Argos has known noise (1–3 km spread on a stationary tag is common
    // depending on pass geometry), and the wet/dry sensor doesn't lie.
    if (wetDrySignal.continuouslyDry) {
      return separationFromWetDry(wetDrySignal, fixes, recent, historicSpreadKm);
    }
    return {
      verdict: 'still_moving',
      reasoning: `Recent ${STATIONARY_WINDOW_HOURS}h spread is ${(recentSpreadM / 1000).toFixed(2)} km — tag still moving.${
        wetDrySignal.note ? ' ' + wetDrySignal.note : ''
      }`,
      stationaryHours: 0,
      recentSpreadM: Number(recentSpreadM.toFixed(0)),
      historicSpreadKm: Number(historicSpreadKm.toFixed(2)),
      stationaryLat: meanLat,
      stationaryLon: meanLon,
      separatedSinceISO: null,
      confidence: 0.9,
    };
  }

  if (historicSpreadKm < MOVEMENT_PROOF_MIN_SPREAD_KM) {
    // Tag is stationary but never moved — could be a freshly-deployed
    // PSAT that hasn't drifted yet. Don't claim separation.
    return baseline(
      'insufficient',
      `Tag is currently stationary (${(recentSpreadM / 1000).toFixed(2)} km spread over last ${STATIONARY_WINDOW_HOURS}h) but historic record only spans ${historicSpreadKm.toFixed(1)} km — can't confirm the tag has been moving previously, so separation can't be inferred.`,
      0.3
    );
  }

  // Walk backwards to find when the tag actually went stationary
  let onsetIdx = sorted.length - 1;
  for (let i = sorted.length - 2; i >= 0; i--) {
    const d = haversineKm(sorted[i].latitude, sorted[i].longitude, meanLat, meanLon);
    if (d * 1000 > STATIONARY_MAX_SPREAD_M) break;
    onsetIdx = i;
  }
  const onsetT = sorted[onsetIdx].date.getTime();
  const stationaryHours = (latestT - onsetT) / (60 * 60 * 1000);
  const onsetISO = sorted[onsetIdx].date.toISOString();

  const wetDryNote = wetDrySignal.continuouslyDry
    ? ' ' + wetDrySignal.note
    : wetDrySignal.reportsAnalyzed > 0
      ? ' ' + wetDrySignal.note
      : '';
  const reasoning = `Tag has been stationary for ${formatDuration(stationaryHours)} (${recent.length} fixes within ${recentSpreadM.toFixed(0)} m of ${meanLat.toFixed(4)}°N, ${meanLon.toFixed(4)}°W), after previously moving across ${historicSpreadKm.toFixed(1)} km of historic track. Tag has been removed from the animal, shed naturally, or recovered — treat as a recovery target.${wetDryNote}`;

  // Confidence grows with how long it has been stationary; wet/dry agreement
  // bumps it further toward certainty.
  let confidence = 0.7;
  if (stationaryHours >= 24) confidence = 0.85;
  if (stationaryHours >= 72) confidence = 0.95;
  if (wetDrySignal.continuouslyDry) confidence = Math.min(0.98, confidence + 0.05);

  return {
    verdict: 'separated',
    reasoning,
    stationaryHours: Number(stationaryHours.toFixed(1)),
    recentSpreadM: Number(recentSpreadM.toFixed(0)),
    historicSpreadKm: Number(historicSpreadKm.toFixed(2)),
    stationaryLat: meanLat,
    stationaryLon: meanLon,
    separatedSinceISO: onsetISO,
    confidence,
  };
}

interface WetDrySignal {
  continuouslyDry: boolean;
  driedAtISO: string | null;
  reportsAnalyzed: number;
  note: string;
}

/** Analyze recent Status.csv WetDry readings. Tag is "continuously dry" when
 *  at least DRY_MIN_REPORTS recent reports all show minWetDry above
 *  DRY_THRESHOLD — meaning the tag wasn't in water at any point during the
 *  report's accumulation window. */
function analyzeWetDrySignal(statuses: TagStatus[]): WetDrySignal {
  const withWetDry = statuses
    .filter((s) => s.minWetDry !== null)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  if (withWetDry.length === 0) {
    return {
      continuouslyDry: false,
      driedAtISO: null,
      reportsAnalyzed: 0,
      note: '',
    };
  }

  const latestT = withWetDry[withWetDry.length - 1].date.getTime();
  const cutoff = latestT - DRY_LOOKBACK_HOURS * 60 * 60 * 1000;
  const recent = withWetDry.filter((s) => s.date.getTime() >= cutoff);

  if (recent.length < DRY_MIN_REPORTS) {
    return {
      continuouslyDry: false,
      driedAtISO: null,
      reportsAnalyzed: recent.length,
      note: `Only ${recent.length} WetDry-bearing reports in the last ${DRY_LOOKBACK_HOURS}h.`,
    };
  }

  const allDry = recent.every((s) => (s.minWetDry as number) >= DRY_THRESHOLD);
  if (!allDry) {
    const wetCount = recent.filter((s) => (s.minWetDry as number) < DRY_THRESHOLD).length;
    return {
      continuouslyDry: false,
      driedAtISO: null,
      reportsAnalyzed: recent.length,
      note: `WetDry: ${wetCount} of ${recent.length} recent reports show wet readings — tag still cycling wet/dry as expected for a tag on a surfacing animal.`,
    };
  }

  // Walk backwards from the latest report to find when the tag first went
  // continuously dry — that's the separation timestamp.
  let driedAtIdx = withWetDry.length - 1;
  for (let i = withWetDry.length - 2; i >= 0; i--) {
    if ((withWetDry[i].minWetDry as number) >= DRY_THRESHOLD) {
      driedAtIdx = i;
    } else {
      break;
    }
  }

  return {
    continuouslyDry: true,
    driedAtISO: withWetDry[driedAtIdx].date.toISOString(),
    reportsAnalyzed: recent.length,
    note: `WetDry: tag has been continuously dry across ${recent.length} reports since ${withWetDry[driedAtIdx].date.toLocaleString()}.`,
  };
}

/** Build a 'separated' verdict driven by the wet/dry signal. Used when
 *  position spread is too wide for the spread-based detector to fire, but
 *  the tag is clearly out of the water. */
function separationFromWetDry(
  wd: WetDrySignal,
  fixes: ArgosFix[],
  recent: ArgosFix[],
  historicSpreadKm: number
): TrackerShedDetection {
  // Position to report: use the most recent good fix as the tag's location,
  // since position spread isn't a useful centroid here.
  const useful = fixes.filter((f) => !f.isOutlier && f.quality !== 'B' && f.quality !== 'Z');
  const latest = useful.length > 0 ? useful[useful.length - 1] : null;
  const recentSpreadM = recent.length > 0 ? bboxDiagonalKm(recent) * 1000 : 0;
  const driedAt = wd.driedAtISO ? new Date(wd.driedAtISO) : null;
  const hoursSinceDry = driedAt
    ? (Date.now() - driedAt.getTime()) / (60 * 60 * 1000)
    : 0;

  return {
    verdict: 'separated',
    reasoning: `Tag has been continuously dry across ${wd.reportsAnalyzed} status reports since ${
      driedAt ? driedAt.toLocaleString() : 'recently'
    } (${formatDuration(hoursSinceDry)}). The wet/dry sensor doesn't cycle anymore — the tag is no longer on an animal that surfaces and dives. Position estimate is the most recent good Argos fix; Argos noise on a stationary tag can still produce a few km of fix spread.`,
    stationaryHours: Number(hoursSinceDry.toFixed(1)),
    recentSpreadM: Number(recentSpreadM.toFixed(0)),
    historicSpreadKm: Number(historicSpreadKm.toFixed(2)),
    stationaryLat: latest?.latitude ?? null,
    stationaryLon: latest?.longitude ?? null,
    separatedSinceISO: wd.driedAtISO,
    confidence: 0.95, // wet/dry is a strong signal
  };
}

function baseline(verdict: TrackerShedVerdict, reasoning: string, confidence: number): TrackerShedDetection {
  return {
    verdict,
    reasoning,
    stationaryHours: 0,
    recentSpreadM: 0,
    historicSpreadKm: 0,
    stationaryLat: null,
    stationaryLon: null,
    separatedSinceISO: null,
    confidence,
  };
}

/** O(n) bounding-box diagonal in km — adequate spread estimate for huge datasets. */
function bboxDiagonalKm(fixes: ArgosFix[]): number {
  if (fixes.length < 2) return 0;
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  for (const f of fixes) {
    if (f.latitude < minLat) minLat = f.latitude;
    if (f.latitude > maxLat) maxLat = f.latitude;
    if (f.longitude < minLon) minLon = f.longitude;
    if (f.longitude > maxLon) maxLon = f.longitude;
  }
  return haversineKm(minLat, minLon, maxLat, maxLon);
}

function formatDuration(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min`;
  if (hours < 24) return `${hours.toFixed(1)} h`;
  return `${Math.floor(hours / 24)}d ${Math.round(hours % 24)}h`;
}
