import { solarElevationDeg } from './solar';
import { moonAt } from './moon';

/**
 * Is there light around the tag at night that the moon cannot account for?
 *
 * Lotek PSAT+ health messages carry a light reading with a timestamp after
 * release, so unlike a Wildlife Computers dawn/dusk curve they give a level
 * at night, not just a change. On open water PSAT+ 47128 read 0 whenever the
 * moon was down and at most 52 under a full moon high in the sky. PSAT+ 47125
 * read 42–130 on moonless nights off Miami and on the lit Surfside beachfront
 * before it was picked up. Counts above the moonlight a reading could have
 * had are artificial light: a lit shore, streetlights, buildings, a room.
 *
 * Thresholds are in Lotek's raw counts and calibrated on those two tags.
 */

/** Sun this far down: no twilight left. */
const NIGHT_SUN_DEG = -12;
/** Moon effectively absent below the horizon or this nearly new. */
const MOON_MIN_ILLUMINATION = 0.1;
/** Open water with no moon read 0–6 (47128). */
const DARK_MAX = 10;
/** The most a full moon high in the sky produced (47128: 52). */
const MOONLIT_MAX = 80;

export interface NightReading {
  date: Date;
  light: number;
  moonUp: boolean;
  unexplained: boolean;
}

export interface NightBrightness {
  verdict: 'lit' | 'dark' | 'mixed' | 'insufficient';
  reasoning: string;
  readings: NightReading[];
  unexplained: number;
  /** Start of the window judged: when the tag stopped, or null for all post-release readings. */
  since: Date | null;
}

export function analyzeNightBrightness(
  records: { date: Date; light: number | null }[],
  lat: number,
  lon: number,
  since: Date | null
): NightBrightness | null {
  const night: NightReading[] = [];
  for (const r of records) {
    if (r.light === null || !Number.isFinite(r.light) || isNaN(r.date.getTime())) continue;
    if (solarElevationDeg(r.date, lat, lon) >= NIGHT_SUN_DEG) continue;
    const m = moonAt(r.date, lat, lon);
    const moonUp = m.altitudeDeg > 0 && m.illumination >= MOON_MIN_ILLUMINATION;
    night.push({ date: r.date, light: r.light, moonUp, unexplained: r.light > (moonUp ? MOONLIT_MAX : DARK_MAX) });
  }
  if (night.length === 0) return null;
  const after = since ? night.filter((n) => n.date >= since) : [];
  const useSince = after.length >= 2;
  const judged = (useSince ? after : night).sort((a, b) => a.date.getTime() - b.date.getTime());
  const n = judged.filter((r) => r.unexplained);
  const scope = useSince
    ? `since the tag stopped (${since!.toISOString().slice(0, 16).replace('T', ' ')} UTC)`
    : 'after release';
  const brightest = judged.reduce((a, b) => (b.light > a.light ? b : a));

  if (judged.length < 2)
    return { verdict: 'insufficient', reasoning: `Only one night-time light reading ${scope}.`, readings: judged, unexplained: n.length, since: useSince ? since : null };

  let verdict: NightBrightness['verdict'];
  let reasoning: string;
  if (n.length >= 2 && n.length / judged.length >= 0.5) {
    verdict = 'lit';
    const ex = n.reduce((a, b) => (b.light > a.light ? b : a));
    reasoning =
      `${n.length} of ${judged.length} night readings ${scope} are brighter than the moon could make them — ` +
      `${ex.light} counts at ${ex.date.toISOString().slice(0, 16).replace('T', ' ')} UTC with the moon ${ex.moonUp ? 'up' : 'down'}, ` +
      `where open water reads near 0 without a moon and about 50 under a full one. Artificial light reaches the tag at night: ` +
      `a lit shore, streetlights, buildings or a room.`;
  } else if (n.length === 0) {
    verdict = 'dark';
    reasoning = `All ${judged.length} night readings ${scope} are as dark as the moon allows (brightest ${brightest.light}). No artificial light reaches the tag.`;
  } else {
    verdict = 'mixed';
    reasoning = `${n.length} of ${judged.length} night readings ${scope} are brighter than moonlight explains; the rest are dark. Intermittent artificial light, or the tag moved between dark and lit places.`;
  }
  return { verdict, reasoning, readings: judged, unexplained: n.length, since: useSince ? since : null };
}
