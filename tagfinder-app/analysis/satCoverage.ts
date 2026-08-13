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
 * Normalize satellite names across Argos short codes and CelesTrak TLE names
 * onto one canonical key, so received passes can be matched to predicted ones.
 *
 * Argos data uses two-character codes ("MC", "SR", "3D"); CelesTrak uses display
 * names ("METOP-C", "SARAL", "KINEIS-3D"). The Kinéis codes are of the form
 * <plane 1-5><slot A-E> and map directly onto the CelesTrak name.
 */
export function normalizeSatName(name: string): string {
  const n = (name || '').trim().toUpperCase();

  // Kinéis short code, e.g. "3D" → KINEIS-3D
  if (/^[1-5][A-E]$/.test(n)) return `KINEIS-${n}`;
  // Any KIN-prefixed spelling: the DS dump and the CLS message export both
  // write "KIN2B", which matched nothing before and silently dropped 21 of the
  // 25 satellites in a CLS dataset out of coverage analysis entirely.
  const kineis = n.match(/^KIN(?:EIS)?[\s-]*([1-5][A-E])$/);
  if (kineis) return `KINEIS-${kineis[1]}`;

  const map: Record<string, string> = {
    NK: 'NOAA-15',
    NN: 'NOAA-20',
    NP: 'NOAA-19',
    MA: 'METOP-A',
    MB: 'METOP-B',
    MC: 'METOP-C',
    SR: 'SARAL',
    O3: 'OCEANSAT-3',
  };
  if (map[n]) return map[n];

  // CelesTrak names Oceansat-3 "EOS-6 (OCEANSAT-3)"
  if (n.includes('OCEANSAT-3') || n.startsWith('EOS-6')) return 'OCEANSAT-3';
  // Already full-name?
  if (n.startsWith('NOAA')) return n.replace(' ', '-');
  if (n.startsWith('METOP')) return n.replace(' ', '-');
  if (n.startsWith('SARAL')) return 'SARAL';
  return n;
}

/**
 * Compute satellite coverage statistics by comparing predicted vs received passes.
 */
/**
 * Predicted passes from a satellite that never once heard the tag, over this
 * many opportunities, are not evidence of obstruction.
 *
 * We predict passes for every satellite in the TLE set, but not every satellite
 * in orbit carries the Argos payload, is commissioned, or is serving a given
 * programme. A tag that is heard by twenty satellites and never by five is not
 * being blocked from five directions — those five are not listening.
 *
 * Counting them anyway does real damage. On a healthy reference dataset seven
 * satellites sat at 0/17-0/19 and dragged the reception rate to 36%, which then
 * read as "reception varies significantly between satellites — may indicate
 * directional obstruction". That is a finding about the satellite roster
 * presented as a finding about the tag.
 *
 * The threshold is a floor on evidence, not a guess about hardware: across this
 * many passes the geometry varies enough that a listening satellite would have
 * heard something.
 */
const NON_SERVING_MIN_PASSES = 6;
/** Standard errors from the overall rate before a satellite counts as odd. */
const SAT_OUTLIER_SIGMA = 3;
/** ...and the passes needed before that comparison is worth making. */
const SAT_OUTLIER_MIN_PASSES = 8;

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

  // Satellites that never heard the tag across enough opportunities are not
  // serving it. Drop them from the denominator and from every downstream
  // obstruction judgement, but report them so the exclusion is visible.
  const nonServing = perSat
    .filter((s) => s.received === 0 && s.predicted >= NON_SERVING_MIN_PASSES)
    .map((s) => ({ name: s.name, predicted: s.predicted }));
  const nonServingNames = new Set(nonServing.map((s) => s.name));
  const servingPerSat = perSat.filter((s) => !nonServingNames.has(s.name));

  const isServing = (p: SatellitePass) => !nonServingNames.has(p.satelliteName);
  const servingPredicted = predicted.filter(isServing);
  const servingMatched = Array.from(matchedIds).filter((i) => isServing(predicted[i]));

  // Direction bias
  const ascPredicted = servingPredicted.filter((p) => p.direction === 'ascending').length;
  const descPredicted = servingPredicted.filter((p) => p.direction === 'descending').length;
  const ascReceived = servingMatched.filter(
    (i) => predicted[i].direction === 'ascending'
  ).length;
  const descReceived = servingMatched.filter(
    (i) => predicted[i].direction === 'descending'
  ).length;

  const totalPredicted = servingPredicted.length;
  const totalReceived = servingMatched.length;
  const rate = totalPredicted > 0 ? totalReceived / totalPredicted : 0;

  // Health classification
  let health: SatCoverage['health'];
  if (rate >= 0.2) health = 'healthy';
  else if (rate >= 0.08) health = 'marginal';
  else health = 'poor';

  // Diagnosis
  const diagnosis = interpretCoverage(
    rate, servingPerSat, ascPredicted, ascReceived, descPredicted, descReceived, nonServing
  );

  // Build per-pass annotations for sky chart
  // Sky chart shows only satellites that were actually serving the tag; arcs
  // from a silent satellite are not "missed" and painting them red implies a
  // blocked direction that is not there.
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
    perSat: servingPerSat,
    nonServing,
    ascendingPredicted: ascPredicted,
    ascendingReceived: ascReceived,
    descendingPredicted: descPredicted,
    descendingReceived: descReceived,
    diagnosis,
    health,
    passes: annotatedPasses.filter((p) => !nonServingNames.has(p.satelliteName)),
  };
}

