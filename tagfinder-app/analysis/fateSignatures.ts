/**
 * What happened to a tag underwater, from its depth and temperature record.
 *
 * Two signatures, both from recovered or transmitted time series:
 *
 * 1. Swallowed by a warm-bodied predator. PSAT+ 47128 on a sandbar shark read
 *    32–34.6 °C for six hours at 14–21 m on 14 Sep 2026, in 29 °C water, then
 *    released early the next day. Nothing the animal could swim into is that
 *    much warmer than the warmest water it visited that day; the stomach of a
 *    mako, white shark or tuna is (Hall & James 2021, Endang. Species Res. 46).
 *
 * 2. On the seabed, or carried. MiniPAT 40996 was fouled heavy with barnacles,
 *    floated awash four days after its release off Hatteras, then went dark at
 *    8–18 m for the last two days of its archive. Wildlife Computers read it as
 *    swallowed by a fish. The depth record says otherwise: readings 75 s apart
 *    jittered about ±1 m with no carry-over from one to the next — the pressure
 *    of 4–5 m swell passing over something lying on the bottom — and the
 *    temperature cooled with the buoys. A fish's depth carries over between
 *    readings a minute or two apart; swell overhead does not.
 *
 * Temperature alone cannot separate a cold-blooded fish from the seabed: both
 * sit at the water's temperature. The depth test does.
 *
 * Lotek PSAT depth after the release burn is meaningless (Lotek, 24 Sep 2026),
 * so the caller passes Lotek post-release readings with depth null and the
 * seabed test has nothing to read.
 */

export interface FateSample {
  date: Date;
  depth: number | null;
  temperature: number | null;
  light?: number | null;
}

export interface WarmBodyEvent {
  start: Date;
  end: Date;
  peakC: number;
  /** The warmest water the tag had seen in the day before (95th percentile). */
  waterC: number;
  excessC: number;
  minDepth: number;
  maxDepth: number;
}

export type RestVerdict = 'seabed' | 'carried' | 'unclear';

export interface SubmergedStretch {
  start: Date;
  end: Date;
  depthStart: number;
  /** Deepest hourly median. */
  depthPeak: number;
  depthEnd: number;
  minDepth: number;
  maxDepth: number;
  tempStart: number | null;
  tempEnd: number | null;
  /** Spacing of the readings the test used, seconds. */
  stepS: number;
  /** SD of each reading about its local running mean, m. */
  jitterM: number;
  /** Lag-1 autocorrelation of that jitter: ~0 for swell over a still tag, high for a moving animal. */
  lag1: number;
  /** Same statistic while it floated, for comparison; null without a float. */
  floatLag1: number | null;
  /** Light flat through a daytime: buried, under turbid water, or inside something. */
  dark: boolean | null;
  verdict: RestVerdict;
  reasoning: string;
}

export interface FateSignatures {
  warmBody: WarmBodyEvent[];
  /** When the tag was first seen floating free; null when it never was. */
  floatingFrom: Date | null;
  submerged: SubmergedStretch[];
  /** One line per finding, for the panel and the brief. */
  summary: string[];
}

const HOUR = 3_600_000;

/** Warm-body: this far above the warmest water of the day before. */
const WARM_EXCESS_C = 2.5;
const WARM_MIN_MS = 45 * 60_000;
/** A run of warm readings survives gaps and cooler dips up to this long. */
const WARM_BRIDGE_MS = 60 * 60_000;
/** Deeper than the day's deepest by more than this is water it has not sampled. */
const NEW_DEPTH_M = 5;
/**
 * Underwater at least this deep going into a warm stretch, so sun on the case
 * is ruled out.
 */
const SUBMERGED_M = 5;

/** Floating: at or above this depth (sensor offset and wave wash allowed). */
const FLOAT_M = 1.5;
const FLOAT_MIN_MS = 3 * HOUR;
/** A stretch counts as sunk below this, sustained this long. */
const SUNK_M = 3;
const SUNK_MIN_MS = 3 * HOUR;
/** The seabed test reads no finer than this — swell must be aliased, not resolved. */
const MIN_STEP_MS = 60_000;
const MAX_STEP_MS = 10 * 60_000;
const SEABED_LAG1 = 0.25;
/** Left off each end of a sunk stretch before the jitter test. */
const EDGE_MS = 45 * 60_000;
const CARRIED_LAG1 = 0.5;

const fmt = (d: Date) =>
  d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + 'Z';

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i];
}

function lag1(v: number[]): number {
  if (v.length < 3) return NaN;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < v.length; i++) {
    den += (v[i] - m) ** 2;
    if (i + 1 < v.length) num += (v[i] - m) * (v[i + 1] - m);
  }
  return den > 0 ? num / den : 0;
}

