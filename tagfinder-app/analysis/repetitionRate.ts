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
      `you are in the wrong place.`,
  };
}
