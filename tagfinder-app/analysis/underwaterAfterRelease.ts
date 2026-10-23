import type { LightCurve, SSTReading } from '@/lib/types';

/**
 * Underwater after release, from the transmitted summaries.
 *
 * A Wildlife Computers SST record is the temperature at the shallowest depth
 * the tag reached in its sampling window, and it says which depth that was.
 * A tag floating free, or lying on a beach, is at the surface, so every SST
 * record after release reads 0 m: 85 of them across 33938, 285931, 285932 and
 * 41008, none deeper than 0.4 m. MiniPAT 40996's record for 25 Sep 07:00Z,
 * five days after its release, was taken at 4.5 m. In that window the tag
 * never got closer to the surface than 4.5 m: it had sunk, fouled heavy with
 * barnacles, and its archive later showed it lying at 8–18 m. Its dawn and
 * dusk light curves that day were flat at 31–35, with no twilight in them.
 *
 * That record only reached Argos a week later, once the tag was ashore and
 * transmitting, but on a tag that is never recovered it is the one early sign
 * that the silence after release was a sunk tag, not a floating one that
 * could not be heard.
 *
 * LightLoc depths are not used: they come in 32 m bins (16, 48, 80…), too
 * coarse to tell 1 m from 20. Lotek SST depths are not used either: Lotek's
 * pressure reading means nothing once the release has fired.
 */

export interface UnderwaterReading {
  date: Date;
  depthM: number;
  temperatureC: number;
}

export interface DarkCurve {
  date: Date;
  type: string;
  min: number;
  max: number;
}

export interface UnderwaterAfterRelease {
  readings: UnderwaterReading[];
  /** Dawn/dusk curves within a day of a reading, with no twilight change in them. */
  darkCurves: DarkCurve[];
  /** Post-release SST records judged, for context. */
  sstJudged: number;
  reasoning: string;
}

/** An SST record this deep was taken underwater; floating and beached tags read 0–0.4 m. */
const UNDERWATER_M = 2;
/** The tag may still be on the animal for hours after the burn starts (40996: 4.5 h). */
const SETTLE_MS = 12 * 3_600_000;
/** A twilight curve spanning less than this has no dawn or dusk in it. */
const FLAT_UNITS = 10;

const fmt = (d: Date) =>
  d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + 'Z';

export function analyzeUnderwaterAfterRelease(
  sst: SSTReading[] | null,
  curves: LightCurve[],
  release: Date | null
): UnderwaterAfterRelease | null {
  if (!release || !sst?.length) return null;
  const from = release.getTime() + SETTLE_MS;
  const post = sst.filter((s) => !s.source.toLowerCase().startsWith('lotek') && s.date.getTime() >= from);
  if (!post.length) return null;
  const readings = post
    .filter((s) => s.depth >= UNDERWATER_M)
    .map((s) => ({ date: s.date, depthM: s.depth, temperatureC: s.temperature }));
  if (!readings.length) return null;

  const near = (d: Date) => readings.some((r) => Math.abs(r.date.getTime() - d.getTime()) <= 24 * 3_600_000);
  const darkCurves = curves
    .filter((c) => c.date.getTime() >= from && (c.type === 'Dawn' || c.type === 'Dusk') && c.lightSamples.length >= 4 && near(c.date))
    .map((c) => ({ date: c.date, type: c.type, min: Math.min(...c.lightSamples), max: Math.max(...c.lightSamples) }))
    .filter((c) => c.max - c.min < FLAT_UNITS);

  const days = (r: UnderwaterReading) => ((r.date.getTime() - release.getTime()) / 86_400_000).toFixed(1);
  const list = readings.map((r) => `${fmt(r.date)} at ${r.depthM} m (${r.temperatureC.toFixed(1)} °C, ${days(r)} days after release)`).join('; ');
  let reasoning =
    `The tag's sea-surface temperature ${readings.length === 1 ? 'record' : 'records'} after release ${readings.length === 1 ? 'was' : 'were'} taken underwater: ${list}. ` +
    'That record is the temperature at the shallowest depth the tag reached in its window, so in that window it never came within ' +
    `${Math.min(...readings.map((r) => r.depthM))} m of the surface. A tag floating free or lying ashore records it at 0 m. It was sunk or held under, not floating.`;
  if (darkCurves.length) {
    reasoning +=
      ` Its ${darkCurves.map((c) => `${c.type.toLowerCase()} light on ${fmt(c.date)} (${c.min}–${c.max})`).join(' and ')} ` +
      `${darkCurves.length === 1 ? 'was' : 'were'} flat, with no twilight in ${darkCurves.length === 1 ? 'it' : 'them'}: dark at depth.`;
  }
  reasoning +=
    ' A sunk tag cannot transmit, so any silence while it was down was the sea, not a tag that could not be heard. Heavy fouling is the usual cause. ' +
    'If it is transmitting now, the sea has since brought it up or ashore; if it is still silent, watch the beaches downwind after the next onshore blow.';

  return { readings, darkCurves, sstJudged: post.length, reasoning };
}
