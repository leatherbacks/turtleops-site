import type { ArgosFix, ArgosPass, ArgosQuality } from '@/lib/types';
import { EMPIRICAL_ERRORS, DISCARD_QUALITIES } from '@/lib/constants';
import { parseClsDate } from '@/lib/clsDate';

/**
 * Argos/Kinéis per-message CSV, as delivered by CLS.
 *
 * Like the DS dump this is a CLS product rather than a manufacturer one, so it
 * identifies the data source and never the hardware. Unlike the DS dump it is
 * one row per *message* rather than one block per pass, and it carries the two
 * fields the DS format drops:
 *
 *   - `Doppler Error radius` — a real per-fix error, not a per-class average.
 *     On a reference PSAT+ deployment the two final fixes were both class B, which the empirical
 *     table would score identically at 14098 m. Their reported radii were 1535 m
 *     and 24474 m. Without this column the useless fix and the usable one are
 *     indistinguishable, and the weighted mean is dragged 4 km off by the junk.
 *   - `Signal Level` — received strength in dBm, which separates "the tag is
 *     being attenuated" from "the tag is being heard fine but rarely". Those
 *     two look the same in a fix count and mean opposite things in the field.
 *
 * Positions repeat across every message that contributed to them, so fixes are
 * deduplicated on `Doppler Position ID`. Passes are reconstructed by grouping
 * consecutive messages from the same satellite, which the row layout does not
 * mark explicitly.
 */

/** Longest plausible gap within one LEO satellite pass. */
const PASS_GAP_MS = 15 * 60 * 1000;

/** Columns that must all be present for this to be a CLS message export. */
export const ARGOS_MESSAGES_REQUIRED = [
  'Message date (UTC)',
  'Doppler Position ID',
  'Doppler Error radius',
  'Doppler Class',
  'Signal Level',
];

export interface ArgosMessagesResult {
  fixes: ArgosFix[];
  passes: ArgosPass[];
  /** Every reception, for measuring the tag's transmission period. */
  messageTimes: { date: Date; satellite: string }[];
  ptt: number | null;
  /** Passes that delivered messages but no resolved position. */
  unlocatedPasses: number;
}

/** Read a column tolerantly — CLS varies capitalisation and leaves a BOM. */
function col(row: Record<string, string>, name: string): string {
  const direct = row[name];
  if (direct !== undefined) return direct.trim();
  const want = name.toLowerCase();
  for (const k of Object.keys(row)) {
    if (k.replace(/^﻿/, '').trim().toLowerCase() === want) {
      return (row[k] ?? '').trim();
    }
  }
  return '';
}

