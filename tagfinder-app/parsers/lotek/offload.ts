/**
 * Intake for the .bin files offloaded from a physically recovered Lotek PSAT+.
 *
 * Four files exist: the activity, day and basic logs, plus LVS — a container
 * holding the other three concatenated behind a single header, with NO internal
 * markers between them. So a container cannot be split by headers: each log's
 * region is located by its own stream signature instead, and the locators here
 * are deliberately stricter than the ones inside the individual parsers,
 * because they scan a megabyte of someone else's records rather than a few
 * kilobytes of their own. An activity chain of three entries is unique inside
 * an activity file and a coin-flip inside a basic-log stream; six is unique in
 * both.
 *
 * THE ACTIVITY CLOCK NEEDS AN ANCHOR. Its timestamps are relative to a
 * programme epoch the file does not state, and guessing produced two wrong
 * diagnoses in this project's history. Two honest options exist here:
 *
 *  - The manufacturer's decoded Dive Log CSV, when uploaded alongside: its
 *    wall-clock records are the same samples, so the epoch that makes the
 *    pressures agree exactly is the right one. Acceptance demands >= 90%
 *    exact agreement across >= 50 co-timed records — the bar that has held
 *    where correlation repeatedly failed.
 *  - The day log's absolute dates, otherwise: the archive starts on the day
 *    log's first date, which anchors the epoch to within a day. Marked
 *    approximate; good enough for a dive profile, not for anything diel.
 */

import type { SeriesReading } from '@/lib/types';
import {
  parseLotekActivityLog,
  type LotekArchiveResult,
} from './activityLogBinary';
import {
  parseLotekDayLog as parseDayLogBinary,
  type LotekDayLogResult,
} from './dayLogBinary';
import { parseLotekBasicLog, type LotekBasicLogResult } from './basicLogBinary';

export type OffloadKind = 'alog' | 'dlog' | 'blog' | 'lvs';

const MAGIC: [string, OffloadKind][] = [
  ['[PSAT3_ALOG]', 'alog'],
  ['[PSAT3_DLOG]', 'dlog'],
  ['[PSAT3_BLOG]', 'blog'],
  ['[PSAT3_LLOG]', 'lvs'],
];

/** Identify a Lotek offload file from its opening bytes, or null. */
export function detectOffloadKind(head: Uint8Array): OffloadKind | null {
  const text = new TextDecoder('ascii').decode(head.slice(0, 16));
  for (const [magic, kind] of MAGIC) {
    if (text.startsWith(magic)) return kind;
  }
  return null;
}

const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);

/** Activity region: six consecutive 0xA0 entries at the 40-byte stride. */
function locateActivity(d: Uint8Array): number {
  for (let i = 0; i + 40 * 6 <= d.length; i++) {
    if (d[i] !== 0xa0) continue;
    let ok = true;
    for (let k = 1; k < 6; k++) if (d[i + 40 * k] !== 0xa0) { ok = false; break; }
    if (ok) return i;
  }
  return -1;
}

/** Day region: four dates in sequence at the 40-byte stride. */
function locateDay(d: Uint8Array): number {
  for (let i = 0; i + 40 * 4 <= d.length; i++) {
    const a = u16le(d, i);
    if (a < 7000 || a > 20000) continue;
    if (
      u16le(d, i + 40) === a + 1 &&
      u16le(d, i + 80) === a + 2 &&
      u16le(d, i + 120) === a + 3
    )
      return i;
  }
  return -1;
}

/** Basic region: twelve records chaining on the A2/E2 markers. */
function locateBasic(d: Uint8Array): number {
  outer: for (let i = 0; i + 100 < d.length; i++) {
    if (d[i] !== 0xa2) continue;
    let p = i;
    for (let k = 0; k < 12; k++) {
      if (d[p] === 0xa2) p += 4;
      else if (d[p] === 0xe2) p += 7;
      else continue outer;
      if (p >= d.length) continue outer;
    }
    return i;
  }
  return -1;
}

export interface LotekOffloadResult {
  kind: OffloadKind;
  activity: LotekArchiveResult | null;
  day: LotekDayLogResult | null;
  basic: LotekBasicLogResult | null;
}