/** Each depth minus the centred running mean of ±k readings. */
function residuals(d: number[], k = 7): number[] {
  const out: number[] = [];
  for (let i = 0; i < d.length; i++) {
    const lo = Math.max(0, i - k);
    const hi = Math.min(d.length, i + k + 1);
    let s = 0;
    for (let j = lo; j < hi; j++) s += d[j];
    out.push(d[i] - s / (hi - lo));
  }
  return out;
}

/** Readings no closer than MIN_STEP_MS, first of each cluster kept. */
function thin<T extends { date: Date }>(xs: T[]): T[] {
  const out: T[] = [];
  for (const x of xs) {
    if (!out.length || x.date.getTime() - out[out.length - 1].date.getTime() >= MIN_STEP_MS) out.push(x);
  }
  return out;
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

export function detectWarmBody(samples: FateSample[]): WarmBodyEvent[] {
  const xs = samples
    .filter((s) => s.temperature !== null && s.depth !== null && Number.isFinite(s.temperature) && Number.isFinite(s.depth))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (xs.length < 20) return [];

  // Warmest water of the previous day (the last 3 h left out, so an event does
  // not raise its own bar), worked out once per hour: a six-month archive at
  // 3 s is millions of readings.
  const t = thin(xs);
  const hourOf = (d: Date) => Math.floor(d.getTime() / HOUR);
  const byHour = new Map<number, number[]>();
  for (const s of t) {
    const h = hourOf(s.date);
    (byHour.get(h) ?? byHour.set(h, []).get(h)!).push(s.temperature!);
  }
  const waterAt = new Map<number, number | null>();
  const water = (h: number) => {
    if (!waterAt.has(h)) {
      const prior: number[] = [];
      for (let k = h - 24; k <= h - 3; k++) prior.push(...(byHour.get(k) ?? []));
      waterAt.set(h, prior.length >= 12 ? quantile(prior.sort((a, b) => a - b), 0.95) : null);
    }
    return waterAt.get(h)!;
  };
  const depthByHour = new Map<number, number[]>();
  for (const s of t) {
    const h = hourOf(s.date);
    (depthByHour.get(h) ?? depthByHour.set(h, []).get(h)!).push(s.depth!);
  }
  // Underwater in the two hours before. Depth during the event is not
  // trusted: a Lotek pressure sensor reads deeper as it warms (47128 read
  // "7.6 m" at 37 °C in the sun before deployment, and 14 → 21 m during its
  // event), so only the depth going in rules out sun on the case.
  const wasSubmerged = (h: number) => {
    const d = [...(depthByHour.get(h - 2) ?? []), ...(depthByHour.get(h - 1) ?? [])];
    return d.length >= 3 && median(d) >= SUBMERGED_M;
  };
  // The warmest water of the day only covers depths the animal visited. In
  // the Gulf in winter the water 30–50 m down runs warmer than the surface;
  // 285931 dived into it for the first time that day, read 25 °C against a
  // 22 °C day, and dropped straight back to 22 °C each time it came up. So a
  // warm stretch must open at a depth already visited in the day before.
  const visitedDepth = (h: number) => {
    const d: number[] = [];
    // The same hours the water figure comes from: depth and temperature sampled together.
    for (let k = h - 24; k <= h - 3; k++) d.push(...(depthByHour.get(k) ?? []));
    return d.length >= 12 ? quantile(d.sort((a, b) => a - b), 0.98) : null;
  };

  // Runs of warm readings, bridging short gaps and dips; a lone reading (a
  // corrupt decode) never makes a run. The water figure is fixed when a run
  // opens, so hours of warm readings do not raise their own bar.
  const events: WarmBodyEvent[] = [];
  let run: { s: FateSample; waterC: number }[] = [];
  const close = () => {
    if (run.length >= 3) {
      const start = run[0].s.date;
      const end = run[run.length - 1].s.date;
      if (end.getTime() - start.getTime() >= WARM_MIN_MS) {
        const peak = run.reduce((a, b) => (b.s.temperature! > a.s.temperature! ? b : a));
        const waterC = run[0].waterC;
        const depths = run.map((r) => r.s.depth!);
        events.push({
          start,
          end,
          peakC: peak.s.temperature!,
          waterC,
          excessC: peak.s.temperature! - waterC,
          minDepth: Math.min(...depths),
          maxDepth: Math.max(...depths),
        });
      }
    }
    run = [];
  };
  for (const s of t) {
    const prev = run[run.length - 1];
    if (prev && s.date.getTime() - prev.s.date.getTime() > WARM_BRIDGE_MS) close();
    const h = hourOf(s.date);
    const waterC = run.length ? run[0].waterC : water(h);
    if (waterC === null || s.temperature! - waterC < WARM_EXCESS_C) continue;
    if (!run.length) {
      const seen = visitedDepth(h);
      if (!wasSubmerged(h) || seen === null || s.depth! > seen + NEW_DEPTH_M) continue;
    }
    run.push({ s, waterC });
  }
  close();
  return events;
}

const BIN_MS = 30 * 60_000;

interface Bin {
  start: number;
  samples: FateSample[];
  medianDepth: number;
}

/**
 * Half-hour bins by median depth. A floating tag washes under now and then and
 * a sunk one is lifted by surge; single readings either side of a threshold
 * must not split a stretch.
 */
function bins(xs: FateSample[]): Bin[] {
  const m = new Map<number, FateSample[]>();
  for (const s of xs) {
    const k = Math.floor(s.date.getTime() / BIN_MS) * BIN_MS;
    (m.get(k) ?? m.set(k, []).get(k)!).push(s);
  }
  return [...m.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([start, samples]) => ({ start, samples, medianDepth: median(samples.map((s) => s.depth!)) }));
}

/** Runs of consecutive bins meeting `ok`, at least `minMs` long. */
function binRuns(bs: Bin[], ok: (b: Bin) => boolean, minMs: number): FateSample[][] {
  const out: FateSample[][] = [];
  let cur: Bin[] = [];
  const close = () => {
    if (cur.length && cur.length * BIN_MS >= minMs) out.push(cur.flatMap((b) => b.samples));
    cur = [];
  };
  for (const b of bs) {
    const prev = cur[cur.length - 1];
    if (!ok(b) || (prev && b.start - prev.start > BIN_MS)) close();
    if (ok(b)) cur.push(b);
  }
  close();
  return out;
}

function stats(xs: FateSample[]): { stepS: number; jitterM: number; lag1: number } | null {
  const t = thin(xs);
  if (t.length < 30) return null;
  const steps = t.slice(1).map((x, i) => x.date.getTime() - t[i].date.getTime());
  const step = median(steps);
  if (step > MAX_STEP_MS) return null;
  const r = residuals(t.map((x) => x.depth!));
  const sd = Math.sqrt(r.reduce((a, b) => a + b * b, 0) / r.length);
  return { stepS: Math.round(step / 1000), jitterM: sd, lag1: lag1(r) };
}

export function classifySubmerged(samples: FateSample[], releaseAt: Date | null = null): {
  floatingFrom: Date | null;
  stretches: SubmergedStretch[];
} {
  const xs = samples
    .filter((s) => s.depth !== null && Number.isFinite(s.depth))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (xs.length < 30) return { floatingFrom: null, stretches: [] };

  // The test only means something once the tag is off the animal. A float of
  // three hours or more after release is the proof of that; before it, a deep
  // steady stretch is just the animal.
  const bs = bins(xs);
  const floats = binRuns(
    bs.filter((b) => !releaseAt || b.start >= releaseAt.getTime() - BIN_MS),
    (b) => b.medianDepth <= FLOAT_M,
    FLOAT_MIN_MS
  );
  if (!floats.length) return { floatingFrom: null, stretches: [] };
  const float = floats[0];
  const fl = { from: float[0].date, until: float[float.length - 1].date };
  const floatStats = stats(float);

  const runs = binRuns(
    bs.filter((b) => b.start > fl.until.getTime()),
    (b) => b.medianDepth >= SUNK_M,
    SUNK_MIN_MS
  );

  const stretches: SubmergedStretch[] = [];
  for (const binned of runs) {
    // From the first reading below SUNK_M to the last: the bins round to the half hour.
    const first = binned.findIndex((x) => x.depth! >= SUNK_M);
    const last = binned.length - 1 - [...binned].reverse().findIndex((x) => x.depth! >= SUNK_M);
    const run = binned.slice(first, last + 1);
    const start = run[0].date;
    const end = run[run.length - 1].date;
    if (end.getTime() - start.getTime() < SUNK_MIN_MS) continue;
    // The sinking and the rising are an animal-like steady change of depth;
    // the jitter test reads the stretch between them.
    const core = run.filter((x) => x.date.getTime() >= start.getTime() + EDGE_MS && x.date.getTime() <= end.getTime() - EDGE_MS);
    const st = stats(core);
    if (!st) continue;
    const depths = run.map((s) => s.depth!);
    const head = run.slice(0, Math.min(run.length, 10)).map((s) => s.depth!);
    const tail = run.slice(-Math.min(run.length, 10)).map((s) => s.depth!);
    const temps = run.filter((s) => s.temperature !== null).map((s) => s.temperature!);
    const lights = run.filter((s) => s.light !== null && s.light !== undefined).map((s) => s.light!);
    const spansDay = end.getTime() - start.getTime() >= 24 * HOUR;
    const ls = [...lights].sort((a, b) => a - b);
    const dark = ls.length > 30 && spansDay ? quantile(ls, 0.95) - quantile(ls, 0.05) <= 6 : null;

    const verdict: RestVerdict = st.lag1 < SEABED_LAG1 ? 'seabed' : st.lag1 >= CARRIED_LAG1 ? 'carried' : 'unclear';
    const dStart = median(head);
    const dEnd = median(tail);
    // Deepest hour, by hourly median, against where it ended.
    const hourly = bins(run).reduce<number[]>((acc, b, i, all) => {
      if (i % 2 === 1) acc.push(median([...all[i - 1].samples, ...b.samples].map((s) => s.depth!)));
      return acc;
    }, []);
    const dPeak = hourly.length ? Math.max(...hourly) : Math.max(dStart, dEnd);
    const depthWord =
      dPeak - dEnd >= 3
        ? `reached about ${dPeak.toFixed(0)} m, then eased back to ${dEnd.toFixed(0)} m — moving shallower`
        : Math.abs(dEnd - dStart) < 2
          ? `held about ${dStart.toFixed(0)} m`
          : `went from ${dStart.toFixed(0)} m to ${dEnd.toFixed(0)} m`;
    const tempWord =
      temps.length > 1 ? ` Temperature ${temps[0].toFixed(1)} → ${temps[temps.length - 1].toFixed(1)} °C.` : '';
    const darkWord = dark ? ' Light stayed flat through the day: buried, under churned water, or inside something.' : '';
    const vsFloat =
      floatStats && Number.isFinite(floatStats.lag1) ? ` (${floatStats.lag1.toFixed(2)} while it floated)` : '';
    const lead = `From ${fmt(start)} to ${fmt(end)} it was below ${SUNK_M} m and ${depthWord}.${tempWord}${darkWord}`;
    const stat = `Readings ${st.stepS} s apart jitter ±${st.jitterM.toFixed(1)} m about their trend, with a carry-over of ${st.lag1.toFixed(2)} from one to the next${vsFloat}.`;
    const reasoning =
      verdict === 'seabed'
        ? `${lead} ${stat} That is swell passing over a tag lying still on the bottom: the pressure changes with every wave, and waves seconds apart are unrelated by the next reading. A fish carrying it would hold its depth from one reading to the next. Check the wave buoy for the same days: jitter of about a quarter of the wave height, less at depth, fits.`
        : verdict === 'carried'
          ? `${lead} ${stat} Depth carries over between readings the way an animal's does: something is carrying the tag — still on the animal, or swallowed. If the temperature sits at the water's, a cold-blooded fish; well above it, see the warm-body check.`
          : `${lead} ${stat} Between the seabed and carried patterns; neither can be called.`;
    stretches.push({
      start,
      end,
      depthStart: dStart,
      depthPeak: dPeak,
      depthEnd: dEnd,
      minDepth: Math.min(...depths),
      maxDepth: Math.max(...depths),
      tempStart: temps[0] ?? null,
      tempEnd: temps[temps.length - 1] ?? null,
      stepS: st.stepS,
      jitterM: st.jitterM,
      lag1: st.lag1,
      floatLag1: floatStats?.lag1 ?? null,
      dark,
      verdict,
      reasoning,
    });
  }
  return { floatingFrom: fl.from, stretches };
}

export function describeWarmBody(w: WarmBodyEvent): string {
  return (
    `${fmt(w.start)}–${fmt(w.end)}: up to ${w.peakC.toFixed(1)} °C, ${w.excessC.toFixed(1)} °C above the warmest ` +
    `water of the day before (${w.waterC.toFixed(1)} °C), while underwater. No water the animal could swim into ` +
    `runs that warm, and sun cannot reach it there: the tag was inside a warm-bodied animal — swallowed by a ` +
    `predator such as a mako, white shark or tuna.`
  );
}

export function analyzeFateSignatures(samples: FateSample[], releaseAt: Date | null = null): FateSignatures | null {
  if (samples.length < 20) return null;
  const warmBody = detectWarmBody(samples);
  const { floatingFrom, stretches } = classifySubmerged(samples, releaseAt);
  const summary: string[] = [];
  for (const w of warmBody) summary.push(describeWarmBody(w));
  for (const s of stretches) summary.push(s.reasoning);
  return { warmBody, floatingFrom, submerged: stretches, summary };
}
