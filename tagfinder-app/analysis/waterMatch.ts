import { solarElevationDeg, dayPhase, type DayPhase } from './solar';

/**
 * Is the tag in the water, and if it stopped being in the water, when?
 *
 * Distinct from compareTemperatures, which asks the same question of the record
 * as a whole against a single reference temperature. Two things go wrong with
 * that on a real deployment:
 *
 * 1. A single sea-surface figure cannot carry a trend. On the deployment that
 *    motivated this, the bay warmed from 30.1 to 32.0 C over the six days the
 *    tag was transmitting — comparable to the signal being looked for. Depending
 *    which day's snapshot you take, a tag that left the water either looks
 *    normal or a tag that never left looks anomalous. Comparing each reading
 *    against the water temperature AT THAT READING'S OWN TIME removes the trend
 *    entirely, and it is the only way a single reading means anything.
 *
 * 2. One verdict for the whole record is the wrong shape of answer. That same
 *    tag was immersed for three days and exposed for the next three; averaged,
 *    it reads as neither. The useful output is the TIME IT CHANGED, because
 *    paired with the position track that says where it came ashore.
 *
 * The physical asymmetry this leans on: a floating tag can run warmer than the
 * water — sun on a dark housing, the sensor riding in air on the exposed upper
 * face — but it cannot run meaningfully COLDER than the water it is immersed
 * in. There is nothing to cool it. A reading well below local water temperature
 * is therefore close to proof of exposure on its own, where a warm reading is
 * only suggestive.
 */

export interface WaterTempSample {
  date: Date;
  temperatureC: number;
}

export interface TagTempReading {
  date: Date;
  temperatureC: number;
}

export interface MatchedReading {
  date: Date;
  tagC: number;
  waterC: number;
  /** tag minus water at the same moment. */
  deltaC: number;
  solarElevationDeg: number;
  phase: DayPhase;
}

export type ImmersionVerdict = 'immersed' | 'exposed' | 'unclear';

export interface ImmersionSegment {
  from: Date;
  to: Date;
  n: number;
  medianDeltaC: number;
  /** p10-p90 spread of delta — how much the tag swings relative to the water. */
  spreadC: number;
  verdict: ImmersionVerdict;
}

export interface DiurnalSignature {
  dayMedianC: number | null;
  nightMedianC: number | null;
  /** day minus night. Large and positive is the signature of air exposure. */
  separationC: number | null;
  nDay: number;
  nNight: number;
}

export interface WaterMatchAnalysis {
  available: boolean;
  matched: MatchedReading[];
  segments: ImmersionSegment[];
  /**
   * Bracket around the moment the record changes regime. Null when the record
   * is all one thing, which is the common and unremarkable case.
   */
  transition: {
    lastImmersed: Date;
    firstExposed: Date;
    confidence: number;
  } | null;
  diurnal: DiurnalSignature | null;
  /** The single most extreme cold excursion — the strongest evidence available. */
  coldestDeltaC: number | null;
  verdict: ImmersionVerdict;
  reasoning: string;
  unmatchedReadings: number;
}

/**
 * A water sample further than this from a tag reading is describing a different
 * state of the water. An hour is comfortable at NOAA's 6-minute cadence and
 * still tolerates a gauge outage without discarding the reading.
 */
const MAX_MATCH_GAP_MS = 60 * 60_000;

/** Readings needed on each side before a split is worth believing. */
const MIN_SEGMENT_READINGS = 4;

/**
 * A tag floating in water tracks it closely. This is the p10-p90 spread of
 * delta, not the extreme range, so one bad reading does not breach it.
 */
const IMMERSED_SPREAD_MAX_C = 2.5;

/** A regime change has to widen the spread by at least this factor. */
const SPREAD_RATIO_FOR_CHANGE = 2;