function num(v: string): number | null {
  if (v === '') return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

/** CLS varies its own timestamp format between exports — see parseClsDate. */
const toDate = parseClsDate;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = values.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

interface Msg {
  date: Date;
  satellite: string;
  signal: number | null;
  frequency: number | null;
  positionId: string;
}

export function parseArgosMessages(rows: Record<string, string>[]): ArgosMessagesResult {
  const ptts = new Set<number>();
  const messages: Msg[] = [];
  // Keyed by Doppler Position ID so a position shared by N messages counts once.
  const positions = new Map<string, ArgosFix>();
  /** Position ID -> the pass that produced it, resolved after passes are built. */
  const positionMeta = new Map<
    string,
    { quality: string; lat: number; lon: number; date: Date }
  >();

  for (const row of rows) {
    const date = toDate(col(row, 'Message date (UTC)'));
    if (isNaN(date.getTime())) continue;

    const ptt = num(col(row, 'Device ID'));
    if (ptt !== null) ptts.add(ptt);

    messages.push({
      date,
      satellite: col(row, 'Satellite'),
      signal: num(col(row, 'Signal Level')),
      // The Doppler-corrected carrier is what RDF gear should be tuned to; the
      // raw `Frequency` column still contains the pass's Doppler swing.
      frequency: num(col(row, 'Doppler device Frequency')) ?? num(col(row, 'Frequency')),
      positionId: col(row, 'Doppler Position ID'),
    });

    const positionId = col(row, 'Doppler Position ID');
    if (!positionId || positions.has(positionId)) continue;

    const lat = num(col(row, 'Doppler Latitude'));
    const lon = num(col(row, 'Doppler Longitude'));
    const fixDate = toDate(col(row, 'Doppler Date (UTC)'));
    const quality = col(row, 'Doppler Class').toUpperCase() as ArgosQuality;
    if (lat === null || lon === null || isNaN(fixDate.getTime()) || !quality) continue;

    positionMeta.set(positionId, { quality, lat, lon, date: fixDate });
    if (DISCARD_QUALITIES.includes(quality)) continue;

    // A reported radius always beats the per-class average — that is the whole
    // reason to prefer this export. Fall back only when CLS left it blank.
    const errorRadius = num(col(row, 'Doppler Error radius')) ?? 0;
    positions.set(positionId, {
      date: fixDate,
      latitude: lat,
      longitude: lon,
      quality,
      errorRadius,
      semiMajor: 0, // not carried by this export
      semiMinor: 0,
      orientation: 0,
      effectiveError: errorRadius > 0 ? errorRadius : (EMPIRICAL_ERRORS[quality] ?? 5000),
      isOutlier: false,
    });
  }

  messages.sort((a, b) => a.date.getTime() - b.date.getTime());

  // Rebuild passes: consecutive messages from one satellite, split on a gap
  // longer than a satellite can plausibly stay above the horizon.
  const passes: ArgosPass[] = [];
  let unlocatedPasses = 0;
  const groups = new Map<string, Msg[][]>();
  for (const m of messages) {
    const bySat = groups.get(m.satellite) ?? [];
    const last = bySat[bySat.length - 1];
    if (last && m.date.getTime() - last[last.length - 1].date.getTime() <= PASS_GAP_MS) {
      last.push(m);
    } else {
      bySat.push([m]);
    }
    groups.set(m.satellite, bySat);
  }

  for (const [satellite, blocks] of Array.from(groups.entries())) {
    for (const block of blocks) {
      const ids = new Set(block.map((m) => m.positionId).filter(Boolean));
      const meta = Array.from(ids)
        .map((id) => positionMeta.get(id))
        .find((v) => v !== undefined);

      const span =
        block.length >= 2
          ? block[block.length - 1].date.getTime() - block[0].date.getTime()
          : 0;

      if (!meta) unlocatedPasses++;

      // A located pass is dated by its Doppler solution, not by its first
      // message — that is the instant the position refers to, and it is what
      // the DS parser already does. The two differ by tens of seconds, which is
      // nothing for bucketing but hundreds of kilometres of satellite travel:
      // dating the pass from the first message shifted computed elevation
      // angles by several degrees in the pass-geometry analyzer.
      const passDate = meta?.date ?? block[0].date;

      passes.push({
        date: passDate,
        satellite,
        msgCount: block.length,
        duplicates: 0, // not reported
        // Not reported in this export. Must stay null rather than 0, or a
        // "no CRC data" file renders as a confident "0% corrupted".
        corrupt: null,
        avgInterval: block.length >= 2 ? Math.round(span / 1000 / (block.length - 1)) : 0,
        locationQuality: meta?.quality ?? '',
        latitude: meta?.lat ?? null,
        longitude: meta?.lon ?? null,
        latitude2: null, // no mirror solution in this export
        longitude2: null,
        frequencyHz: median(block.map((m) => m.frequency).filter((v): v is number => v !== null)),
        powerDbm: median(block.map((m) => m.signal).filter((v): v is number => v !== null)),
      });
    }
  }

  const fixes = Array.from(positions.values()).sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );
  passes.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    fixes,
    passes,
    messageTimes: messages.map((m) => ({ date: m.date, satellite: m.satellite })),
    ptt: ptts.size === 1 ? Array.from(ptts)[0] : null,
    unlocatedPasses,
  };
}
