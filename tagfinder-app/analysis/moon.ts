/**
 * Moon altitude and illuminated fraction, low precision.
 *
 * Enough to tell moonlight from lamplight in a light sensor's night readings:
 * a bright full moon high in the sky lifts an open-water PSAT+ reading from
 * about 5 to about 50 counts, and the same counts on a moonless night need
 * another source. Simplified lunar theory (mean elements plus the largest
 * periodic terms), good to a degree or so in position; the illuminated
 * fraction comes from the sun–moon elongation.
 */

const RAD = Math.PI / 180;
const OBLIQUITY = 23.4397 * RAD;
const SUN_DIST_KM = 149_598_000;

function daysSinceJ2000(date: Date): number {
  return date.getTime() / 86_400_000 + 2_440_587.5 - 2_451_545.0;
}

function equatorial(lon: number, lat: number): { ra: number; dec: number } {
  const ra = Math.atan2(Math.sin(lon) * Math.cos(OBLIQUITY) - Math.tan(lat) * Math.sin(OBLIQUITY), Math.cos(lon));
  const dec = Math.asin(Math.sin(lat) * Math.cos(OBLIQUITY) + Math.cos(lat) * Math.sin(OBLIQUITY) * Math.sin(lon));
  return { ra, dec };
}

function moonCoords(d: number): { ra: number; dec: number; distKm: number } {
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.22935 * d);
  const lon = L + RAD * 6.289 * Math.sin(M);
  const lat = RAD * 5.128 * Math.sin(F);
  return { ...equatorial(lon, lat), distKm: 385_001 - 20_905 * Math.cos(M) };
}

function sunCoords(d: number): { ra: number; dec: number } {
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  return equatorial(L, 0);
}

export interface MoonState {
  /** Degrees above the horizon. */
  altitudeDeg: number;
  /** 0 new, 1 full. */
  illumination: number;
}

export function moonAt(date: Date, lat: number, lon: number): MoonState {
  const d = daysSinceJ2000(date);
  const m = moonCoords(d);
  const sidereal = RAD * (280.16 + 360.9856235 * d) + lon * RAD;
  const H = sidereal - m.ra;
  const phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(m.dec) + Math.cos(phi) * Math.cos(m.dec) * Math.cos(H));
  const s = sunCoords(d);
  const elong = Math.acos(
    Math.max(-1, Math.min(1, Math.sin(s.dec) * Math.sin(m.dec) + Math.cos(s.dec) * Math.cos(m.dec) * Math.cos(s.ra - m.ra)))
  );
  const inc = Math.atan2(SUN_DIST_KM * Math.sin(elong), m.distKm - SUN_DIST_KM * Math.cos(elong));
  return { altitudeDeg: alt / RAD, illumination: (1 + Math.cos(inc)) / 2 };
}
