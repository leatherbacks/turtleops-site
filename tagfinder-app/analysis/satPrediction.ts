import {
  twoline2satrec,
  propagate,
  gstime,
  eciToEcf,
  ecfToLookAngles,
  type EciVec3,
} from 'satellite.js';

export interface TLEEntry {
  name: string;
  line1: string;
  line2: string;
}

export interface TrackPoint {
  time: Date;
  azimuth: number;
  elevation: number;
}

export interface SatellitePass {
  satelliteName: string;
  riseTime: Date;
  setTime: Date;
  maxElevation: number;
  duration: number;
  /** Direction of travel: ascending (northbound) or descending (southbound) */
  direction: 'ascending' | 'descending';
  /** Azimuth at max elevation — where the satellite was relative to the tag */
  peakAzimuth: number;
  /** Azimuth at rise (when sat came up over horizon) */
  riseAzimuth: number;
  /** Azimuth at set (when sat dropped below horizon) */
  setAzimuth: number;
  /** Downsampled trajectory points for sky-chart rendering */
  trackPoints: TrackPoint[];
}

const DEG_TO_RAD = Math.PI / 180;

/** Fine sampling interval — determines rise/set and track-point resolution. */
const FINE_STEP_MS = 30_000;
/**
 * Coarse sampling interval used to locate candidate passes before sampling them
 * finely. A LEO Argos platform (Kinéis ~650 km, METOP ~820 km) stays above
 * CANDIDATE_ELEV for ~10 min even on a low pass, so a 2-minute coarse step
 * always lands several samples inside any pass that could reach minElevation.
 */
const COARSE_STEP_MS = 120_000;
/**
 * Elevation that opens a candidate window. Sits below the 0° horizon so the
 * fine scan starts before the satellite actually rises, which keeps riseTime
 * and riseAzimuth identical to a uniformly fine scan.
 */
const CANDIDATE_ELEV = -5;

interface LookAngle {
  elevation: number;
  azimuth: number;
  subLat: number;
}

type ObserverGd = { longitude: number; latitude: number; height: number };

function lookAngle(
  satrec: ReturnType<typeof twoline2satrec>,
  observerGd: ObserverGd,
  d: Date
): LookAngle | null {
  const posVel = propagate(satrec, d);
  if (!posVel || !posVel.position || typeof posVel.position !== 'object') {
    return null;
  }
  const pos = posVel.position as EciVec3<number>;
  const gmst = gstime(d);
  const look = ecfToLookAngles(observerGd, eciToEcf(pos, gmst));
  return {
    elevation: look.elevation * (180 / Math.PI),
    azimuth: ((look.azimuth * 180) / Math.PI + 360) % 360,
    subLat:
      Math.atan2(pos.z, Math.hypot(pos.x, pos.y)) * (180 / Math.PI),
  };
}

/**
 * Coarse scan for spans where the satellite is near or above the horizon.
 * Returned spans are padded by one coarse step and merged where they touch, so
 * each is guaranteed to fully contain any pass it overlaps.
 */
function findCandidateWindows(
  satrec: ReturnType<typeof twoline2satrec>,
  observerGd: ObserverGd,
  startTime: Date,
  endTime: Date
): [number, number][] {
  const t0 = startTime.getTime();
  const t1 = endTime.getTime();
  const spans: [number, number][] = [];
  let open: number | null = null;

  for (let t = t0; t <= t1; t += COARSE_STEP_MS) {
    const la = lookAngle(satrec, observerGd, new Date(t));
    const up = la !== null && la.elevation >= CANDIDATE_ELEV;
    if (up && open === null) open = t;
    else if (!up && open !== null) {
      spans.push([open, t]);
      open = null;
    }
  }
  if (open !== null) spans.push([open, t1]);

  const merged: [number, number][] = [];
  for (const [s, e] of spans) {
    // Clamp to the requested window so pass semantics match a uniform scan
    const ps = Math.max(t0, s - COARSE_STEP_MS);
    const pe = Math.min(t1, e + COARSE_STEP_MS);
    const last = merged[merged.length - 1];
    if (last && ps <= last[1]) last[1] = Math.max(last[1], pe);
    else merged.push([ps, pe]);
  }
  return merged;
}

/**
 * Predict satellite passes over a location during a given time window.
 * Use this for retrospective analysis (e.g., "what passes occurred while tag was transmitting?").
 *
 * Scans coarsely to find candidate passes and only samples finely inside them.
 * With the full ~31-satellite Argos constellation (25 Kinéis + legacy) a
 * uniformly fine scan over a long deployment runs to millions of SGP4 calls on
 * the main thread; this keeps the fine work proportional to actual pass time.
 */
export function predictPassesInWindow(
  tles: TLEEntry[],
  lat: number,
  lon: number,
  startTime: Date,
  endTime: Date,
  minElevation = 5
): SatellitePass[] {
  if (tles.length === 0) return [];

  const passes: SatellitePass[] = [];
  const stepMs = FINE_STEP_MS;

  const observerGd = {
    longitude: lon * DEG_TO_RAD,
    latitude: lat * DEG_TO_RAD,
    height: 0,
  };

  for (const tle of tles) {
    let satrec;
    try {
      satrec = twoline2satrec(tle.line1, tle.line2);
    } catch {
      continue;
    }

    const windows = findCandidateWindows(
      satrec,
      observerGd,
      startTime,
      endTime
    );

    // State is per candidate window: a pass still open when a window closes is
    // discarded, matching the old behaviour at the end of the scan range.
    for (const [winStart, winEnd] of windows) {
      let inPass = false;
      let riseTime: Date | null = null;
      let riseAz = 0;
      let maxEl = 0;
      let peakAz = 0;
      let firstLat = 0;
      let lastLat = 0;
      let lastAz = 0;
      let trackPoints: TrackPoint[] = [];

      for (let t = winStart; t <= winEnd; t += stepMs) {
        const d = new Date(t);
        const la = lookAngle(satrec, observerGd, d);
        if (!la) continue;

        const { elevation: elev, azimuth: az, subLat } = la;

        if (elev > 0) {
          lastAz = az;
          if (!inPass) {
            inPass = true;
            riseTime = d;
            riseAz = az;
            maxEl = elev;
            peakAz = az;
            trackPoints = [{ time: d, azimuth: az, elevation: elev }];
            // Sub-satellite latitude, for travel direction
            firstLat = subLat;
            lastLat = subLat;
          } else {
            if (elev > maxEl) {
              maxEl = elev;
              peakAz = az;
            }
            trackPoints.push({ time: d, azimuth: az, elevation: elev });
            lastLat = subLat;
          }
        } else if (inPass) {
          // Pass just ended
          if (riseTime && maxEl >= minElevation) {
            passes.push({
              satelliteName: cleanSatName(tle.name),
              riseTime,
              setTime: d,
              maxElevation: Math.round(maxEl * 10) / 10,
              duration: Math.round((d.getTime() - riseTime.getTime()) / 1000),
              direction: lastLat > firstLat ? 'ascending' : 'descending',
              peakAzimuth: Math.round(peakAz),
              riseAzimuth: Math.round(riseAz),
              setAzimuth: Math.round(lastAz),
              trackPoints,
            });
          }
          inPass = false;
          riseTime = null;
          maxEl = 0;
          peakAz = 0;
          trackPoints = [];
        }
      }
    }
  }

  return passes.sort((a, b) => a.riseTime.getTime() - b.riseTime.getTime());
}

function cleanSatName(name: string): string {
  return name.replace(/^0 /, '').trim();
}
