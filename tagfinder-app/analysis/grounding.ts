import type { ArgosFix, ArgosPass, Grounding } from '@/lib/types';
import { haversineKm } from '@/lib/haversine';

/**
 * Has the tag come out of the water?
 *
 * In summer the thermometer cannot say. PSAT+ 47125 (Surfside FL, Aug 2026)
 * read 29.5–32.7 °C afloat, on the beach, and in a bucket on a balcony; water,
 * wet sand and night air were all the same temperature. What did change was
 * the Argos geometry. Adrift on 7–8 Aug it resolved 0.85 and 0.68 quality
 * fixes per pass heard. On the beach on 9–10 Aug it was still heard on 41 and
 * 37 passes a day, at 5.7 and 4.5 messages a pass, and produced no location at
 * all — not even class B. A tag that stops moving and stops resolving while
 * the satellites are still hearing it has grounded: beached, hung up, or in
 * somebody's hands. Floating controls (PSAT+ 47128, MiniPAT 41008) never fell
 * below 0.59 quality fixes per pass on any day.
 *
 * The rule compares the tag against itself. The reference is the first 72 h
 * of transmissions, which must show the tag adrift and resolving; the recent
 * window is the last 48 h. Grounded needs the quality-fix yield to fall to a
 * quarter of the reference while passes continue, and the remaining fixes, if
 * any, to sit still. Transmissions that thin out are a different state —
 * buried, submerged, dying — and are reported as insufficient rather than
 * guessed at.
 */

const REFERENCE_HOURS = 72;
const RECENT_HOURS = 48;
const MIN_PASSES = 10;
const MIN_REFERENCE_SPAN_H = 18;
/** The reference must show the tag resolving at least this often... */
const MIN_REFERENCE_YIELD = 0.4;
/** ...and moving at least this far, so it was adrift and the yield is a true baseline. */
const MIN_REFERENCE_SPREAD_KM = 2;
/** Recent yield at or below this fraction of the reference yield. */
const YIELD_COLLAPSE_RATIO = 0.25;
/** Recent passes per day must hold at least this fraction of the reference rate. */
const MIN_PASS_CONTINUITY = 0.3;
/** Remaining fixes may scatter this far and still count as one place. */
const STATIONARY_SPREAD_KM = 1.5;

const QUALITY = new Set(['3', '2', '1']);
const H = 3600_000;

function spreadKm(fixes: ArgosFix[]): number {
  let m = 0;
  for (let i = 0; i < fixes.length; i++)
    for (let j = i + 1; j < fixes.length; j++)
      m = Math.max(m, haversineKm(fixes[i].latitude, fixes[i].longitude, fixes[j].latitude, fixes[j].longitude));
  return m;
}

function insufficient(reason: string): Grounding {
  return { verdict: 'insufficient', groundedSince: null, reference: null, recent: null, reasoning: reason };
}

