import type { ArgosFix, ArgosPass } from '@/lib/types';
import { haversineKm } from '@/lib/haversine';
import { normalizeSatName } from './satCoverage';

/**
 * A Wildlife Computers export and a CLS (Argos-Kinéis portal) message export
 * of the same tag, combined.
 *
 * Until Wildlife Computers pulls Kinéis automatically, its portal holds only
 * the legacy Argos satellites; the Kinéis passes sit in the CLS portal, which
 * keeps them back to 1 July 2025 (Wildlife Computers' Kinéis integration
 * guide, v.202609). The guide's advice during a recovery is to pull the latest
 * Kinéis data each time a new location is wanted. MiniPAT 33938 went quiet to
 * the legacy satellites after 08:11 EDT on its collection day, while three
 * high Kinéis passes that afternoon went unseen because nobody had pulled them.
 *
 * The CLS export carries the legacy satellites too, so the overlap is dropped.
 * Wildlife Computers already holds every legacy-satellite pass and re-solves
 * its fixes (on 33938, 4 of 116 came out minutes and a few hundred metres from
 * CLS's own), so a CLS fix from a legacy satellite is never added; one from a
 * Kinéis satellite is, unless it repeats a fix already held. A pass by the same
 * satellite within minutes is the same pass. Wildlife Computers rows win, for
 * their full error ellipses.
 */

/** Kinéis satellites: the ones a Wildlife Computers export does not yet carry. */
const isKineis = (sat: string | undefined) => !!sat && normalizeSatName(sat).startsWith('KINEIS-');

/** The same Doppler solution, reported by both sources. */
const SAME_FIX_MS = 5_000;
const SAME_FIX_KM = 1;
/** One LEO pass lasts at most ~15 min; WC and CLS stamp it differently within it. */
const SAME_PASS_MS = 10 * 60_000;
const SAME_MESSAGE_MS = 1_000;

export function mergeFixes(primary: ArgosFix[], extra: ArgosFix[]): { fixes: ArgosFix[]; added: number } {
  const added = extra.filter(
    (e) =>
      // Without a satellite the source cannot say, so fall back to time and place.
      (e.satellite === undefined || isKineis(e.satellite)) &&
      !primary.some(
        (p) =>
          Math.abs(p.date.getTime() - e.date.getTime()) <= SAME_FIX_MS &&
          haversineKm(p.latitude, p.longitude, e.latitude, e.longitude) <= SAME_FIX_KM
      )
  );
  return {
    fixes: [...primary, ...added].sort((a, b) => a.date.getTime() - b.date.getTime()),
    added: added.length,
  };
}

export function mergePasses(primary: ArgosPass[], extra: ArgosPass[]): { passes: ArgosPass[]; added: number } {
  const key = (p: ArgosPass) => normalizeSatName(p.satellite);
  const added = extra.filter(
    (e) => !primary.some((p) => key(p) === key(e) && Math.abs(p.date.getTime() - e.date.getTime()) <= SAME_PASS_MS)
  );
  return {
    passes: [...primary, ...added].sort((a, b) => a.date.getTime() - b.date.getTime()),
    added: added.length,
  };
}

export function mergeMessageTimes(
  primary: { date: Date; satellite: string }[],
  extra: { date: Date; satellite: string }[]
): { messageTimes: { date: Date; satellite: string }[]; added: number } {
  const seen = new Map<string, number[]>();
  for (const m of primary) {
    const k = normalizeSatName(m.satellite);
    (seen.get(k) ?? seen.set(k, []).get(k)!).push(m.date.getTime());
  }
  const added = extra.filter((m) => {
    const ts = seen.get(normalizeSatName(m.satellite)) ?? [];
    return !ts.some((t) => Math.abs(t - m.date.getTime()) <= SAME_MESSAGE_MS);
  });
  return {
    messageTimes: [...primary, ...added].sort((a, b) => a.date.getTime() - b.date.getTime()),
    added: added.length,
  };
}
