import type { LightCurve } from '@/lib/types';
import { solarElevationDeg } from './solar';

/**
 * Did the light change when the tag stopped?
 *
 * The light panel judged post-release curves on absolute peaks: a Dawn or Dusk
 * curve that reaches 150 reads "normal diurnal, consistent with open sky". On
 * MiniPAT 33938 the dusk curve recorded 46 minutes after the tag reached
 * Melbourne Beach peaked at 145 and the panel said open sky. Set against the
 * tag's own eleven afloat dusks at the same height of the sun it was nothing
 * like them: 97 with the sun 3.4° up where afloat read 152–175, 34 two degrees
 * after sunset where afloat read 105–145, and darker than any afloat night. It
 * had been carried indoors at about 6:35 pm on a clear evening.
 *
 * Absolute light levels vary from tag to tag and sensor to sensor; the tag's
 * own curves at the surface, matched by sun elevation and by dawn or dusk, do
 * not. Every sample of a curve recorded after the stop is compared with the
 * range the reference curves span at that elevation.
 */

/** Only the twilight band where both curve families have samples. */
const MIN_ELEV = -8;
const MAX_ELEV = 10;
/** Reference curves must reach the elevation for it to be judged. */
const MIN_REFERENCES = 3;
/** Below the reference range by this much is not sky. */
const DEFICIT_UNITS = 25;
/** Reference samples deeper than this were taken underwater. */
const SURFACE_M = 1;

export type LightAfterStopVerdict = 'covered' | 'open' | 'mixed' | 'insufficient';

export interface LightAfterStop {
  verdict: LightAfterStopVerdict;
  reasoning: string;
  /** Curves recorded after the stop that could be judged. */
  curvesJudged: number;
  referenceCurves: number;
  /** First sample of the run that fell below the open-sky range. */
  darkSince: Date | null;
  /** Darkest reference reading, any sun height. */
  referenceFloor: number | null;
  samples: { date: Date; elevationDeg: number; level: number; refMin: number; refMax: number }[];
}

interface Sample { date: Date; elev: number; level: number; depth: number | null }

function samplesOf(c: LightCurve, lat: number, lon: number): Sample[] {
  const step = c.deltaSeconds ?? 0;
  if (!(step > 0)) return [];
  return c.lightSamples.map((level, i) => {
    const date = new Date(c.date.getTime() + i * step * 1000);
    return { date, elev: solarElevationDeg(date, lat, lon), level, depth: c.depthSamples[i] ?? null };
  });
}

/** Reference level range at an elevation, interpolated along each reference curve. */
function envelope(refs: Sample[][], elev: number): { min: number; max: number; n: number } | null {
  const vals: number[] = [];
  for (const pts of refs) {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      const lo = Math.min(a.elev, b.elev), hi = Math.max(a.elev, b.elev);
      if (elev < lo || elev > hi || hi === lo) continue;
      vals.push(a.level + ((b.level - a.level) * (elev - a.elev)) / (b.elev - a.elev));
      break;
    }
  }
  if (vals.length < MIN_REFERENCES) return null;
  return { min: Math.min(...vals), max: Math.max(...vals), n: vals.length };
}

const fmt = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ');

