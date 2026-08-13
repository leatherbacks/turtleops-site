/**
 * Screen isolated deep readings out of a depth record that is otherwise at the
 * surface.
 *
 * A popped tag floating or stranded reports zero, over and over. When two
 * readings out of twenty-two come back at 21 m and 32 m, with every neighbour
 * at zero, they are corrupt decodes rather than dives — the tag would have had
 * to descend and return between two samples leaving no intermediate value, and
 * on one deployment the seabed beneath the reported position was 2 m.
 *
 * Unscreened, those two records produced a dive profile claiming a 32 m maximum
 * and a tidal-intrusion module announcing the tag was "tidally flooded, wet 10%
 * of the time" — the 10% being exactly 2/22. Both appeared on the same page as a
 * tag-state panel correctly reporting "depth stable at 0 m, tag is at surface".
 *
 * The screen only engages when the record is overwhelmingly surface readings, so
 * a genuine dive profile — where deep readings are common and consecutive — is
 * left alone. A deep reading with a deep neighbour is evidence of a dive and is
 * always kept; it is isolation that makes a reading suspect.
 */

/** Below this a reading is "at the surface" for screening purposes. */
const SURFACE_M = 1;

/**
 * Only readings deeper than this are ever screened.
 *
 * The point of the threshold is to protect the shallow readings that a surface
 * tag genuinely produces: tidal flooding, wave wash, a float riding low. Those
 * are metres at most, they arrive singly between dry readings, and screening
 * them would break the tidal-intrusion detector this same guard is meant to fix.
 * A reading beyond this depth is a different claim entirely — a tag that is
 * either genuinely diving, which leaves neighbouring deep readings, or reporting
 * a corrupt decode.
 */
const ISOLATED_DEEP_M = 5;

/**
 * The record must be at least this fraction surface readings before isolated
 * deep values are treated as suspect. An animal that dives regularly falls well
 * below this and is never screened.
 */
const SURFACE_DOMINANCE = 0.8;

/** Minimum readings before the shape of the record means anything. */
const MIN_READINGS = 8;

/**
 * A deep reading is corroborated by another deep reading within this window.
 *
 * Fixed in wall-clock time rather than scaled to the sampling interval, which
 * was the first version and was wrong: on a six-hourly record it let two alleged
 * dives thirteen hours apart vouch for each other. Descending to tens of metres
 * and returning is a matter of minutes, so readings that far apart are two
 * separate claims, not one event sampled twice.
 */
const CORROBORATION_WINDOW_MS = 2 * 60 * 60 * 1000;

export interface DepthScreen<T> {
  kept: T[];
  rejected: T[];
  /** Set when readings were dropped, for the caller to surface. */
  reason: string | null;
}

export function screenIsolatedDepths<T>(
  points: T[],
  depthOf: (p: T) => number,
  timeOf: (p: T) => number
): DepthScreen<T> {
  const none: DepthScreen<T> = { kept: points, rejected: [], reason: null };
  if (points.length < MIN_READINGS) return none;

  const notSurface = points.filter((p) => depthOf(p) >= SURFACE_M);
  const surfaceFraction = 1 - notSurface.length / points.length;
  if (notSurface.length === 0 || surfaceFraction < SURFACE_DOMINANCE) return none;

  const deep = points.filter((p) => depthOf(p) >= ISOLATED_DEEP_M);
  if (deep.length === 0) return none;

  const sorted = [...points].sort((a, b) => timeOf(a) - timeOf(b));
  const rejected: T[] = [];
  const kept: T[] = [];
  for (const p of sorted) {
    if (depthOf(p) < ISOLATED_DEEP_M) {
      kept.push(p);
      continue;
    }
    const corroborated = deep.some(
      (q) => q !== p && Math.abs(timeOf(q) - timeOf(p)) <= CORROBORATION_WINDOW_MS
    );
    if (corroborated) kept.push(p);
    else rejected.push(p);
  }

  if (rejected.length === 0) return none;

  const depths = rejected.map((p) => depthOf(p).toFixed(0)).join(', ');
  return {
    kept,
    rejected,
    reason:
      `${rejected.length} isolated depth reading${rejected.length === 1 ? '' : 's'} ` +
      `(${depths} m) excluded: ${Math.round(surfaceFraction * 100)}% of this record is at ` +
      `the surface and ${rejected.length === 1 ? 'this reading has' : 'these readings have'} ` +
      `no neighbouring deep reading, so ${rejected.length === 1 ? 'it is' : 'they are'} ` +
      `far more likely a corrupt decode than a dive.`,
  };
}
