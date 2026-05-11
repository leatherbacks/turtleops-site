import type { ArgosPass, MirrorCheck } from '@/lib/types';
import { haversineKm } from '@/lib/haversine';

/**
 * Check whether the Argos mirror solutions reveal a hidden stationary position.
 *
 * Each Argos pass yields two candidate positions (the Doppler geometry is
 * symmetric, so it can't distinguish north-of-sat from south-of-sat without
 * history). Argos picks one as "primary" based on prior trajectory. When a
 * tag's antenna is obstructed (buried, beached, indoors) or transmission is
 * sparse, Argos may pick the wrong mirror on some passes but not others —
 * producing primaries that look wildly inconsistent.
 *
 * Strategy: enumerate every combination of primary/secondary picks across
 * passes. If the *tightest* combination is dramatically tighter than the
 * as-reported primary cluster, the tag is stationary at that location and
 * Argos simply flipped mirrors between passes.
 *
 * For N passes, this is 2^N combinations. We cap at 16 passes (65k combos,
 * fast). Above that we fall back to a greedy swap heuristic.
 */
export function checkMirrorSolutions(passes: ArgosPass[]): MirrorCheck {
  const withBoth = passes.filter(
    (p) =>
      p.latitude !== null &&
      p.longitude !== null &&
      p.latitude2 !== null &&
      p.longitude2 !== null
  );

  if (withBoth.length === 0) {
    return {
      verdict: 'no_secondaries',
      primarySpreadKm: 0,
      secondarySpreadKm: 0,
      correctedLat: null,
      correctedLon: null,
      reasoning: 'No Argos.csv passes with secondary positions available.',
      comparisonCount: 0,
    };
  }

  if (withBoth.length < 2) {
    return {
      verdict: 'insufficient_data',
      primarySpreadKm: 0,
      secondarySpreadKm: 0,
      correctedLat: null,
      correctedLon: null,
      reasoning:
        'Only one pass has both primary and secondary positions — need at least 2 to compare clusters.',
      comparisonCount: withBoth.length,
    };
  }

  const candidatesPerPass: { lat: number; lon: number }[][] = withBoth.map((p) => [
    { lat: p.latitude!, lon: p.longitude! },
    { lat: p.latitude2!, lon: p.longitude2! },
  ]);

  const primaries = candidatesPerPass.map((c) => c[0]);
  const secondaries = candidatesPerPass.map((c) => c[1]);
  const primarySpread = maxPairwise(primaries);
  const secondarySpread = maxPairwise(secondaries);

  // Find the tightest combination
  const best = findTightestCombination(candidatesPerPass);

  // How much better is the best combination than the as-reported primaries?
  const isMeaningfullyBetter =
    primarySpread > 50 && best.spreadKm < Math.max(primarySpread / 5, 30);

  if (isMeaningfullyBetter) {
    const meanLat =
      best.picks.reduce((s, p) => s + p.lat, 0) / best.picks.length;
    const meanLon =
      best.picks.reduce((s, p) => s + p.lon, 0) / best.picks.length;

    const mirrorCount = best.mask.filter((m) => m === 1).length;
    const primaryCount = best.picks.length - mirrorCount;

    const pickDescription =
      mirrorCount === best.picks.length
        ? `all ${best.picks.length} passes' secondary positions`
        : mirrorCount === 0
          ? `all ${best.picks.length} passes' primary positions`
          : `${primaryCount} primary pick${primaryCount === 1 ? '' : 's'} and ${mirrorCount} mirror-swap${
              mirrorCount === 1 ? '' : 's'
            }`;

    return {
      verdict: 'secondaries_match_better',
      primarySpreadKm: primarySpread,
      secondarySpreadKm: best.spreadKm,
      correctedLat: meanLat,
      correctedLon: meanLon,
      reasoning: `As-reported primary positions span ${primarySpread.toFixed(
        0
      )} km (implausibly far apart). Testing every combination of primary/secondary picks reveals a tight cluster of ${best.spreadKm.toFixed(
        1
      )} km when using ${pickDescription}. The tag is likely stationary at ${formatLatLon(
        meanLat,
        meanLon
      )} with an obstructed antenna — Argos inconsistently picked the wrong mirror on some passes.`,
      comparisonCount: withBoth.length,
    };
  }

  return {
    verdict: 'primaries_consistent',
    primarySpreadKm: primarySpread,
    secondarySpreadKm: secondarySpread,
    correctedLat: null,
    correctedLon: null,
    reasoning: `Primary positions are consistent (${primarySpread.toFixed(
      1
    )} km spread, tightest mirror combo ${best.spreadKm.toFixed(
      1
    )} km). Trusting the primaries.`,
    comparisonCount: withBoth.length,
  };
}

