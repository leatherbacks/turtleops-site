import type { RepetitionRate, TransmissionTime } from '@/lib/types';

/**
 * How often does this tag actually transmit?
 *
 * The single most useful number for anyone standing on a beach with a receiver,
 * and the one nobody can look up: it is a per-deployment configuration choice,
 * it rarely appears in an export, and asking the manufacturer takes days. It is
 * recoverable from the message timestamps in about a hundred lines.
 *
 * Without it a field team cannot tell "I am in the wrong place" from "the tag
 * has not fired yet", and that distinction decides whether they walk away from
 * ground that still holds the tag.
 *
 * ── Reading the gap distribution ─────────────────────────────────────────────
 * Consecutive receptions from one satellite are separated by the repetition
 * period, but two things blur that:
 *
 *   1. Duplicate receptions. The same transmission is logged more than once,
 *      seconds apart. An Argos burst lasts well under a second and no PTT
 *      repeats faster than about 40 s, so anything under DUPLICATE_MAX_S cannot
 *      be two scheduled transmissions and is discarded rather than averaged in.
 *      On a reference dataset these were a third of all gaps and would have
 *      dragged the estimate from 61 s down to about 40 s.
 *
 *   2. Missed transmissions. A lost message turns one gap into two periods, so
 *      the distribution has harmonics at 2x, 3x, 4x. Taking a plain mean across
 *      everything overestimates; the estimate comes from the primary cluster
 *      only, and the harmonics are then used as confirmation that the base
 *      period is right.
 *
 * Argos also randomises the period on purpose, so tags do not collide
 * systematically pass after pass. The spread that produces is a real property of
 * the tag, not noise to be averaged away, so it is reported alongside.
 *
 * ── Why a change in the period is a battery warning ──────────────────────────
 * These transmitters buffer each burst in a capacitor, trickle-charged between
 * transmissions, because a small lithium primary cell cannot deliver several
 * hundred milliamps for a few hundred milliseconds without its voltage
 * collapsing. Confirmed in Wildlife Computers hardware and evidently the same
 * approach at Lotek.
 *
 * The consequence is that transmit power tells you nothing about the battery.
 * The capacitor delivers the same burst energy whatever the cell is doing, so
 * received power stays flat right up to the end — on one reference tag it held
 * at -129 dBm across sixteen days, through a four-day dropout, and into its
 * final messages. Reading "no power fade" as "battery healthy" is therefore
 * backwards, and it is a mistake worth guarding against explicitly.
 *
 * What DOES show is the schedule. A tag that hits its low-voltage threshold
 * steps its interval down, typically by an order of magnitude, and may drop out
 * for days and return slower as the cell recovers on rest. That step is the tag
 * announcing it has days left rather than weeks, and for a recovery it is the
 * difference between a steady search and an urgent one.
 */

/** Below this, two receptions are the same transmission logged twice. */
const DUPLICATE_MAX_S = 10;
/** Above this, a gap says more about satellite geometry than the tag. */
const MAX_USEFUL_GAP_S = 900;
/** Gaps beyond this multiple of the period are not used to find the cluster. */
const PRIMARY_CLUSTER_MAX_MULTIPLE = 1.6;
/** Minimum gaps before an estimate is worth making. */
const MIN_SAMPLES = 20;
/** Tolerance when testing whether a gap is a multiple of the base period. */
const HARMONIC_TOLERANCE = 0.15;
/** Interval growth beyond this factor is a schedule step, not jitter. */
const RATE_STEP_RATIO = 3;

/**
 * Consecutive misses before silence means the tag stopped rather than a message
 * being lost. A ground receiver at close range has tens of dB of margin and
 * hears essentially every transmission, so on the beach this is the number that
 * says "move" rather than "wait".
 */
const SILENCE_PERIODS = 3;

function median(xs: number[]): number {
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}

/**
 * Ceiling on gaps when looking for a SLOWED schedule.
 *
 * The normal ceiling exists to stop satellite-coverage gaps polluting a
 * ~60 s estimate. But a tag in low-voltage mode transmits every fifteen to
 * thirty minutes, and those intervals sit above that ceiling — so measuring the
 * late-life period with it discards exactly the data being looked for. This is
 * the same class of mistake as screening health records on the status byte:
 * a filter tuned for the normal case erasing the abnormal one.
 */
