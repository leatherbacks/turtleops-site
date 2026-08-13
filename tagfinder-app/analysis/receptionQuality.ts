import type { ArgosPass } from '@/lib/types';

/**
 * How much sky can this tag actually see, judged from the received passes alone.
 *
 * The app already had an obstruction diagnostic, but every part of it needed
 * satellite passes predicted from orbital elements: satCoverage compares heard
 * against predicted, antennaExposure reads the elevation and azimuth of the
 * misses. That works while a tag is live and the elements are fresh. It cannot
 * work on a recovered tag, because CelesTrak serves current elements only and
 * propagating them months backwards is not a prediction. Every cold case —
 * which is every tag anyone is trying to learn from — therefore had no
 * obstruction signal at all.
 *
 * This measures the same thing without predicting anything. Argos publishes how
 * many messages a location class requires, so the class of a fix is a direct
 * readout of how many messages got through on that pass. A tag averaging fewer
 * messages per pass than a quality fix needs is, by definition, one whose
 * transmissions are mostly not arriving — and the only thing between a tag and
 * a satellite overhead is whatever is on top of it.
 *
 * Deliberately NOT used here: the error-ellipse ratio. It looks like an
 * obstruction signal — obstructed deployments show wildly elongated ellipses —
 * but the effect is carried entirely by the class mix. Within class 3 alone the
 * median ratio was 2.4:1 on a clear floating tag, 2.7:1 on the same tag after it
 * went into a marsh, and 4.6:1 on a tag recovered buried. The ratio is a proxy
 * for class, so using both would be counting one observation twice.
 */

export type ReceptionVerdict = 'clear' | 'degraded' | 'obstructed' | 'insufficient';

export interface ReceptionQuality {
  verdict: ReceptionVerdict;
  passes: number;
  totalMessages: number;
  /** Mean messages heard per pass — the core measurement. */
  messagesPerPass: number;
  /** Fraction of passes that delivered enough messages for a quality fix. */
  resolvingFraction: number | null;
  /** Locations produced, over passes heard. */
  locationYield: number | null;
  /** Share of locations at class 1, 2 or 3. */
  qualityFixFraction: number | null;
  reasoning: string;
}

/**
 * Argos needs four messages in a pass to solve a class 1-3 position, three for
 * class A and two for class B. So four is not a tuned threshold — it is the
 * point below which a pass cannot produce a fix anyone should navigate on.
 */
const MESSAGES_FOR_QUALITY_FIX = 4;

/**
 * Comfortably above the four-message floor. A tag delivering this many per pass
 * is resolving routinely and has nothing meaningful over it.
 */
const CLEAR_MESSAGES_PER_PASS = 6;

/** Passes needed before the mean means anything. */
const MIN_PASSES = 6;

/**
 * Below this share of passes reaching the four-message floor, most overpasses
 * are being wasted even if the occasional one gets through.
 */
const OBSTRUCTED_RESOLVING_FRACTION = 0.35;

const QUALITY_CLASSES = ['1', '2', '3'];

export function analyzeReceptionQuality(
  passes: ArgosPass[],
  locationCount?: number,
  locationQualities?: string[]
): ReceptionQuality {
  const dated = passes.filter((p) => !isNaN(p.date.getTime()));
  const withCounts = dated.filter((p) => Number.isFinite(p.msgCount) && p.msgCount > 0);

  const base = {
    passes: withCounts.length,
    totalMessages: withCounts.reduce((s, p) => s + p.msgCount, 0),
    resolvingFraction: null as number | null,
    locationYield: null as number | null,
    qualityFixFraction: null as number | null,
  };

  if (withCounts.length < MIN_PASSES) {
    return {
      ...base,
      verdict: 'insufficient',
      messagesPerPass: withCounts.length
        ? base.totalMessages / withCounts.length
        : 0,
      reasoning: `Only ${withCounts.length} pass${withCounts.length === 1 ? '' : 'es'} carry a message count — too few to judge how much sky the tag can see.`,
    };
  }

  const messagesPerPass = base.totalMessages / withCounts.length;
  const resolving = withCounts.filter((p) => p.msgCount >= MESSAGES_FOR_QUALITY_FIX).length;
  const resolvingFraction = resolving / withCounts.length;
  const locationYield =
    locationCount !== undefined ? locationCount / withCounts.length : null;
  const qualityFixFraction =
    locationQualities && locationQualities.length > 0
      ? locationQualities.filter((q) => QUALITY_CLASSES.includes(q)).length /
        locationQualities.length
      : null;

  let verdict: ReceptionVerdict;
  if (messagesPerPass >= CLEAR_MESSAGES_PER_PASS) {
    verdict = 'clear';
  } else if (
    messagesPerPass < MESSAGES_FOR_QUALITY_FIX &&
    resolvingFraction < OBSTRUCTED_RESOLVING_FRACTION
  ) {
    verdict = 'obstructed';
  } else {
    verdict = 'degraded';
  }

  return {
    ...base,
    verdict,
    messagesPerPass: Number(messagesPerPass.toFixed(2)),
    resolvingFraction: Number(resolvingFraction.toFixed(3)),
    locationYield: locationYield === null ? null : Number(locationYield.toFixed(3)),
    qualityFixFraction:
      qualityFixFraction === null ? null : Number(qualityFixFraction.toFixed(3)),
    reasoning: explain(
      verdict,
      withCounts.length,
      messagesPerPass,
      resolvingFraction,
      locationYield,
      qualityFixFraction
    ),
  };
}

function explain(
  verdict: ReceptionVerdict,
  passes: number,
  perPass: number,
  resolving: number,
  yieldRate: number | null,
  qualityFrac: number | null
): string {
  const parts: string[] = [];
  const tail =
    yieldRate !== null
      ? ` ${(yieldRate * 100).toFixed(0)}% of heard passes produced any position at all` +
        (qualityFrac !== null
          ? `, and ${(qualityFrac * 100).toFixed(0)}% of those reached class 1-3.`
          : '.')
      : '';

  if (verdict === 'obstructed') {
    parts.push(
      `Across ${passes} passes the tag delivered ${perPass.toFixed(1)} messages per pass, ` +
        `below the four Argos needs to solve a quality position, and only ` +
        `${(resolving * 100).toFixed(0)}% of passes reached that floor.${tail} ` +
        `A satellite overhead has a clear line to anything on an open surface, so ` +
        `transmissions this reliably lost mean the antenna is covered or screened — ` +
        `sand, wrack, vegetation or debris over the tag rather than beside it.`
    );
  } else if (verdict === 'degraded') {
    parts.push(
      `Across ${passes} passes the tag delivered ${perPass.toFixed(1)} messages per pass, ` +
        `enough to resolve sometimes but well short of an unobstructed tag.${tail} ` +
        `Partial cover, an awkward resting angle, or intermittent wetting would all ` +
        `look like this.`
    );
  } else {
    parts.push(
      `Across ${passes} passes the tag delivered ${perPass.toFixed(1)} messages per pass, ` +
        `comfortably above the four a quality fix needs.${tail} ` +
        `Nothing is meaningfully blocking the antenna.`
    );
  }
  return parts.join(' ');
}