export function analyzeLightAfterStop(
  curves: LightCurve[],
  stoppedAt: Date | null,
  lat: number,
  lon: number
): LightAfterStop {
  const empty = (reasoning: string, curvesJudged = 0, referenceCurves = 0): LightAfterStop => ({
    verdict: 'insufficient', reasoning, curvesJudged, referenceCurves, darkSince: null, referenceFloor: null, samples: [],
  });
  if (!stoppedAt) return empty('No resting period — nothing to compare the light against.');
  const twilight = curves.filter((c) => c.type === 'Dawn' || c.type === 'Dusk');
  const stop = stoppedAt.getTime();
  const at = (c: LightCurve) => samplesOf(c, lat, lon);
  // The reference is the tag at the surface before it stopped. The animal's
  // dives are excluded sample by sample: a reading at depth is water, not sky.
  const surface = (s: Sample) => s.depth === null || s.depth <= SURFACE_M;
  const refsByType = new Map<string, Sample[][]>();
  for (const c of twilight) {
    const pts = at(c);
    if (pts.length < 3 || pts[pts.length - 1].date.getTime() >= stop || !pts.every(surface)) continue;
    refsByType.set(c.type, [...(refsByType.get(c.type) ?? []), pts]);
  }
  const refCount = [...refsByType.values()].reduce((s, r) => s + r.length, 0);
  const allRef = [...refsByType.values()].flat(2);
  const floor = allRef.length ? Math.min(...allRef.map((s) => s.level)) : null;

  const after = twilight.filter((c) => c.date.getTime() + (c.lightSamples.length - 1) * (c.deltaSeconds ?? 0) * 1000 >= stop);
  if (after.length === 0) return { ...empty(`No dawn or dusk curve recorded since the tag stopped (${fmt(stoppedAt)} UTC).`, 0, refCount), referenceFloor: floor };

  const judged: LightAfterStop['samples'] = [];
  let curvesJudged = 0;
  for (const c of after) {
    const refs = refsByType.get(c.type) ?? [];
    let any = false;
    for (const s of at(c)) {
      if (s.date.getTime() < stop || s.elev < MIN_ELEV || s.elev > MAX_ELEV) continue;
      const env = envelope(refs, s.elev);
      if (!env) continue;
      judged.push({ date: s.date, elevationDeg: s.elev, level: s.level, refMin: env.min, refMax: env.max });
      any = true;
    }
    if (any) curvesJudged++;
  }
  if (judged.length < 3)
    return { ...empty(`Too few samples since the stop fall where ${refCount} open-sky reference curves can judge them.`, curvesJudged, refCount), referenceFloor: floor };

  const dark = (j: (typeof judged)[number]) => j.level < j.refMin - DEFICIT_UNITS || (floor !== null && j.level < floor);
  const nDark = judged.filter(dark).length;
  const share = nDark / judged.length;
  // The run of dark samples that reaches the end of the newest curve: when it went dark.
  let k = judged.length;
  while (k > 0 && dark(judged[k - 1])) k--;
  const darkSince = k < judged.length ? judged[k].date : null;
  const worst = judged.reduce((a, b) => (b.refMin - b.level > a.refMin - a.level ? b : a));
  const darkest = judged.reduce((a, b) => (b.level < a.level ? b : a));

  let verdict: LightAfterStopVerdict;
  let reasoning: string;
  const ref = `the tag's own ${refCount} open-sky dawn and dusk curves before it stopped`;
  if (share >= 0.6) {
    verdict = 'covered';
    reasoning =
      `Since the tag stopped, ${nDark} of ${judged.length} light samples fall below ${ref} at the same sun height — ` +
      `${worst.level.toFixed(0)} with the sun at ${worst.elevationDeg.toFixed(1)}° where they read ${worst.refMin.toFixed(0)}–${worst.refMax.toFixed(0)}` +
      (floor !== null && darkest.level < floor
        ? darkest === worst
          ? `, darker than any reference reading at any hour (${floor.toFixed(0)})`
          : `, and ${darkest.level.toFixed(0)} at ${darkest.elevationDeg.toFixed(1)}°, darker than any reference reading at any hour (${floor.toFixed(0)})`
        : '') +
      `. Something is over the sensor: indoors, in a bag or vehicle, or face-down under sand or wrack.` +
      (darkSince ? ` Dark from ${fmt(darkSince)} UTC.` : '');
  } else if (nDark === 0) {
    verdict = 'open';
    reasoning = `Since the tag stopped, all ${judged.length} light samples sit within ${ref} at the same sun height. It sees open sky.`;
  } else {
    verdict = 'mixed';
    reasoning =
      `Since the tag stopped, ${nDark} of ${judged.length} light samples fall below ${ref} at the same sun height. ` +
      `Partly shaded, or moved between open sky and cover.` + (darkSince ? ` The newest run is dark from ${fmt(darkSince)} UTC.` : '');
  }
  return { verdict, reasoning, curvesJudged, referenceCurves: refCount, darkSince, referenceFloor: floor, samples: judged };
}

/**
 * A dawn or dusk the sun cannot have made.
 *
 * The tag logs a Dawn or Dusk curve when its light level crosses a threshold.
 * After release, a crossing with the sun well below the horizon is a light
 * switched on or off, headlights, or the tag being carried into or out of
 * lit space. MiniPAT 40996, a week before a beachcomber took it to a camper,
 * logged a "dusk" at 9:34 pm and a "dawn" at 1:44 am with the sun 30–55°
 * down. The samples sat at the sensor's dark floor either side, so the curve
 * does not show the light itself, only that it changed at night.
 */
const NIGHT_SUN_DEG = -12;

export interface NightLightEvent {
  date: Date;
  type: 'Dawn' | 'Dusk';
  /** Highest sun elevation across the curve's samples. */
  sunMaxDeg: number;
  levelMin: number;
  levelMax: number;
}

export function nightLightEvents(curves: LightCurve[], releaseTime: number | null, lat: number, lon: number): NightLightEvent[] {
  if (releaseTime === null) return [];
  const out: NightLightEvent[] = [];
  for (const c of curves) {
    if ((c.type !== 'Dawn' && c.type !== 'Dusk') || c.date.getTime() < releaseTime) continue;
    const pts = samplesOf(c, lat, lon);
    if (pts.length === 0) continue;
    const sunMax = Math.max(...pts.map((p) => p.elev));
    if (sunMax >= NIGHT_SUN_DEG) continue;
    out.push({
      date: c.date,
      type: c.type,
      sunMaxDeg: sunMax,
      levelMin: Math.min(...pts.map((p) => p.level)),
      levelMax: Math.max(...pts.map((p) => p.level)),
    });
  }
  return out;
}

/** One sentence for the light panel and the brief. */
export function describeNightLight(events: NightLightEvent[]): string {
  const when = (e: NightLightEvent) => `a "${e.type.toLowerCase()}" at ${e.date.toISOString().slice(0, 16).replace('T', ' ')} UTC (sun ${Math.abs(e.sunMaxDeg).toFixed(0)}°+ below the horizon)`;
  return (
    `After release the tag logged ${events.length === 1 ? when(events[0]) : `${events.length} dawn/dusk events in full darkness, e.g. ${when(events[0])}`}. ` +
    `The sun cannot make those: the light around the tag changed at night — a lamp switched on or off, headlights, or the tag carried into or out of lit space. ` +
    `It points to people nearby (a building, a vehicle, lights) rather than a dark, empty shore, though headlights on a drivable beach would do it too.`
  );
}