/**
 * How far a reading must sit from the established immersed offset before it
 * counts as a departure.
 *
 * Set above the spread an immersed tag shows, so ordinary scatter cannot trip
 * it, but well below the excursions an exposed tag produces once the sun is on
 * it. The offset itself is allowed to be non-zero — a gauge tens of kilometres
 * away is routinely half a degree out — which is why this measures distance
 * from the running median rather than from zero.
 */
const DEPARTURE_C = 2;

/**
 * Cold enough, relative to the water, that immersion is not physically
 * available as an explanation.
 */
const IMPOSSIBLE_COLD_DELTA_C = -3;

/** Day-minus-night delta separation that marks a body following the sun. */
const DIURNAL_SEPARATION_MIN_C = 2;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

/**
 * p10-p90 rather than min-max. The excursions ARE the signal here, so a fully
 * robust statistic like MAD is the wrong tool — on the reference deployment the
 * exposed half had a LOWER median absolute deviation than the immersed half,
 * because most of its readings clustered while a few swung hard. Trimming only
 * the outer decile keeps the swing visible without letting a single corrupt
 * record define the answer.
 */
function spread(values: number[]): number {
  if (values.length < 2) return 0;
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 0.9) - quantile(s, 0.1);
}

/** Nearest water sample in time, or null if none is close enough. */
function waterAt(samples: WaterTempSample[], t: number): number | null {
  let best: WaterTempSample | null = null;
  let bestGap = Infinity;
  for (const s of samples) {
    const gap = Math.abs(s.date.getTime() - t);
    if (gap < bestGap) {
      bestGap = gap;
      best = s;
    }
  }
  return best && bestGap <= MAX_MATCH_GAP_MS ? best.temperatureC : null;
}

export function matchToWater(
  readings: TagTempReading[],
  water: WaterTempSample[],
  lat: number,
  lon: number
): { matched: MatchedReading[]; unmatched: number } {
  const usableWater = water.filter(
    (w) => !isNaN(w.date.getTime()) && Number.isFinite(w.temperatureC)
  );
  const matched: MatchedReading[] = [];
  let unmatched = 0;

  for (const r of readings) {
    const t = r.date.getTime();
    if (!Number.isFinite(t) || !Number.isFinite(r.temperatureC)) {
      unmatched++;
      continue;
    }
    const w = waterAt(usableWater, t);
    if (w === null) {
      unmatched++;
      continue;
    }
    const elev = solarElevationDeg(r.date, lat, lon);
    matched.push({
      date: r.date,
      tagC: r.temperatureC,
      waterC: w,
      deltaC: Number((r.temperatureC - w).toFixed(2)),
      solarElevationDeg: Number(elev.toFixed(1)),
      phase: dayPhase(elev),
    });
  }

  matched.sort((a, b) => a.date.getTime() - b.date.getTime());
  return { matched, unmatched };
}

function diurnalOf(rows: MatchedReading[]): DiurnalSignature {
  const day = rows.filter((r) => r.phase === 'day').map((r) => r.deltaC);
  const night = rows.filter((r) => r.phase === 'night').map((r) => r.deltaC);
  const dayMedianC = day.length ? Number(median(day).toFixed(2)) : null;
  const nightMedianC = night.length ? Number(median(night).toFixed(2)) : null;
  return {
    dayMedianC,
    nightMedianC,
    separationC:
      dayMedianC !== null && nightMedianC !== null
        ? Number((dayMedianC - nightMedianC).toFixed(2))
        : null,
    nDay: day.length,
    nNight: night.length,
  };
}

function verdictOf(rows: MatchedReading[]): ImmersionVerdict {
  if (rows.length === 0) return 'unclear';
  const deltas = rows.map((r) => r.deltaC);
  const coldest = Math.min(...deltas);

  // One reading well below the water settles it — nothing immersed has a
  // mechanism to be colder than what it is immersed in.
  if (coldest <= IMPOSSIBLE_COLD_DELTA_C) return 'exposed';

  const sp = spread(deltas);
  const dn = diurnalOf(rows);
  if (
    dn.separationC !== null &&
    dn.separationC >= DIURNAL_SEPARATION_MIN_C &&
    dn.nDay >= 2 &&
    dn.nNight >= 2
  ) {
    return 'exposed';
  }
  if (rows.length < 3) return 'unclear';
  return sp <= IMMERSED_SPREAD_MAX_C ? 'immersed' : 'unclear';
}

