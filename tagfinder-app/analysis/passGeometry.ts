import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  ecfToEci,
  eciToGeodetic,
  geodeticToEcf,
  degreesLat,
  degreesLong,
  type EciVec3,
} from 'satellite.js';
import type { ArgosPass, PassGeometry, PassGeometryAnalysis } from '@/lib/types';
import type { TLEEntry } from './satPrediction';
import { normalizeSatName } from './satCoverage';
import { haversineKm } from '@/lib/haversine';

/**
 * Why a given Argos fix is good or bad, from the actual pass geometry.
 *
 * The quality class is a summary of a summary. What actually determines whether
 * a Doppler solution is trustworthy is where the satellite was: how high above
 * the horizon, and how far the tag sat from the ground track. This recovers
 * both, and with them the second solution that Argos always computes and
 * usually discards.
 *
 * ── The mirror ───────────────────────────────────────────────────────────────
 * A Doppler fix has two solutions, mirrored across the satellite's orbital
 * plane. CLS picks one using recent history. When the tag lies close to the
 * ground track the two sit close together and the pick is a coin toss; when the
 * tag is far off-track the mirror lands hundreds of km away and is trivially
 * rejected.
 *
 * This matters because "the fix might be a mirror" is a tempting explanation for
 * any position that does not fit the story, and it is usually wrong. On
 * A reference PSAT+ deployment two Aug 11 fixes put the tag ~2 km west of where it was expected,
 * and mirroring was raised as the explanation. Computing it showed the mirrors
 * were 541 km and 1943 km away in the open Atlantic — the reported positions
 * were the correct branch, and the tag really had moved. Guessing would have
 * sent a search team the wrong way; the geometry settled it in seconds.
 */

/**
 * How far a fix may sit from the TLE's epoch before its geometry is untrustworthy.
 *
 * A TLE describes an orbit at one instant and SGP4 degrades away from it, roughly
 * 1-3 km/day along-track for LEO. Measured against real Kinéis elements that is
 * about 3-8 seconds of timing error at 20 days, and a LEO satellite sweeps the sky
 * at up to a degree per second near closest approach — so a fix a month from epoch
 * can be several degrees wrong in elevation, enough to move it between bands.
 *
 * The threshold is set where that error stays inside one elevation bin. Bins are
 * 15 degrees wide; at 14 days the error is roughly 2-6 degrees, at 21 days about
 * 8, which is over half a bin and would start moving fixes between categories.
 *
 * That matters because there is no free source of historical elements: CelesTrak's
 * archive stops in 2004 by law, and Space-Track needs credentials. So an old
 * dataset gets analysed against today's TLEs or not at all, and quietly reporting
 * "taken at 12 degrees elevation" from a month-stale element set is the same class
 * of error as every other confident number this codebase has had to unlearn.
 *
 * Pass MATCHING tolerates far more than this — seconds of error against a
 * 12-minute window — so satellite coverage is unaffected. It is per-fix geometry
 * that has to stop.
 */
const MAX_TLE_AGE_DAYS = 14;
/** Beyond this the numbers are still usable but worth flagging. */
const TLE_AGE_WARN_DAYS = 5;

/** Below this separation the two solutions are genuinely hard to tell apart. */
const AMBIGUOUS_SEPARATION_KM = 100;
/** A mirror must beat the primary by this much to be worth flagging. */
const SUSPECT_MARGIN_KM = 5;
/** Only fixes this good are trusted to define the reference cluster. */
const CLUSTER_QUALITIES = ['3', '2', '1', 'A'];

/** Epoch encoded in columns 19-32 of TLE line 1, as a Date. */
export function tleEpoch(line1: string): Date | null {
  const yy = parseInt(line1.slice(18, 20), 10);
  const doy = parseFloat(line1.slice(20, 32));
  if (!Number.isFinite(yy) || !Number.isFinite(doy)) return null;
  const year = yy < 57 ? 2000 + yy : 1900 + yy;
  return new Date(Date.UTC(year, 0, 1) + (doy - 1) * 86_400_000);
}

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Reflect a ground position across the satellite's orbital plane.
 *
 * The plane's normal is r x v. Reflecting the tag's ECF position through that
 * plane gives the other Doppler solution, because the two differ only in which
 * side of the track produces the same range-rate history.
 */
