import type { ArgosPass, TideExtreme, TidePhaseAnalysis, TidePhaseBin } from '@/lib/types';

/**
 * Does the tag's reception track the tide?
 *
 * A tag sitting in the intertidal, awash in weed, or grounded on a bank is not
 * uniformly audible. Its antenna clears the water, lies down, floats up, or gets
 * buried as the tide works it, and the messages that reach a satellite cluster
 * into whatever part of the cycle leaves the antenna upright and in air. Finding
 * that pattern tells a field team when to be standing there with a receiver.
 *
 * Two traps are built into this, both learned from getting them wrong on
 * a reference PSAT+ deployment:
 *
 * 1. EXPOSURE. Satellite passes are not uniform in time and neither are tides.
 *    If passes cluster in hours that align with one phase, message counts follow
 *    and look exactly like a tidal effect. On the reference deployment the raw split was 3.7:1, but
 *    1.7x of that was simply more passes occurring on ebbing tides. So messages
 *    are never judged alone — passes are the exposure baseline, and only the
 *    excess beyond what the pass distribution predicts counts.
 *
 * 2. WINDOW CHOICE. A tag's relationship with the tide changes when its
 *    situation does. Across the reference deployment's whole record the corrected effect is 1.09x
 *    — a tag drifting freely offshore, heard on any tide. From the moment it
 *    stopped producing positions it is about 2.2x. A 3-day window straddles the
 *    transition and reports 0.94x, washing out a real effect. So several windows
 *    are evaluated and they must agree; a result appearing at only one cutoff is
 *    a result of choosing that cutoff, and is reported as unstable.
 */

/** Windows to try, in days back from the last message received. */
const CANDIDATE_WINDOW_DAYS = [1.5, 2, 3, 5];
/** Below this many messages, any split is noise. */
const MIN_MESSAGES = 40;
/** Minimum passes on each phase before a comparison means anything. */
const MIN_PASSES_PER_PHASE = 3;
/** Excess beyond exposure needed before the effect is worth acting on. */
const STRONG_EXCESS = 1.8;
const MODERATE_EXCESS = 1.3;
/** Level bands, as fractions of the tidal range. */
const BAND_COUNT = 5;

type Direction = 'falling' | 'rising';

interface Phase {
  direction: Direction;
  /** 0 at the opening extreme, 1 at the closing one. */
  fraction: number;
  /** 0 at low water, 1 at high water. */
  level: number;
}

interface Split {
  messages: Record<Direction, number>;
  passes: Record<Direction, number>;
  perPass: Record<Direction, number>;
  /** Ratio in favour of the dominant phase; below threshold it is still
   *  recorded, so the cross-window agreement check can see it. */
  excess: number | null;
  dominant: Direction | 'neither';
  bins: TidePhaseBin[];
  totalMessages: number;
  placed: number;
}

/**
 * Where in the tide a moment falls.
 *
 * Height between extremes is modelled as a half cosine — the standard
 * approximation, accurate enough for binning. Returns null outside the table
 * rather than extrapolating: a pass we cannot place is excluded, not guessed at.
 */
export function tidePhaseAt(when: Date, extremes: TideExtreme[]): Phase | null {
  const t = when.getTime();
  for (let i = 0; i < extremes.length - 1; i++) {
    const a = extremes[i];
    const b = extremes[i + 1];
    const ta = a.time.getTime();
    const tb = b.time.getTime();
    if (t < ta || t >= tb || tb <= ta) continue;
    const fraction = (t - ta) / (tb - ta);
    const rising = a.type === 'L';
    const level = rising
      ? (1 - Math.cos(Math.PI * fraction)) / 2
      : (1 + Math.cos(Math.PI * fraction)) / 2;
    return { direction: rising ? 'rising' : 'falling', fraction, level };
  }
  return null;
}

/** Fraction through a leg at which a given level occurs — the inverse of above. */
function fractionAtLevel(level: number, direction: Direction): number {
  const clamped = Math.min(1, Math.max(0, level));
  return direction === 'rising'
    ? Math.acos(1 - 2 * clamped) / Math.PI
    : Math.acos(2 * clamped - 1) / Math.PI;
}

function bandLabel(index: number): string {
  const lo = index * (100 / BAND_COUNT);
  const hi = (index + 1) * (100 / BAND_COUNT);
  const suffix = index === 0 ? ' (low)' : index === BAND_COUNT - 1 ? ' (high)' : '';
  return `${lo.toFixed(0)}–${hi.toFixed(0)}%${suffix}`;
}