function segmentOf(rows: MatchedReading[]): ImmersionSegment {
  const deltas = rows.map((r) => r.deltaC);
  return {
    from: rows[0].date,
    to: rows[rows.length - 1].date,
    n: rows.length,
    medianDeltaC: Number(median(deltas).toFixed(2)),
    spreadC: Number(spread(deltas).toFixed(2)),
    verdict: verdictOf(rows),
  };
}

export function analyzeWaterMatch(
  readings: TagTempReading[],
  water: WaterTempSample[],
  lat: number,
  lon: number
): WaterMatchAnalysis {
  const { matched, unmatched } = matchToWater(readings, water, lat, lon);

  const empty: WaterMatchAnalysis = {
    available: false,
    matched,
    segments: [],
    transition: null,
    diurnal: null,
    coldestDeltaC: null,
    verdict: 'unclear',
    reasoning: '',
    unmatchedReadings: unmatched,
  };

  if (matched.length < 3) {
    return {
      ...empty,
      reasoning:
        matched.length === 0
          ? 'No tag temperature reading falls within an hour of a water-temperature observation, so no comparison is possible.'
          : `Only ${matched.length} tag reading${matched.length === 1 ? '' : 's'} could be matched to water temperature — too few to characterise the tag's environment.`,
    };
  }

  const deltas = matched.map((r) => r.deltaC);
  const coldestDeltaC = Number(Math.min(...deltas).toFixed(2));

  // Find the first reading that immersion cannot explain.
  //
  // The obvious approach — scan every split and take the one that most widens
  // the spread of delta — does not work, and fails in a direction that matters.
  // It is biased toward early cuts: an early segment is naturally tighter, which
  // shrinks the denominator, so the best "ratio" sits at the end of the quietest
  // run rather than at the regime boundary. On the reference deployment that put
  // the tag ashore on 8 August when it was still tracking the water until the
  // 10th — two days early, and two days of drift track wrongly discarded.
  //
  // So the boundary is defined the way the physics defines it: establish what
  // immersion looks like for THIS tag against THIS gauge, then walk forward to
  // the first reading that departs from it and stays departed. The baseline is
  // recomputed from everything so far at each step, so a slow trend in the
  // offset (a gauge some distance away, a tag drifting between water masses)
  // does not accumulate into a false departure.
  const baselineRows = matched.slice(0, MIN_SEGMENT_READINGS);
  const baselineQualifies =
    spread(baselineRows.map((r) => r.deltaC)) <= IMMERSED_SPREAD_MAX_C &&
    Math.min(...baselineRows.map((r) => r.deltaC)) > IMPOSSIBLE_COLD_DELTA_C;

  let splitAt: number | null = null;
  if (baselineQualifies) {
    for (let j = MIN_SEGMENT_READINGS; j <= matched.length - MIN_SEGMENT_READINGS; j++) {
      const base = median(deltas.slice(0, j));
      const departed =
        Math.abs(deltas[j] - base) >= DEPARTURE_C || deltas[j] <= IMPOSSIBLE_COLD_DELTA_C;
      if (!departed) continue;
      // One excursion is a bad reading; a regime change persists.
      if (verdictOf(matched.slice(j)) !== 'exposed') continue;
      splitAt = j;
      break;
    }
  }

  let segments: ImmersionSegment[];
  let transition: WaterMatchAnalysis['transition'] = null;

  if (splitAt !== null) {
    const beforeRows = matched.slice(0, splitAt);
    const afterRows = matched.slice(splitAt);
    segments = [segmentOf(beforeRows), segmentOf(afterRows)];
    if (segments[0].verdict === 'immersed' && segments[1].verdict === 'exposed') {
      const widening =
        segments[0].spreadC > 0.01
          ? segments[1].spreadC / segments[0].spreadC
          : SPREAD_RATIO_FOR_CHANGE;
      transition = {
        lastImmersed: beforeRows[beforeRows.length - 1].date,
        firstExposed: afterRows[0].date,
        confidence: Math.min(0.95, 0.5 + Math.min(widening, 6) / 12),
      };
    } else {
      // Departure found but the halves do not cleanly disagree — report the
      // record whole rather than asserting a boundary the data will not carry.
      segments = [segmentOf(matched)];
    }
  } else {
    segments = [segmentOf(matched)];
  }

  const diurnal = diurnalOf(transition ? matched.slice(splitAt!) : matched);
  const verdict = transition
    ? 'exposed'
    : segments.length === 1
      ? segments[0].verdict
      : verdictOf(matched);

  return {
    available: true,
    matched,
    segments,
    transition,
    diurnal,
    coldestDeltaC,
    verdict,
    reasoning: explain(matched, segments, transition, diurnal, coldestDeltaC, verdict),
    unmatchedReadings: unmatched,
  };
}

function fmtDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function fmtTime(d: Date): string {
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)}Z`;
}

function explain(
  matched: MatchedReading[],
  segments: ImmersionSegment[],
  transition: WaterMatchAnalysis['transition'],
  diurnal: DiurnalSignature,
  coldest: number,
  verdict: ImmersionVerdict
): string {
  const n = matched.length;
  const parts: string[] = [];

  if (transition) {
    const [a, b] = segments;
    parts.push(
      `Tag temperature tracked the water to within a ${a.spreadC.toFixed(1)} °C spread ` +
        `across ${a.n} readings from ${fmtDay(a.from)}, then broke away: ` +
        `${b.n} readings from ${fmtDay(b.from)} spread ${b.spreadC.toFixed(1)} °C. ` +
        `The tag left the water between ${fmtTime(transition.lastImmersed)} and ` +
        `${fmtTime(transition.firstExposed)}.`
    );
  } else if (verdict === 'immersed') {
    parts.push(
      `Across ${n} readings the tag held within a ${segments[0].spreadC.toFixed(1)} °C spread ` +
        `of water temperature at the same moments (median ` +
        `${segments[0].medianDeltaC > 0 ? '+' : ''}${segments[0].medianDeltaC.toFixed(1)} °C). ` +
        `Consistent throughout with a tag in the water.`
    );
  } else if (verdict === 'exposed') {
    parts.push(
      `Across ${n} readings the tag did not track water temperature ` +
        `(spread ${segments[segments.length - 1].spreadC.toFixed(1)} °C).`
    );
  } else {
    parts.push(
      `Across ${n} readings the comparison against water temperature is inconclusive ` +
        `(spread ${segments[segments.length - 1].spreadC.toFixed(1)} °C).`
    );
  }

  if (coldest <= IMPOSSIBLE_COLD_DELTA_C) {
    parts.push(
      `The tag read ${Math.abs(coldest).toFixed(1)} °C BELOW the water at its most extreme. ` +
        `Nothing immersed can be colder than the water around it, so this alone rules out ` +
        `the tag being afloat.`
    );
  }

  if (
    diurnal.separationC !== null &&
    diurnal.separationC >= DIURNAL_SEPARATION_MIN_C &&
    diurnal.nDay >= 2 &&
    diurnal.nNight >= 2
  ) {
    parts.push(
      `The departure is phase-locked to the sun — ` +
        `${diurnal.dayMedianC! > 0 ? '+' : ''}${diurnal.dayMedianC!.toFixed(1)} °C by day against ` +
        `${diurnal.nightMedianC! > 0 ? '+' : ''}${diurnal.nightMedianC!.toFixed(1)} °C at night, ` +
        `a ${diurnal.separationC.toFixed(1)} °C separation across ${diurnal.nDay} daylight and ` +
        `${diurnal.nNight} night readings. That is a body following air temperature, not water.`
    );
  }

  return parts.join(' ');
}
