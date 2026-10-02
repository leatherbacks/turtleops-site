import type { ArgosFix, Carried } from '@/lib/types';
import { haversineKm } from '@/lib/haversine';

/**
 * Has somebody picked the tag up and taken it somewhere?
 *
 * MiniPAT 40996 sat on a camper table at Ocean Waves Campground for a day,
 * six fixes inside 100 m. The recovery team collected it at 08:40 on 2 Oct
 * 2026 and the next quality fix, class 3 with a 166 m error, was on a street
 * in Kill Devil Hills, 50 km north, under three hours later. The site reported
 * the tag at the campground: the stuck-tag outlier screen throws away any fix
 * more than 50 km from the cluster, whatever its class, and so discarded the
 * one true position in the file.
 *
 * Nothing on water moves 17 km/h. A quality fix that lands far outside the
 * previous cluster at a speed no float or current can produce is a vehicle,
 * a bag or a pocket, and it is where the tag is now. The detector asks for
 * class 1–3 at the far end (class A and B scatter kilometres on their own —
 * the same camper table produced class-B fixes 11 km out that evening), a
 * displacement that outruns both fixes' errors by a vehicle-scale margin, and
 * a speed above anything the drift model allows.
 */

/** Faster than any float, current or swimmer; slower than a car is fine. */
export const CARRIED_MIN_SPEED_KMH = 8;
/** The jump must outrun the fixes' combined error by at least this much. */
export const CARRIED_MIN_JUMP_KM = 3;
/** Fix classes trusted at the far end of the jump. */
const TRUSTED = new Set(['3', '2', '1']);

function err(f: ArgosFix): number {
  return Number.isFinite(f.effectiveError) ? f.effectiveError : 0;
}

export function detectCarried(fixes: ArgosFix[]): Carried {
  const quality = fixes
    .filter((f) => TRUSTED.has(f.quality) && !isNaN(f.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (quality.length < 2) return { verdict: 'none', reasoning: 'Fewer than two class 1–3 fixes.', from: null, to: null, distanceKm: null, speedKmH: null, since: null };

  const none = (reasoning: string): Carried =>
    ({ verdict: 'none', reasoning, from: null, to: null, distanceKm: null, speedKmH: null, since: null });
  const sits = (a: ArgosFix, b: ArgosFix) =>
    haversineKm(a.latitude, a.longitude, b.latitude, b.longitude) - (err(a) + err(b)) / 1000 < CARRIED_MIN_JUMP_KM;

  // The destination is wherever the latest quality fix is, plus any earlier
  // fixes that sit with it. The leg is from the last fix before that cluster
  // to its first fix; the leg's speed is what decides.
  const last = quality[quality.length - 1];
  let j = quality.length - 1;
  while (j > 0 && sits(quality[j - 1], last)) j--;
  if (j === 0) return none('The latest quality fix sits with the ones before it.');
  const from = quality[j - 1];
  const arrive = quality[j];
  const legKm = haversineKm(from.latitude, from.longitude, arrive.latitude, arrive.longitude);
  const legResolvable = legKm - (err(from) + err(arrive)) / 1000;
  const legHours = (arrive.date.getTime() - from.date.getTime()) / 3600_000;
  if (legResolvable < CARRIED_MIN_JUMP_KM) return none('The latest quality fix sits with the ones before it.');
  const legSpeed = legHours > 0 ? legResolvable / legHours : Infinity;
  if (legSpeed < CARRIED_MIN_SPEED_KMH)
    return none(`The latest quality fix is ${legKm.toFixed(1)} km from the previous one, but at ${legSpeed.toFixed(1)} km/h — a speed water can produce, so the drift model handles it.`);
  const distanceKm = haversineKm(from.latitude, from.longitude, last.latitude, last.longitude);
  const speedKmH = legKm / Math.max(legHours, 1e-6);
  return {
    verdict: 'carried',
    from: { latitude: from.latitude, longitude: from.longitude, date: from.date },
    to: { latitude: last.latitude, longitude: last.longitude, date: last.date, quality: last.quality, errorM: err(last) },
    distanceKm,
    speedKmH,
    since: from.date,
    reasoning: `Carried: the tag moved ${distanceKm.toFixed(1)} km between ${from.date.toISOString().slice(0, 16).replace('T', ' ')} and ${last.date.toISOString().slice(0, 16).replace('T', ' ')} UTC, ${speedKmH.toFixed(0)} km/h, far faster than anything on water. The latest class ${last.quality} fix (${err(last).toFixed(0)} m) is where it is now — in a vehicle, a bag or a building, with whoever picked it up.`,
  };
}