interface BestCombination {
  picks: { lat: number; lon: number }[];
  mask: (0 | 1)[]; // 0 = primary picked, 1 = secondary picked
  spreadKm: number;
}

function findTightestCombination(
  candidatesPerPass: { lat: number; lon: number }[][]
): BestCombination {
  const n = candidatesPerPass.length;

  if (n <= 16) {
    return bruteForceBest(candidatesPerPass);
  }

  // Greedy fallback: start with all-primary, then try swapping each pass one at a
  // time, keeping swaps that reduce the spread. Runs until no single swap improves.
  return greedyBest(candidatesPerPass);
}

function bruteForceBest(
  candidatesPerPass: { lat: number; lon: number }[][]
): BestCombination {
  const n = candidatesPerPass.length;
  const total = 1 << n;
  let best: BestCombination | null = null;

  for (let combo = 0; combo < total; combo++) {
    const mask: (0 | 1)[] = [];
    const picks: { lat: number; lon: number }[] = [];
    for (let i = 0; i < n; i++) {
      const bit = (combo >> i) & 1;
      mask.push(bit as 0 | 1);
      picks.push(candidatesPerPass[i][bit]);
    }
    const spreadKm = maxPairwise(picks);
    if (!best || spreadKm < best.spreadKm) {
      best = { picks, mask, spreadKm };
    }
  }

  return best!;
}

function greedyBest(
  candidatesPerPass: { lat: number; lon: number }[][]
): BestCombination {
  const n = candidatesPerPass.length;
  const mask: (0 | 1)[] = new Array(n).fill(0);
  let picks = candidatesPerPass.map((c) => c[0]);
  let spreadKm = maxPairwise(picks);

  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < n; i++) {
      const tryMask = [...mask];
      tryMask[i] = tryMask[i] === 0 ? 1 : 0;
      const tryPicks = tryMask.map((bit, idx) => candidatesPerPass[idx][bit]);
      const trySpread = maxPairwise(tryPicks);
      if (trySpread < spreadKm) {
        mask[i] = tryMask[i];
        picks = tryPicks;
        spreadKm = trySpread;
        improved = true;
      }
    }
  }

  return { picks, mask, spreadKm };
}

/**
 * Max pairwise distance. Exact O(n^2) for small sets; bounding-box-diagonal
 * O(n) fallback for large sets so long-running tracker tags with thousands
 * of passes don't hang the browser. The mirror-check threshold (50 km) is
 * coarse enough that the bbox approximation can't change the verdict.
 */
const PAIRWISE_MAX = 500;

function maxPairwise(points: { lat: number; lon: number }[]): number {
  if (points.length < 2) return 0;
  if (points.length <= PAIRWISE_MAX) {
    let max = 0;
    for (let i = 0; i < points.length; i++) {
      for (let j = i + 1; j < points.length; j++) {
        const d = haversineKm(points[i].lat, points[i].lon, points[j].lat, points[j].lon);
        if (d > max) max = d;
      }
    }
    return max;
  }
  // Bounding-box diagonal fallback
  let minLat = Infinity, maxLat = -Infinity;
  let minLon = Infinity, maxLon = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
  }
  return haversineKm(minLat, minLon, maxLat, maxLon);
}

function formatLatLon(lat: number, lon: number): string {
  return `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}°${lon >= 0 ? 'E' : 'W'}`;
}