function splitByPhase(passes: ArgosPass[], extremes: TideExtreme[]): Split {
  const messages: Record<Direction, number> = { falling: 0, rising: 0 };
  const passCounts: Record<Direction, number> = { falling: 0, rising: 0 };
  const bins: TidePhaseBin[] = Array.from({ length: BAND_COUNT }, (_, i) => ({
    label: bandLabel(i),
    fallingMessages: 0,
    risingMessages: 0,
  }));
  let placed = 0;

  for (const pass of passes) {
    const phase = tidePhaseAt(pass.date, extremes);
    if (!phase) continue;
    placed++;
    // msgCount can be 0 on a pass that delivered nothing; it still counts as
    // exposure, because it was an opportunity to be heard.
    const n = Math.max(0, pass.msgCount);
    messages[phase.direction] += n;
    passCounts[phase.direction] += 1;
    const band = Math.min(BAND_COUNT - 1, Math.floor(phase.level * BAND_COUNT));
    if (phase.direction === 'falling') bins[band].fallingMessages += n;
    else bins[band].risingMessages += n;
  }

  const perPass: Record<Direction, number> = {
    falling: passCounts.falling > 0 ? messages.falling / passCounts.falling : 0,
    rising: passCounts.rising > 0 ? messages.rising / passCounts.rising : 0,
  };

  let dominant: Direction | 'neither' = 'neither';
  let excess: number | null = null;
  if (perPass.falling > 0 && perPass.rising > 0) {
    const r = perPass.falling / perPass.rising;
    if (r >= MODERATE_EXCESS) {
      dominant = 'falling';
      excess = r;
    } else if (1 / r >= MODERATE_EXCESS) {
      dominant = 'rising';
      excess = 1 / r;
    } else {
      excess = r;
    }
  } else if (perPass.falling > 0) {
    dominant = 'falling';
  } else if (perPass.rising > 0) {
    dominant = 'rising';
  }

  return {
    messages,
    passes: passCounts,
    perPass,
    excess,
    dominant,
    bins,
    totalMessages: messages.falling + messages.rising,
    placed,
  };
}

export function analyzeTidePhase(
  passes: ArgosPass[],
  extremes: TideExtreme[],
  now: Date = new Date()
): TidePhaseAnalysis | null {
  if (extremes.length < 2 || passes.length === 0) return null;

  const sorted = extremes
    .filter((e) => !isNaN(e.time.getTime()))
    .slice()
    .sort((a, b) => a.time.getTime() - b.time.getTime());
  if (sorted.length < 2) return null;

  const dated = passes.filter((p) => !isNaN(p.date.getTime()));
  if (dated.length === 0) return null;
  const lastHeard = Math.max(...dated.map((p) => p.date.getTime()));

  // Every candidate window with enough traffic and exposure on both phases,
  // shortest first — the shortest describes the tag's current situation.
  const candidates: { days: number | null; subset: ArgosPass[]; split: Split }[] = [];
  for (const days of [...CANDIDATE_WINDOW_DAYS, null]) {
    const subset =
      days === null
        ? dated
        : dated.filter((p) => p.date.getTime() >= lastHeard - days * 86_400_000);
    const split = splitByPhase(subset, sorted);
    if (split.totalMessages < MIN_MESSAGES) continue;
    if (split.passes.falling < MIN_PASSES_PER_PHASE) continue;
    if (split.passes.rising < MIN_PASSES_PER_PHASE) continue;
    candidates.push({ days, subset, split });
  }

  if (candidates.length === 0) {
    const split = splitByPhase(dated, sorted);
    return build(split, dated, null, false, null, sorted, now);
  }

  const primary = candidates[0];

  // Agreement across windows. A finding that survives at only one boundary is
  // an artefact of that boundary.
  const ratios = candidates
    .map((c) => c.split.excess)
    .filter((r): r is number => r !== null && isFinite(r));
  const robust =
    ratios.length > 1 &&
    (ratios.every((r) => r >= MODERATE_EXCESS) ||
      ratios.every((r) => r <= 1 / MODERATE_EXCESS));
  const spread: [number, number] | null = ratios.length
    ? [Math.min(...ratios), Math.max(...ratios)]
    : null;

  return build(primary.split, primary.subset, primary.days, robust, spread, sorted, now);
}

