import type { ArgosPass, SatCoverage, AnnotatedPass } from '@/lib/types';
import type { SatellitePass } from './satPrediction';

/**
 * Match a received Argos pass to a predicted satellite pass.
 * Received passes from Argos.csv contain date and satellite name; we match by
 * nearest time for the same satellite name.
 */
function matchPass(
  received: ArgosPass,
  predicted: SatellitePass[]
): SatellitePass | null {
  const recvName = normalizeSatName(received.satellite);
  const recvTime = received.date.getTime();
  const maxDeltaMs = 15 * 60 * 1000; // 15 min window

  let best: SatellitePass | null = null;
  let bestDelta = Infinity;

  for (const pred of predicted) {
    if (normalizeSatName(pred.satelliteName) !== recvName) continue;
    // Did this pass cover the received time?
    if (
      recvTime >= pred.riseTime.getTime() - maxDeltaMs &&
      recvTime <= pred.setTime.getTime() + maxDeltaMs
    ) {
      const delta = Math.abs(
        recvTime - (pred.riseTime.getTime() + pred.setTime.getTime()) / 2
      );
      if (delta < bestDelta) {
        bestDelta = delta;
        best = pred;
      }
    }
  }

  return best;
}

/**
 * Normalize satellite names across Argos.csv values and CelesTrak TLE names.
 * e.g., "NP" → NOAA-19, "NN" → NOAA-20 (Argos short codes).
 * Falls back to prefix matching.
 */
function normalizeSatName(name: string): string {
  const n = (name || '').trim().toUpperCase();
  const map: Record<string, string> = {
    NP: 'NOAA-19',
    NN: 'NOAA-20',
    MB: 'METOP-B',
    MC: 'METOP-C',
    SR: 'SARAL',
  };
  if (map[n]) return map[n];
  // Already full-name?
  if (n.startsWith('NOAA')) return n.replace(' ', '-');
  if (n.startsWith('METOP')) return n.replace(' ', '-');
  if (n.startsWith('SARAL')) return 'SARAL';
  return n;
}

/**
 * Compute satellite coverage statistics by comparing predicted vs received passes.
 */
export function analyzeSatCoverage(
  predicted: SatellitePass[],
  received: ArgosPass[]
): SatCoverage {
  if (predicted.length === 0) {
    return emptyCoverage('unknown', 'No predicted passes (TLE data missing)');
  }

  const satNames = Array.from(
    new Set(predicted.map((p) => p.satelliteName))
  ).sort();

  // Match each received pass to a predicted one
  const matchedIds = new Set<number>();
  let receivedMatched = 0;

  for (const recv of received) {
    const match = matchPass(recv, predicted);
    if (match) {
      const idx = predicted.indexOf(match);
      if (!matchedIds.has(idx)) {
        matchedIds.add(idx);
        receivedMatched++;
      }
    }
  }

  // Per-satellite breakdown
  const perSat = satNames.map((name) => {
    const satPredicted = predicted.filter((p) => p.satelliteName === name);
    const satMatched = satPredicted.filter((_, i) =>
      matchedIds.has(predicted.indexOf(satPredicted[i]))
    ).length;
    return {
      name,
      predicted: satPredicted.length,
      received: satMatched,
      rate: satPredicted.length > 0 ? satMatched / satPredicted.length : 0,
    };
  });

  // Direction bias
  const ascPredicted = predicted.filter((p) => p.direction === 'ascending').length;
  const descPredicted = predicted.filter((p) => p.direction === 'descending').length;
  const ascReceived = Array.from(matchedIds).filter(
    (i) => predicted[i].direction === 'ascending'
  ).length;
  const descReceived = Array.from(matchedIds).filter(
    (i) => predicted[i].direction === 'descending'
  ).length;

  const totalPredicted = predicted.length;
  const totalReceived = receivedMatched;
  const rate = totalPredicted > 0 ? totalReceived / totalPredicted : 0;

  // Health classification
  let health: SatCoverage['health'];
  if (rate >= 0.2) health = 'healthy';
  else if (rate >= 0.08) health = 'marginal';
  else health = 'poor';

  // Diagnosis
  const diagnosis = interpretCoverage(rate, perSat, ascPredicted, ascReceived, descPredicted, descReceived);

  // Build per-pass annotations for sky chart
  const annotatedPasses: AnnotatedPass[] = predicted.map((p, i) => ({
    satelliteName: p.satelliteName,
    riseTime: p.riseTime,
    setTime: p.setTime,
    maxElevation: p.maxElevation,
    peakAzimuth: p.peakAzimuth,
    riseAzimuth: p.riseAzimuth,
    setAzimuth: p.setAzimuth,
    direction: p.direction,
    received: matchedIds.has(i),
    trackPoints: p.trackPoints.map((t) => ({
      azimuth: t.azimuth,
      elevation: t.elevation,
    })),
  }));

  return {
    totalPredicted,
    totalReceived,
    receptionRate: rate,
    perSat,
    ascendingPredicted: ascPredicted,
    ascendingReceived: ascReceived,
    descendingPredicted: descPredicted,
    descendingReceived: descReceived,
    diagnosis,
    health,
    passes: annotatedPasses,
  };
}

function interpretCoverage(
  rate: number,
  perSat: SatCoverage['perSat'],
  ascP: number,
  ascR: number,
  descP: number,
  descR: number
): string {
  const bits: string[] = [];

  if (rate >= 0.25) {
    bits.push('Strong reception — tag antenna was well-exposed.');
  } else if (rate >= 0.1) {
    bits.push('Moderate reception — tag may be partially obstructed or frequently submerged.');
  } else {
    bits.push('Weak reception — tag is likely obstructed (buried, submerged, or poorly oriented).');
  }

  // Direction bias
  const ascRate = ascP > 0 ? ascR / ascP : 0;
  const descRate = descP > 0 ? descR / descP : 0;
  const biasRatio = Math.max(ascRate, descRate) / Math.max(Math.min(ascRate, descRate), 0.01);

  if (biasRatio > 2 && ascP > 3 && descP > 3) {
    if (ascRate > descRate) {
      bits.push(
        `Strong northbound bias (${(ascRate * 100).toFixed(0)}% vs ${(descRate * 100).toFixed(0)}% southbound) — antenna may face north.`
      );
    } else {
      bits.push(
        `Strong southbound bias (${(descRate * 100).toFixed(0)}% vs ${(ascRate * 100).toFixed(0)}% northbound) — antenna may face south.`
      );
    }
  }

  // Per-satellite imbalance
  const maxSatRate = Math.max(...perSat.map((s) => s.rate));
  const minSatRate = Math.min(...perSat.map((s) => s.rate));
  if (maxSatRate - minSatRate > 0.3 && perSat.every((s) => s.predicted >= 3)) {
    bits.push('Reception varies significantly between satellites — may indicate directional obstruction.');
  }

  return bits.join(' ');
}

function emptyCoverage(
  health: SatCoverage['health'],
  diagnosis: string
): SatCoverage {
  return {
    totalPredicted: 0,
    totalReceived: 0,
    receptionRate: 0,
    perSat: [],
    ascendingPredicted: 0,
    ascendingReceived: 0,
    descendingPredicted: 0,
    descendingReceived: 0,
    diagnosis,
    health,
    passes: [],
  };
}