export function parseLotekOffload(bytes: Uint8Array): LotekOffloadResult | null {
  const kind = detectOffloadKind(bytes);
  if (!kind) return null;

  if (kind === 'alog')
    return { kind, activity: parseLotekActivityLog(bytes), day: null, basic: null };
  if (kind === 'dlog')
    return { kind, activity: null, day: parseDayLogBinary(bytes), basic: null };
  if (kind === 'blog')
    return { kind, activity: null, day: null, basic: parseLotekBasicLog(bytes) };

  // LVS: locate each region, then bound each slice by the next region's start
  // so one parser cannot wander into another log's bytes.
  const found = [
    { kind: 'blog' as const, start: locateBasic(bytes) },
    { kind: 'alog' as const, start: locateActivity(bytes) },
    { kind: 'dlog' as const, start: locateDay(bytes) },
  ]
    .filter((r) => r.start >= 0)
    .sort((a, b) => a.start - b.start);

  const out: LotekOffloadResult = { kind, activity: null, day: null, basic: null };
  found.forEach((r, i) => {
    const end = i + 1 < found.length ? found[i + 1].start : bytes.length;
    const slice = bytes.slice(r.start, end);
    if (r.kind === 'alog') out.activity = parseLotekActivityLog(slice);
    if (r.kind === 'dlog') out.day = parseDayLogBinary(slice);
    if (r.kind === 'blog') out.basic = parseLotekBasicLog(slice);
  });
  return out;
}

/** Fold several offload files (or a container plus singles) into one. */
export function mergeOffloads(results: LotekOffloadResult[]): LotekOffloadResult {
  const best = <T>(xs: (T | null)[], size: (t: T) => number): T | null =>
    xs.reduce<T | null>((a, b) => (b && (!a || size(b) > size(a)) ? b : a), null);
  return {
    kind: 'lvs',
    activity: best(results.map((r) => r.activity), (a) => a.records.length),
    day: best(results.map((r) => r.day), (d) => d.records.length),
    basic: best(results.map((r) => r.basic), (b) => b.samples.length),
  };
}

export interface EpochAnchor {
  epoch: Date;
  /** 'exact' — matched against the manufacturer decode; 'day' — dated to ±1 day. */
  method: 'exact' | 'day';
  matched: number;
  rate: number;
}

const EXACT_MIN_MATCHES = 50;
const EXACT_MIN_RATE = 0.9;

/**
 * Recover the activity epoch by making the archive agree with the
 * manufacturer's own decode of the same samples.
 */
export function anchorActivityEpoch(
  activity: LotekArchiveResult,
  diveSeries: SeriesReading[] | null,
  day: LotekDayLogResult | null
): EpochAnchor | null {
  const recs = activity.records;
  if (recs.length === 0) return null;

  if (diveSeries && diveSeries.length >= EXACT_MIN_MATCHES) {
    const byTime = new Map<number, number>();
    for (const r of diveSeries) {
      if (r.depth !== null && !isNaN(r.date.getTime()))
        byTime.set(r.date.getTime(), r.depth);
    }
    const csvTimes = Array.from(byTime.keys()).sort((a, b) => a - b);

    // Candidate epochs: the first (and last) CSV records paired against each of
    // the archive's early (and late) records. The true alignment is among
    // these; a blind grid search is not needed.
    const candidates = new Set<number>();
    for (const r of recs.slice(0, 64))
      candidates.add(csvTimes[0] - r.tagSeconds * 1000);
    for (const r of recs.slice(-64))
      candidates.add(csvTimes[csvTimes.length - 1] - r.tagSeconds * 1000);

    let best: EpochAnchor | null = null;
    for (const epoch of Array.from(candidates)) {
      let matched = 0;
      let coTimed = 0;
      for (const r of recs) {
        const t = epoch + r.tagSeconds * 1000;
        const csv = byTime.get(t);
        if (csv === undefined) continue;
        coTimed++;
        if (csv === r.pressureDbar) matched++;
      }
      const rate = coTimed > 0 ? matched / coTimed : 0;
      if (
        coTimed >= EXACT_MIN_MATCHES &&
        rate >= EXACT_MIN_RATE &&
        (!best || matched > best.matched)
      ) {
        best = { epoch: new Date(epoch), method: 'exact', matched, rate };
      }
    }
    if (best) return best;
  }

  // Fallback: the archive begins on the day log's first date. Anchoring the
  // first record to that date's noon is honest to within half a day — usable
  // for a profile, stated as approximate, and never fed to anything diel.
  const firstDay = day?.records[0]?.date;
  if (firstDay) {
    const epoch =
      Date.UTC(
        firstDay.getUTCFullYear(),
        firstDay.getUTCMonth(),
        firstDay.getUTCDate(),
        12
      ) -
      recs[0].tagSeconds * 1000;
    return { epoch: new Date(epoch), method: 'day', matched: 0, rate: 0 };
  }
  return null;
}

/** The anchored archive as series readings, ready for the analysis pipeline. */
export function offloadSeries(
  activity: LotekArchiveResult,
  anchor: EpochAnchor
): SeriesReading[] {
  return activity.records.map((r) => ({
    date: new Date(anchor.epoch.getTime() + r.tagSeconds * 1000),
    depth: r.pressureDbar,
    depthRange: null,
    temperature: r.temperatureC,
    temperatureRange: null,
  }));
}