function mirrorAcrossOrbitPlane(
  latDeg: number,
  lonDeg: number,
  satEcf: { x: number; y: number; z: number },
  velEcf: { x: number; y: number; z: number },
  gmst: number
): { lat: number; lon: number } | null {
  const n = {
    x: satEcf.y * velEcf.z - satEcf.z * velEcf.y,
    y: satEcf.z * velEcf.x - satEcf.x * velEcf.z,
    z: satEcf.x * velEcf.y - satEcf.y * velEcf.x,
  };
  const len = Math.hypot(n.x, n.y, n.z);
  if (!isFinite(len) || len === 0) return null;
  const u = { x: n.x / len, y: n.y / len, z: n.z / len };

  const p = geodeticToEcf({
    latitude: (latDeg * Math.PI) / 180,
    longitude: (lonDeg * Math.PI) / 180,
    height: 0,
  });
  const d = p.x * u.x + p.y * u.y + p.z * u.z;
  const m = { x: p.x - 2 * d * u.x, y: p.y - 2 * d * u.y, z: p.z - 2 * d * u.z };
  const gd = eciToGeodetic(ecfToEci(m, gmst), gmst);
  return { lat: degreesLat(gd.latitude), lon: degreesLong(gd.longitude) };
}

export function analyzePassGeometry(
  passes: ArgosPass[],
  tles: TLEEntry[]
): PassGeometryAnalysis | null {
  const located = passes.filter(
    (p) => p.latitude !== null && p.longitude !== null && !isNaN(p.date.getTime())
  );
  if (located.length === 0 || tles.length === 0) return null;

  const byName = new Map<string, TLEEntry>();
  for (const t of tles) byName.set(normalizeSatName(t.name), t);

  // Reference cluster from the good fixes only, so a wild fix cannot drag the
  // centroid toward itself and then be judged against it.
  const cluster = located.filter((p) => CLUSTER_QUALITIES.includes(p.locationQuality));
  const ref =
    cluster.length >= 3
      ? { lat: median(cluster.map((p) => p.latitude!)), lon: median(cluster.map((p) => p.longitude!)) }
      : null;

  const fixes: PassGeometry[] = [];
  let noTle = 0;
  let tooStale = 0;
  let maxAgeDays = 0;

  for (const p of located) {
    const tle = byName.get(normalizeSatName(p.satellite));
    if (!tle) {
      noTle++;
      continue;
    }
    let satrec;
    try {
      satrec = twoline2satrec(tle.line1, tle.line2);
    } catch {
      noTle++;
      continue;
    }

    // Refuse rather than extrapolate an element set past its useful life.
    const epoch = tleEpoch(tle.line1);
    const ageDays = epoch
      ? Math.abs(p.date.getTime() - epoch.getTime()) / 86_400_000
      : Infinity;
    if (ageDays > MAX_TLE_AGE_DAYS) {
      tooStale++;
      continue;
    }
    maxAgeDays = Math.max(maxAgeDays, ageDays);

    const pv = propagate(satrec, p.date);
    if (!pv?.position || !pv?.velocity || typeof pv.position === 'boolean') continue;

    const gmst = gstime(p.date);
    const satEcf = eciToEcf(pv.position as EciVec3<number>, gmst);
    const velEcf = eciToEcf(pv.velocity as EciVec3<number>, gmst);

    const lat = p.latitude!;
    const lon = p.longitude!;

    // Elevation and slant range, from the tag looking up.
    const obs = geodeticToEcf({
      latitude: (lat * Math.PI) / 180,
      longitude: (lon * Math.PI) / 180,
      height: 0,
    });
    const los = { x: satEcf.x - obs.x, y: satEcf.y - obs.y, z: satEcf.z - obs.z };
    const slantRangeKm = Math.hypot(los.x, los.y, los.z);
    const obsLen = Math.hypot(obs.x, obs.y, obs.z);
    const elevationDeg =
      (Math.asin(
        (los.x * obs.x + los.y * obs.y + los.z * obs.z) / (slantRangeKm * obsLen)
      ) *
        180) /
      Math.PI;

    const mirror = mirrorAcrossOrbitPlane(lat, lon, satEcf, velEcf, gmst);
    if (!mirror) continue;

    const mirrorSeparationKm = haversineKm(lat, lon, mirror.lat, mirror.lon);
    // The tag sits half the mirror separation off the ground track, by
    // construction — reflection is symmetric about the plane.
    const crossTrackKm = mirrorSeparationKm / 2;

    let mirrorClusterKm: number | null = null;
    let primaryClusterKm: number | null = null;
    if (ref) {
      mirrorClusterKm = haversineKm(mirror.lat, mirror.lon, ref.lat, ref.lon);
      primaryClusterKm = haversineKm(lat, lon, ref.lat, ref.lon);
    }

    fixes.push({
      date: p.date,
      satellite: p.satellite,
      quality: p.locationQuality,
      latitude: lat,
      longitude: lon,
      elevationDeg,
      slantRangeKm,
      crossTrackKm,
      mirrorLat: mirror.lat,
      mirrorLon: mirror.lon,
      mirrorSeparationKm,
      primaryClusterKm,
      mirrorClusterKm,
      ambiguous: mirrorSeparationKm < AMBIGUOUS_SEPARATION_KM,
      // Only meaningful when the two solutions are close enough to confuse AND
      // the mirror genuinely fits the rest of the track better.
      suspect:
        mirrorSeparationKm < AMBIGUOUS_SEPARATION_KM &&
        mirrorClusterKm !== null &&
        primaryClusterKm !== null &&
        mirrorClusterKm + SUSPECT_MARGIN_KM < primaryClusterKm,
    });
  }

  if (fixes.length === 0) return null;

  fixes.sort((a, b) => a.date.getTime() - b.date.getTime());
  const ambiguous = fixes.filter((f) => f.ambiguous);
  const suspect = fixes.filter((f) => f.suspect);
  const lowElev = fixes.filter((f) => f.elevationDeg < 15);

  return {
    fixes,
    tlesTooStale: tooStale,
    maxTleAgeDays: Math.round(maxAgeDays * 10) / 10,
    tleAgeWarning: maxAgeDays > TLE_AGE_WARN_DAYS,
    ambiguousCount: ambiguous.length,
    suspectCount: suspect.length,
    lowElevationCount: lowElev.length,
    medianElevationDeg: median(fixes.map((f) => f.elevationDeg)),
    medianCrossTrackKm: median(fixes.map((f) => f.crossTrackKm)),
    tlesMissing: noTle,
    reasoning: explain(fixes, ambiguous.length, suspect, lowElev.length, noTle, tooStale, maxAgeDays),
  };
}