const SLOW_MODE_MAX_GAP_S = 7200;

/**
 * Shortest interval the tag is actually observed to use, measured across all
 * satellites at once.
 *
 * The same-satellite method below cannot see a slow schedule. At 60 s one
 * overpass hears a dozen transmissions and the gaps between them are the
 * period; at fifteen minutes a satellite hears the tag once per pass and those
 * gaps measure the orbit instead. Deduplicating transmissions across satellites
 * and taking a low percentile of the gaps works at both rates, because the
 * shortest observed spacing can never be less than the true interval.
 */
function observedInterval(messages: TransmissionTime[]): number | null {
  const times = messages
    .map((m) => m.date.getTime())
    .filter((t) => !isNaN(t))
    .sort((a, b) => a - b);
  if (times.length < 6) return null;
  // One transmission heard by several satellites lands within a few seconds.
  const distinct: number[] = [];
  for (const t of times) {
    if (distinct.length === 0 || t - distinct[distinct.length - 1] >= DUPLICATE_MAX_S * 1000) {
      distinct.push(t);
    }
  }
  if (distinct.length < 5) return null;
  const gaps: number[] = [];
  for (let i = 1; i < distinct.length; i++) gaps.push((distinct[i] - distinct[i - 1]) / 1000);
  gaps.sort((a, b) => a - b);
  // 10th percentile rather than the outright minimum: robust to one coincidence,
  // still far below the median, which is inflated by every missed transmission.
  return gaps[Math.floor(gaps.length * 0.1)];
}

/** Base period from a slice of messages, or null when there is too little. */
function basePeriod(messages: TransmissionTime[], maxGapS = MAX_USEFUL_GAP_S): number | null {
  const bySat = new Map<string, number[]>();
  for (const m of messages) {
    const list = bySat.get(m.satellite) ?? [];
    list.push(m.date.getTime());
    bySat.set(m.satellite, list);
  }
  const gaps: number[] = [];
  for (const times of Array.from(bySat.values())) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const d = (times[i] - times[i - 1]) / 1000;
      if (d >= DUPLICATE_MAX_S && d <= maxGapS) gaps.push(d);
    }
  }
  if (gaps.length < 5) return null;
  let p = median(gaps.filter((g) => g <= median(gaps)));
  for (let i = 0; i < 2; i++) {
    const c = gaps.filter((g) => g <= p * PRIMARY_CLUSTER_MAX_MULTIPLE);
    if (c.length === 0) break;
    p = median(c);
  }
  return p;
}