function build(
  split: Split,
  subset: ArgosPass[],
  windowDays: number | null,
  robust: boolean,
  spread: [number, number] | null,
  extremes: TideExtreme[],
  now: Date
): TidePhaseAnalysis {
  const enough = split.totalMessages >= MIN_MESSAGES;
  const strength: TidePhaseAnalysis['strength'] =
    !enough || split.dominant === 'neither' || !robust
      ? 'none'
      : split.excess === null || split.excess >= STRONG_EXCESS
        ? 'strong'
        : 'moderate';

  const times = subset.map((p) => p.date.getTime()).filter((t) => !isNaN(t));
  const bestWindow =
    strength === 'none'
      ? null
      : nextWindow(extremes, split.dominant as Direction, split.bins, now);

  return {
    fallingMessages: split.messages.falling,
    risingMessages: split.messages.rising,
    fallingPasses: split.passes.falling,
    risingPasses: split.passes.rising,
    messagesPerPassFalling: split.perPass.falling,
    messagesPerPassRising: split.perPass.rising,
    excessRatio: split.excess,
    dominant: strength === 'none' ? 'neither' : split.dominant,
    strength,
    robust,
    excessRange: spread,
    bins: split.bins,
    bestWindow,
    coverage: subset.length > 0 ? split.placed / subset.length : 0,
    windowDays,
    analyzedFrom: new Date(times.length ? Math.min(...times) : NaN),
    analyzedTo: new Date(times.length ? Math.max(...times) : NaN),
    reasoning: explain(split, strength, robust, spread, windowDays),
  };
}

/**
 * The next stretch of the productive phase, narrowed to the level band that
 * actually carried the most traffic.
 */
function nextWindow(
  extremes: TideExtreme[],
  direction: Direction,
  bins: TidePhaseBin[],
  now: Date
): TidePhaseAnalysis['bestWindow'] {
  const wantOpening = direction === 'falling' ? 'H' : 'L';
  const t = now.getTime();

  for (let i = 0; i < extremes.length - 1; i++) {
    const a = extremes[i];
    const b = extremes[i + 1];
    if (a.type !== wantOpening) continue;
    if (b.time.getTime() <= t) continue;

    const key = direction === 'falling' ? 'fallingMessages' : 'risingMessages';
    let peak = 0;
    for (let k = 1; k < BAND_COUNT; k++) if (bins[k][key] > bins[peak][key]) peak = k;

    const span = b.time.getTime() - a.time.getTime();
    const f1 = fractionAtLevel(peak / BAND_COUNT, direction);
    const f2 = fractionAtLevel((peak + 1) / BAND_COUNT, direction);
    return {
      legFrom: a.time,
      legTo: b.time,
      peakFrom: new Date(a.time.getTime() + Math.min(f1, f2) * span),
      peakTo: new Date(a.time.getTime() + Math.max(f1, f2) * span),
      peakBandLabel: bins[peak].label,
    };
  }
  return null;
}

function explain(
  split: Split,
  strength: TidePhaseAnalysis['strength'],
  robust: boolean,
  spread: [number, number] | null,
  windowDays: number | null
): string {
  const scope = windowDays
    ? `Over the last ${windowDays} days of reception, `
    : `Across the whole reception record, `;
  const counts =
    `${scope}${split.messages.falling} messages arrived on the falling tide across ` +
    `${split.passes.falling} passes (${split.perPass.falling.toFixed(1)} per pass), against ` +
    `${split.messages.rising} on the rising tide across ${split.passes.rising} passes ` +
    `(${split.perPass.rising.toFixed(1)} per pass).`;

  if (split.totalMessages < MIN_MESSAGES) {
    return (
      `${counts} That is too little traffic to read a tidal pattern from — at least ` +
      `${MIN_MESSAGES} messages are needed before the split means anything.`
    );
  }

  if (strength === 'none' && !robust && spread && spread[1] >= MODERATE_EXCESS) {
    return (
      `${counts} A tidal effect shows up over some spans (excess ranging ` +
      `${spread[0].toFixed(2)}x to ${spread[1].toFixed(2)}x) but not others, so it depends on ` +
      `where the window is drawn and is not solid enough to plan a search around. It may be ` +
      `real but masked by a change in the tag's situation partway through the record — worth ` +
      `revisiting when more data arrives.`
    );
  }

  if (strength === 'none') {
    return (
      `${counts} Reception is even across the tide once pass counts are accounted for, ` +
      `so there is no tidal window to work — search whenever suits.`
    );
  }

  const ratio =
    split.excess === null
      ? `Every message arrived on the ${split.dominant} tide.`
      : `Corrected for how the passes fell, the tag is heard ${split.excess.toFixed(1)}x more ` +
        `often per pass on the ${split.dominant} tide, consistently across every window tested` +
        (spread ? ` (${spread[0].toFixed(1)}x–${spread[1].toFixed(1)}x)` : '') + `.`;

  const other = split.dominant === 'falling' ? 'rising' : 'falling';
  const meaning =
    strength === 'strong'
      ? ` Work the ${split.dominant} tide, and do not read silence on the ${other} tide as ` +
        `absence — ground swept then needs sweeping again.`
      : ` The effect is real but modest; prefer the ${split.dominant} tide without planning ` +
        `the whole day around it.`;

  return `${counts} ${ratio}${meaning}`;
}