export function detectGrounding(
  allFixes: ArgosFix[],
  allPasses: ArgosPass[],
  releaseDate: Date | null
): Grounding {
  const cutoff = releaseDate?.getTime() ?? -Infinity;
  const passes = allPasses.filter((p) => p.date.getTime() >= cutoff).sort((a, b) => a.date.getTime() - b.date.getTime());
  const fixes = allFixes.filter((f) => f.date.getTime() >= cutoff && !f.isOutlier).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (passes.length < 2 * MIN_PASSES) return insufficient(`Only ${passes.length} passes heard since release — too few to compare the tag against itself.`);

  const first = passes[0].date.getTime();
  const end = passes[passes.length - 1].date.getTime();
  // The recent window is the last 48 h, shortened to half the record so the
  // reference keeps at least a day; fixed offsets left a 25 h record with a
  // 23.9 h reference and no verdict.
  const totalH = (end - first) / H;
  if (totalH < 2 * MIN_REFERENCE_SPAN_H)
    return insufficient(`Only ${totalH.toFixed(0)} h of transmissions since release — too short to separate an adrift reference period from a recent one.`);
  const recentH = Math.min(RECENT_HOURS, totalH / 2);
  const recentStart = end - recentH * H;
  const refEnd = Math.min(first + REFERENCE_HOURS * H, recentStart);

  const refPasses = passes.filter((p) => p.date.getTime() <= refEnd);
  const recentPasses = passes.filter((p) => p.date.getTime() > recentStart);
  const refSpanH = refPasses.length ? (refPasses[refPasses.length - 1].date.getTime() - refPasses[0].date.getTime()) / H : 0;
  if (refPasses.length < MIN_PASSES || refSpanH < MIN_REFERENCE_SPAN_H)
    return insufficient(`Too few passes in the reference period (${refPasses.length} over ${refSpanH.toFixed(0)} h) to establish how the tag resolved while adrift.`);
  if (recentPasses.length < MIN_PASSES)
    return insufficient(`Only ${recentPasses.length} passes in the last ${RECENT_HOURS} h — too few to judge the fix yield.`);

  const refFixes = fixes.filter((f) => f.date.getTime() <= refEnd);
  const refQuality = refFixes.filter((f) => QUALITY.has(f.quality));
  const recentFixes = fixes.filter((f) => f.date.getTime() > recentStart);
  const recentQuality = recentFixes.filter((f) => QUALITY.has(f.quality));

  const reference = {
    passes: refPasses.length,
    qualityFixesPerPass: refQuality.length / refPasses.length,
    passesPerDay: refPasses.length / (refSpanH / 24),
    spreadKm: spreadKm(refQuality),
  };
  const recent = {
    passes: recentPasses.length,
    qualityFixesPerPass: recentQuality.length / recentPasses.length,
    passesPerDay: recentPasses.length / (recentH / 24),
    spreadKm: spreadKm(recentFixes),
  };

  if (reference.qualityFixesPerPass < MIN_REFERENCE_YIELD || reference.spreadKm < MIN_REFERENCE_SPREAD_KM)
    return {
      verdict: 'insufficient', groundedSince: null, reference, recent,
      reasoning: `No adrift reference: in its first ${REFERENCE_HOURS} h the tag resolved ${reference.qualityFixesPerPass.toFixed(2)} quality fixes per pass over ${reference.spreadKm.toFixed(1)} km, so there is no clean floating baseline to compare the recent fixes against.`,
    };
  if (recent.passesPerDay < MIN_PASS_CONTINUITY * reference.passesPerDay)
    return {
      verdict: 'insufficient', groundedSince: null, reference, recent,
      reasoning: `Transmissions have thinned from ${reference.passesPerDay.toFixed(0)} to ${recent.passesPerDay.toFixed(0)} passes a day, so the fix yield cannot be read as a grounding signal — the antenna is being heard too rarely for any reason, burial and submersion included.`,
    };

  const collapsed = recent.qualityFixesPerPass <= YIELD_COLLAPSE_RATIO * reference.qualityFixesPerPass;
  const still = recentFixes.length === 0 || recent.spreadKm <= STATIONARY_SPREAD_KM;
  const lastQuality = fixes.filter((f) => QUALITY.has(f.quality)).pop();

  if (collapsed && still) {
    const since = lastQuality?.date ?? new Date(recentStart);
    return {
      verdict: 'grounded', groundedSince: since, reference, recent,
      reasoning: `Out of the water since about ${since.toISOString().slice(0, 16).replace('T', ' ')} UTC. Adrift, the tag resolved ${reference.qualityFixesPerPass.toFixed(2)} quality fixes per pass heard across ${reference.spreadKm.toFixed(1)} km of track. In the last ${recentH.toFixed(0)} h it was heard on ${recent.passes} passes and resolved ${recent.qualityFixesPerPass.toFixed(2)} per pass${recentFixes.length ? `, and the ${recentFixes.length} fixes it did produce sit within ${recent.spreadKm.toFixed(1)} km` : ', with no location of any class'}. A tag that stops moving and stops resolving while the satellites still hear it has grounded — beached, hung up, or in someone's hands.`,
    };
  }
  return {
    verdict: 'not_grounded', groundedSince: null, reference, recent,
    reasoning: collapsed
      ? `Fix yield has fallen to ${recent.qualityFixesPerPass.toFixed(2)} per pass from ${reference.qualityFixesPerPass.toFixed(2)}, but the fixes still spread ${recent.spreadKm.toFixed(1)} km in the last ${recentH.toFixed(0)} h, so the tag is moving.`
      : `The tag is still resolving ${recent.qualityFixesPerPass.toFixed(2)} quality fixes per pass against ${reference.qualityFixesPerPass.toFixed(2)} adrift — the Argos geometry has not degraded.`,
  };
}