export function estimateRepetitionRate(
  messages: TransmissionTime[]
): RepetitionRate | null {
  if (messages.length < MIN_SAMPLES) return null;

  // Gaps between consecutive receptions by the SAME satellite. Mixing
  // satellites would measure the constellation, not the tag.
  const bySat = new Map<string, number[]>();
  for (const m of messages) {
    const t = m.date.getTime();
    if (isNaN(t)) continue;
    const list = bySat.get(m.satellite) ?? [];
    list.push(t);
    bySat.set(m.satellite, list);
  }

  const gaps: number[] = [];
  let duplicates = 0;
  for (const times of Array.from(bySat.values())) {
    times.sort((a, b) => a - b);
    for (let i = 1; i < times.length; i++) {
      const d = (times[i] - times[i - 1]) / 1000;
      if (d <= 0 || d > MAX_USEFUL_GAP_S) continue;
      if (d < DUPLICATE_MAX_S) {
        duplicates++;
        continue;
      }
      gaps.push(d);
    }
  }
  if (gaps.length < MIN_SAMPLES) return null;

  // The primary cluster is everything at or below roughly one period. Seed it
  // from the lower half of the distribution, which cannot be dominated by
  // harmonics, then refine once.
  let period = median(gaps.filter((g) => g <= median(gaps)));
  for (let pass = 0; pass < 2; pass++) {
    const cluster = gaps.filter((g) => g <= period * PRIMARY_CLUSTER_MAX_MULTIPLE);
    if (cluster.length === 0) break;
    period = median(cluster);
  }

  const primary = gaps.filter((g) => g <= period * PRIMARY_CLUSTER_MAX_MULTIPLE);
  if (primary.length < MIN_SAMPLES / 2) return null;

  const jitter = stdev(primary);

  // Harmonics confirm the base period: a lost message turns one gap into two.
  const harmonics: RepetitionRate['harmonics'] = [];
  for (let k = 2; k <= 5; k++) {
    const lo = period * k * (1 - HARMONIC_TOLERANCE);
    const hi = period * k * (1 + HARMONIC_TOLERANCE);
    const count = gaps.filter((g) => g >= lo && g <= hi).length;
    if (count > 0) harmonics.push({ multiple: k, count });
  }

  const explained =
    (primary.length + harmonics.reduce((s, h) => s + h.count, 0)) / gaps.length;

  const confidence: RepetitionRate['confidence'] =
    primary.length >= 100 && explained >= 0.75
      ? 'high'
      : primary.length >= 40 && explained >= 0.5
        ? 'moderate'
        : 'low';

  const silenceThresholdS = Math.round(period * SILENCE_PERIODS);

  // Has the schedule stepped down? A tag that reaches its low-voltage threshold
  // lengthens its interval sharply, and that — not received power — is the
  // end-of-life signal.
  //
  // Split by TIME, not by message count. A tag that has slowed by twenty times
  // produces very few messages in its final days, so a count-based split puts
  // the whole tail inside the "early" slice and the step becomes invisible. The
  // period is what changed; the volume changing is the same fact, and splitting
  // on it hides the thing being measured.
  const sortedMsgs = messages
    .filter((m) => !isNaN(m.date.getTime()))
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  const t0 = sortedMsgs[0].date.getTime();
  const t1 = sortedMsgs[sortedMsgs.length - 1].date.getTime();
  const quarter = (t1 - t0) / 4;
  const earlySlice = sortedMsgs.filter((m) => m.date.getTime() <= t0 + quarter);
  const lateSlice = sortedMsgs.filter((m) => m.date.getTime() >= t1 - quarter);
  const earlyPeriod = observedInterval(earlySlice);
  const latePeriod = observedInterval(lateSlice);
  const stepRatio =
    earlyPeriod !== null && latePeriod !== null && earlyPeriod > 0
      ? latePeriod / earlyPeriod
      : null;
  const slowedDown = stepRatio !== null && stepRatio >= RATE_STEP_RATIO;

  return {
    periodS: Math.round(period),
    jitterS: Math.round(jitter),
    observedMinS: Math.round(Math.min(...primary)),
    observedMaxS: Math.round(Math.max(...primary)),
    sampleCount: primary.length,
    duplicatesDiscarded: duplicates,
    harmonics,
    fractionExplained: explained,
    silenceThresholdS,
    earlyPeriodS: earlyPeriod === null ? null : Math.round(earlyPeriod),
    latePeriodS: latePeriod === null ? null : Math.round(latePeriod),
    rateStepRatio: stepRatio === null ? null : Math.round(stepRatio * 10) / 10,
    slowedDown,
    confidence,
    reasoning:
      `Transmits about every ${Math.round(period)} s ` +
      `(observed ${Math.round(Math.min(...primary))}–${Math.round(Math.max(...primary))} s ` +
      `across ${primary.length} intervals; Argos randomises the period so tags do not collide). ` +
      (harmonics.length > 0
        ? `Gaps at ${harmonics.map((h) => `${h.multiple}×`).join(', ')} the period account for ` +
          `another ${harmonics.reduce((s, h) => s + h.count, 0)} intervals — those are lost ` +
          `messages, not pauses. `
        : '') +
      `On a receiver at close range expect it roughly every ${Math.round(period)} s: a silence ` +
      `beyond about ${silenceThresholdS} s means the tag has stopped radiating rather than that ` +
      `you are in the wrong place.` +
      (slowedDown
        ? ` \n\nEND OF LIFE: the interval has stepped from about ${Math.round(earlyPeriod!)} s ` +
          `early in the record to about ${Math.round(latePeriod!)} s recently, a factor of ` +
          `${stepRatio!.toFixed(1)}. These tags buffer each burst in a capacitor, so transmit ` +
          `power stays flat whatever the cell is doing and tells you nothing — the schedule ` +
          `stepping down is how a low-voltage threshold shows itself. Expect days rather than ` +
          `weeks of transmissions left, and treat the search as urgent.`
        : ''),
  };
}