function explain(
  fixes: PassGeometry[],
  ambiguousCount: number,
  suspect: PassGeometry[],
  lowElevCount: number,
  noTle: number,
  tooStale: number,
  maxAgeDays: number
): string {
  const parts: string[] = [];

  if (ambiguousCount === 0) {
    parts.push(
      `All ${fixes.length} fixes were taken well off the satellite ground track ` +
        `(median ${median(fixes.map((f) => f.crossTrackKm)).toFixed(0)} km), so their mirror ` +
        `solutions land hundreds of km away and are trivially rejected. Mirror ambiguity ` +
        `is not a plausible explanation for any position here.`
    );
  } else {
    parts.push(
      `${ambiguousCount} of ${fixes.length} fixes sit close enough to the ground track that ` +
        `their two Doppler solutions are within ${AMBIGUOUS_SEPARATION_KM} km of each other ` +
        `and could have been swapped.`
    );
  }

  if (suspect.length > 0) {
    const worst = suspect[0];
    parts.push(
      `${suspect.length} fix${suspect.length > 1 ? 'es have' : ' has'} a mirror that sits ` +
        `closer to the rest of the track than the reported position does — the first at ` +
        `${worst.date.toISOString()}, mirror ${worst.mirrorClusterKm!.toFixed(1)} km from the ` +
        `cluster against ${worst.primaryClusterKm!.toFixed(1)} km for the primary. Argos may ` +
        `have picked the wrong branch on these.`
    );
  }

  if (lowElevCount > 0) {
    parts.push(
      `${lowElevCount} fix${lowElevCount > 1 ? 'es were' : ' was'} taken below 15° elevation, ` +
        `where Doppler geometry is weak and the reported error radius tends to understate the ` +
        `true uncertainty.`
    );
  }

  if (noTle > 0) {
    parts.push(`${noTle} pass${noTle > 1 ? 'es' : ''} had no matching TLE and were skipped.`);
  }

  if (tooStale > 0) {
    parts.push(
      `${tooStale} fix${tooStale > 1 ? 'es were' : ' was'} skipped because the only available ` +
        `orbital elements are more than ${MAX_TLE_AGE_DAYS} days from when they were taken. ` +
        `Propagating that far introduces several degrees of elevation error, which is the ` +
        `quantity being reported, so no geometry is given rather than a confident wrong one. ` +
        `Historical elements would fix this; there is no free source for them.`
    );
  } else if (maxAgeDays > TLE_AGE_WARN_DAYS) {
    parts.push(
      `Orbital elements are up to ${maxAgeDays.toFixed(0)} days from these fixes, so elevation ` +
        `and cross-track figures carry roughly a degree or two of extra uncertainty.`
    );
  }

  return parts.join(' ');
}
