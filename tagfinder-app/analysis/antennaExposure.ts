import type { AnnotatedPass, AntennaExposure } from '@/lib/types';

/**
 * Diagnose antenna exposure from the received-vs-missed pass pattern.
 *
 * Signals:
 * - **Elevation cutoff**: if received passes cluster at high elevations and missed
 *   passes are at lower elevations, the antenna has a limited sky-view cone
 *   (classic "buried with small opening" signature).
 * - **Azimuth bias**: if received passes cluster in one compass direction, the
 *   antenna is obstructed on the opposite side.
 */
export function analyzeAntennaExposure(passes: AnnotatedPass[]): AntennaExposure {
  const received = passes.filter((p) => p.received);
  const missed = passes.filter((p) => !p.received);

  // Need enough data to draw conclusions
  if (received.length < 2 || passes.length < 6) {
    return {
      pattern: 'too_few_passes',
      minReceivedElevation: received.length > 0 ? min(received.map((p) => p.maxElevation)) : null,
      meanReceivedElevation: received.length > 0 ? mean(received.map((p) => p.maxElevation)) : null,
      meanMissedElevation: missed.length > 0 ? mean(missed.map((p) => p.maxElevation)) : null,
      elevationCutoffDeg: null,
      meanReceivedAzimuth: received.length > 0 ? circularMean(received.map((p) => p.peakAzimuth)) : null,
      azimuthBias: null,
      reasoning: 'Not enough passes to diagnose antenna exposure with confidence.',
      confidence: 0,
    };
  }

  const receivedEls = received.map((p) => p.maxElevation);
  const missedEls = missed.map((p) => p.maxElevation);

  const minReceived = min(receivedEls);
  const meanReceived = mean(receivedEls);
  const meanMissed = mean(missedEls);
  const maxMissed = max(missedEls);

  // Elevation cutoff estimate: halfway between max missed and min received.
  // If min received > max missed, the cutoff is clean — that's strong signal.
  const cleanCutoff = minReceived > maxMissed;
  const elevationCutoffDeg = cleanCutoff
    ? (minReceived + maxMissed) / 2
    : null;

  // Azimuth analysis
  const meanReceivedAz = circularMean(received.map((p) => p.peakAzimuth));
  const azimuthBias = detectAzimuthBias(received, missed);

  // Pattern classification
  let pattern: AntennaExposure['pattern'] = 'clear';
  let reasoning = '';
  let confidence = 0;

  const elevDiff = meanReceived - meanMissed;
  const narrowCone = minReceived >= 60 && elevDiff > 20;
  const horizonBlocked = minReceived >= 30 && elevDiff > 15;

  if (narrowCone) {
    pattern = 'narrow_cone';
    confidence = cleanCutoff ? 0.9 : 0.7;
    reasoning = `Tag only receives signals from satellites very high in the sky (peak elevation >=${minReceived.toFixed(0)}°). This indicates a narrow cone of sky visibility — consistent with the antenna being deep in a hole, inside a container, or at the bottom of a pipe with only a small opening above.`;
  } else if (horizonBlocked) {
    pattern = 'horizon_obstructed';
    confidence = cleanCutoff ? 0.85 : 0.65;
    reasoning = `Reception only succeeds for passes above ~${minReceived.toFixed(0)}°. The horizon is obstructed all around — typical of a partially buried tag where the antenna is below surface level but can see sky nearly overhead. Received passes average ${meanReceived.toFixed(0)}° elevation vs ${meanMissed.toFixed(0)}° for missed passes.`;
  } else if (azimuthBias && azimuthBias !== 'symmetric') {
    pattern = 'directional';
    confidence = 0.7;
    const windowFaces = { N: 'north', E: 'east', S: 'south', W: 'west' }[azimuthBias];
    reasoning = `Reception is biased toward the ${azimuthBias} (mean received azimuth ${meanReceivedAz.toFixed(0)}°). Passes from the opposite direction are consistently missed, suggesting a directional obstruction — e.g., the tag is indoors near a window facing ${windowFaces}, or the antenna is blocked by a wall/roof/vehicle on one side.`;
  } else if (received.length / passes.length > 0.3) {
    pattern = 'clear';
    confidence = 0.6;
    reasoning = `Reception is reasonably consistent across elevations and directions — antenna appears relatively exposed. Received average elevation ${meanReceived.toFixed(0)}°, missed average ${meanMissed.toFixed(0)}°.`;
  } else {
    pattern = 'unknown';
    confidence = 0.3;
    reasoning = `Reception rate is low but no clear elevation or directional pattern emerges. The antenna may have intermittent obstruction, or the tag is transmitting at low power.`;
  }

  return {
    pattern,
    minReceivedElevation: minReceived,
    meanReceivedElevation: meanReceived,
    meanMissedElevation: meanMissed,
    elevationCutoffDeg,
    meanReceivedAzimuth: meanReceivedAz,
    azimuthBias,
    reasoning,
    confidence,
  };
}

// ─── helpers ─────────────────────────────────────────────

function mean(xs: number[]): number {
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function min(xs: number[]): number {
  return Math.min(...xs);
}

function max(xs: number[]): number {
  return Math.max(...xs);
}

/** Circular mean of compass-heading angles in degrees */
function circularMean(angles: number[]): number {
  if (angles.length === 0) return 0;
  let sinSum = 0;
  let cosSum = 0;
  for (const a of angles) {
    const rad = (a * Math.PI) / 180;
    sinSum += Math.sin(rad);
    cosSum += Math.cos(rad);
  }
  const meanRad = Math.atan2(sinSum / angles.length, cosSum / angles.length);
  return ((meanRad * 180) / Math.PI + 360) % 360;
}

/**
 * Detect whether received passes are biased toward one compass quadrant
 * while missed passes come predominantly from the opposite quadrant.
 */
function detectAzimuthBias(
  received: AnnotatedPass[],
  missed: AnnotatedPass[]
): AntennaExposure['azimuthBias'] {
  if (received.length < 3 || missed.length < 3) return 'symmetric';

  // Count passes by quadrant (N: 315-45, E: 45-135, S: 135-225, W: 225-315)
  const quadrantCounts = (passes: AnnotatedPass[]) => {
    const counts = { N: 0, E: 0, S: 0, W: 0 };
    for (const p of passes) {
      const az = p.peakAzimuth;
      if (az >= 315 || az < 45) counts.N++;
      else if (az < 135) counts.E++;
      else if (az < 225) counts.S++;
      else counts.W++;
    }
    return counts;
  };

  const rec = quadrantCounts(received);
  const mis = quadrantCounts(missed);

  // Reception rate per quadrant
  type Q = 'N' | 'E' | 'S' | 'W';
  const quadrants: Q[] = ['N', 'E', 'S', 'W'];
  const rates = quadrants.map((q): { q: Q; rate: number; predicted: number } => {
    const total = rec[q] + mis[q];
    return { q, rate: total > 0 ? rec[q] / total : 0, predicted: total };
  });

  // Only meaningful if each quadrant has at least 2 predicted passes
  if (rates.some((r) => r.predicted < 2)) return 'symmetric';

  const maxRate = Math.max(...rates.map((r) => r.rate));
  const minRate = Math.min(...rates.map((r) => r.rate));

  // Need significant spread to call it biased
  if (maxRate - minRate < 0.4) return 'symmetric';

  const best = rates.find((r) => r.rate === maxRate);
  return best ? best.q : 'symmetric';
}
