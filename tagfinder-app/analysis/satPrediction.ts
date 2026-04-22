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

/**
 * Predict satellite passes over a location during a given time window.
 * Use this for retrospective analysis (e.g., "what passes occurred while tag was transmitting?").
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
  const stepMs = 30_000; // 30-second steps

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

    let inPass = false;
    let riseTime: Date | null = null;
    let riseAz = 0;
    let maxEl = 0;
    let peakAz = 0;
    let firstLat = 0;
    let lastLat = 0;
    let lastAz = 0;
    let trackPoints: TrackPoint[] = [];

    for (
      let t = startTime.getTime();
      t <= endTime.getTime();
      t += stepMs
    ) {
      const d = new Date(t);
      const posVel = propagate(satrec, d);
      if (
        !posVel ||
        !posVel.position ||
        typeof posVel.position !== 'object'
      ) {
        continue;
      }

      const gmst = gstime(d);
      const ecf = eciToEcf(posVel.position as EciVec3<number>, gmst);
      const look = ecfToLookAngles(observerGd, ecf);
      const elev = look.elevation * (180 / Math.PI);
      const az = ((look.azimuth * 180) / Math.PI + 360) % 360;

      if (elev > 0) {
        lastAz = az;
        if (!inPass) {
          inPass = true;
          riseTime = d;
          riseAz = az;
          maxEl = elev;
          peakAz = az;
          trackPoints = [{ time: d, azimuth: az, elevation: elev }];
          // Compute sub-satellite latitude for direction
          const subLat =
            Math.atan2(
              (posVel.position as EciVec3<number>).z,
              Math.hypot(
                (posVel.position as EciVec3<number>).x,
                (posVel.position as EciVec3<number>).y
              )
            ) *
            (180 / Math.PI);
          firstLat = subLat;
          lastLat = subLat;
        } else {
          if (elev > maxEl) {
            maxEl = elev;
            peakAz = az;
          }
          trackPoints.push({ time: d, azimuth: az, elevation: elev });
          const subLat =
            Math.atan2(
              (posVel.position as EciVec3<number>).z,
              Math.hypot(
                (posVel.position as EciVec3<number>).x,
                (posVel.position as EciVec3<number>).y
              )
            ) *
            (180 / Math.PI);
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

  return passes.sort((a, b) => a.riseTime.getTime() - b.riseTime.getTime());
}

function cleanSatName(name: string): string {
  return name.replace(/^0 /, '').trim();
}