function interpretCoverage(
  rate: number,
  perSat: SatCoverage['perSat'],
  ascP: number,
  ascR: number,
  descP: number,
  descR: number,
  nonServing: { name: string; predicted: number }[]
): string {
  const bits: string[] = [];

  // Describes what was measured — how many overpasses produced anything at all —
  // and stops short of concluding the antenna was exposed. It cannot see how
  // MANY messages each pass delivered, and that is where obstruction shows: a
  // tag recovered lying in wet wrack was heard on 46% of its predicted passes
  // while averaging only 5.1 messages per pass, and this line called it
  // "well-exposed". analyzeReceptionQuality owns the exposure verdict.
  if (rate >= 0.25) {
    bits.push(
      'Most predicted overpasses produced at least one message, so the tag was ' +
        'reaching satellites routinely. How well it was exposed depends on how many ' +
        'messages each pass carried, which this rate does not measure.'
    );
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

  // Per-satellite imbalance.
  //
  // Tested for significance rather than range, because range alone measures
  // sampling noise. Each satellite contributes only a dozen or two passes, so at
  // an overall rate near 50% the standard error on one satellite is about 12
  // percentage points — and across twenty satellites the widest gap will
  // routinely exceed 30 points with nothing whatsoever wrong. The old
  // max-minus-min > 0.3 test therefore fired on healthy tags, and reported
  // sampling variation as "directional obstruction".
  //
  // A satellite now has to sit more than SAT_OUTLIER_SIGMA standard errors off
  // the overall rate, on enough passes for that to mean anything.
  const outliers = perSat.filter((sat) => {
    if (sat.predicted < SAT_OUTLIER_MIN_PASSES) return false;
    const se = Math.sqrt((rate * (1 - rate)) / sat.predicted);
    if (se === 0) return false;
    return Math.abs(sat.rate - rate) / se > SAT_OUTLIER_SIGMA;
  });
  if (outliers.length > 0) {
    const worst = outliers.reduce((a, b) =>
      Math.abs(b.rate - rate) > Math.abs(a.rate - rate) ? b : a
    );
    bits.push(
      `${worst.name} heard ${(worst.rate * 100).toFixed(0)}% of its passes against ` +
        `${(rate * 100).toFixed(0)}% overall — more than sampling noise explains, which can ` +
        `mean the antenna favours one part of the sky.`
    );
  }

  if (nonServing.length > 0) {
    const names = nonServing.map((s) => s.name).join(', ');
    bits.push(
      `${nonServing.length} satellite${nonServing.length > 1 ? 's' : ''} (${names}) never ` +
        `heard this tag across ${Math.min(...nonServing.map((s) => s.predicted))}+ passes each ` +
        `and are treated as not carrying it, so they are excluded from the rate above rather ` +
        `than counted as missed.`
    );
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
    nonServing: [],
    ascendingPredicted: 0,
    ascendingReceived: 0,
    descendingPredicted: 0,
    descendingReceived: 0,
    diagnosis,
    health,
    passes: [],
  };
}
