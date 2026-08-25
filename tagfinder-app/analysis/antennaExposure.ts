import type {
  AnnotatedPass,
  AntennaExposure,
  AntennaOrientation,
} from '@/lib/types';

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
/**
 * Reception rate as a function of pass elevation.
 *
 * The elevation tests used to key off the LOWEST elevation at which anything was
 * received, which is an extreme-value statistic and behaves like one: across a
 * couple of hundred passes at least one low pass always gets through, the
 * minimum collapses, and the test that should have fired never does. On a tag
 * lying in wrack — horizon blocked all round, misses concentrated at the rim —
 * it fell through to the directional branch instead and reported the tag as
 * being indoors beside a south-facing window.
 *
 * Binning every pass and comparing rates uses all the evidence and cannot be
 * overturned by one lucky reception.
 */
const ELEVATION_BANDS: [number, number][] = [
  [0, 15],
  [15, 30],
  [30, 50],
  [50, 90],
];
/** Predicted passes a band needs before its rate means anything. */
const MIN_BAND_PASSES = 5;
/**
 * Rate gap between the lowest and highest populated band that marks a blocked
 * horizon. A clear tag is heard slightly better high up simply because those
 * passes last longer, so the bar sits well above that.
 */
const HORIZON_RATE_GAP = 0.25;

function elevationProfile(passes: AnnotatedPass[]) {
  return ELEVATION_BANDS.map(([lo, hi]) => {
    const inBand = passes.filter((p) => p.maxElevation >= lo && p.maxElevation < hi);
    const rec = inBand.filter((p) => p.received).length;
    return { lo, hi, predicted: inBand.length, rate: inBand.length ? rec / inBand.length : 0 };
  }).filter((b) => b.predicted >= MIN_BAND_PASSES);
}

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
      orientation: null,
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

  // Rate-based, so a single low reception cannot suppress the finding.
  const profile = elevationProfile(passes);
  const lowBand = profile[0];
  const highBand = profile[profile.length - 1];
  const rateGap =
    profile.length >= 2 ? highBand.rate - lowBand.rate : 0;
  const horizonByRate = profile.length >= 2 && rateGap >= HORIZON_RATE_GAP;

  const narrowCone = minReceived >= 60 && elevDiff > 20;
  const horizonBlocked = (minReceived >= 30 && elevDiff > 15) || horizonByRate;

  if (narrowCone) {
    pattern = 'narrow_cone';
    confidence = cleanCutoff ? 0.9 : 0.7;
    reasoning = `Tag only receives signals from satellites very high in the sky (peak elevation >=${minReceived.toFixed(0)}°). This indicates a narrow cone of sky visibility — consistent with the antenna being deep in a hole, inside a container, or at the bottom of a pipe with only a small opening above.`;
  } else if (horizonBlocked) {
    pattern = 'horizon_obstructed';
    confidence = cleanCutoff ? 0.85 : 0.65;
    reasoning = horizonByRate
      ? `Reception improves steadily with elevation — ${(lowBand.rate * 100).toFixed(0)}% of passes below ${lowBand.hi}° are heard against ${(highBand.rate * 100).toFixed(0)}% above ${highBand.lo}°. The horizon is obstructed all round rather than on one side, which is what sand, wrack, vegetation or a depression over the tag produces. Overhead sky is still reaching the antenna, so the tag is covered or sunk into its surroundings rather than sealed away.`
      : `Reception only succeeds for passes above ~${minReceived.toFixed(0)}°. The horizon is obstructed all around — typical of a partially buried tag where the antenna is below surface level but can see sky nearly overhead. Received passes average ${meanReceived.toFixed(0)}° elevation vs ${meanMissed.toFixed(0)}° for missed passes.`;
  } else if (azimuthBias && azimuthBias !== 'symmetric') {
    pattern = 'directional';
    confidence = 0.7;
    // Quotes the quadrant reception rates, which are what the verdict is
    // actually computed from. The old text quoted the circular mean of received
    // azimuths instead — an unrelated statistic that can point anywhere, and on
    // one report announced a bias "toward the S" alongside a mean azimuth of
    // 61°, which is ENE. It also guessed at indoor storage, which for a tag
    // sitting in a bay is not a hypothesis the data can support.
    const rates = quadrantReceptionRates(received, missed);
    const worst = rates.reduce((a, b) => (a.rate < b.rate ? a : b));
    const best = rates.reduce((a, b) => (a.rate > b.rate ? a : b));
    reasoning = `Reception is strongly directional: ${(best.rate * 100).toFixed(0)}% of passes from the ${best.q} are heard against ${(worst.rate * 100).toFixed(0)}% from the ${worst.q}. Something solid stands between the tag and the ${worst.q} — a seawall, bank, hull, piling, vegetation or the object it is resting against. Search that side first, and expect a receiver to go quiet when the tag is between you and the obstruction.`;
  } else if (received.length / passes.length > 0.3) {
    pattern = 'clear';
    confidence = 0.6;
    reasoning = `Reception is reasonably consistent across elevations and directions — antenna appears relatively exposed. Received average elevation ${meanReceived.toFixed(0)}°, missed average ${meanMissed.toFixed(0)}°.`;
  } else {
    pattern = 'unknown';
    confidence = 0.3;
    reasoning = `Reception rate is low but no clear elevation or directional pattern emerges. The antenna may have intermittent obstruction, or the tag is transmitting at low power.`;
  }

  // Try to fit a physical antenna orientation (tilt + heading) to the pattern.
  // Needs ≥6 received and ≥3 missed passes to be meaningful.
  const orientation =
    received.length >= 6 && missed.length >= 3
      ? inferAntennaOrientation(received, missed)
      : null;

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
    orientation,
  };
}

/**
 * Fit a whip antenna orientation (tilt from vertical, compass heading of tilt)
 * to the elevation/azimuth pattern of received vs missed passes.
 *
 * Whip antenna gain pattern (idealized): proportional to sin²(angle between
 * antenna axis and the satellite direction). Maximum gain perpendicular to
 * the wire, zero gain along the wire (the "blind cone").
 *
 * We grid-search candidate (tilt, heading) values and pick the orientation
 * whose predicted gains best match received-vs-missed (high gain → received,
 * low gain → missed) under a Bernoulli log-likelihood.
 */
function inferAntennaOrientation(
  received: AnnotatedPass[],
  missed: AnnotatedPass[]
): AntennaOrientation {
  type Sample = { el: number; az: number; received: 0 | 1 };
  const samples: Sample[] = [
    ...received.map((p) => ({ el: p.maxElevation, az: p.peakAzimuth, received: 1 as const })),
    ...missed.map((p) => ({ el: p.maxElevation, az: p.peakAzimuth, received: 0 as const })),
  ];

  let bestScore = -Infinity;
  let bestTilt = 0;
  let bestHeading = 0;

  // Grid search: tilt 0..90° step 5°, heading 0..330° step 30°.
  // Heading doesn't matter when tilt is 0, so skip the inner loop there.
  for (let tilt = 0; tilt <= 90; tilt += 5) {
    const headings = tilt < 5 ? [0] : Array.from({ length: 12 }, (_, i) => i * 30);
    for (const heading of headings) {
      const score = scoreOrientation(samples, tilt, heading);
      if (score > bestScore) {
        bestScore = score;
        bestTilt = tilt;
        bestHeading = heading;
      }
    }
  }

  // Confidence: compare best fit's likelihood to a chance-baseline (50/50).
  // A perfect fit would saturate at 0 (max log-likelihood for binary outcomes).
  const uniformScore = samples.length * Math.log(0.5);
  const lift = bestScore - uniformScore;
  const maxLift = -uniformScore; // perfect fit
  const confidence = Math.max(0, Math.min(1, lift / Math.max(maxLift, 0.01)));

  const tiltHeading = bestTilt < 15 ? null : bestHeading;
  const description = describeOrientation(bestTilt, tiltHeading);

  return {
    tiltDeg: bestTilt,
    tiltHeadingDeg: tiltHeading,
    description,
    confidence,
    passCount: samples.length,
  };
}

/** Bernoulli log-likelihood that an orientation explains the data. */
function scoreOrientation(
  samples: { el: number; az: number; received: 0 | 1 }[],
  tiltDeg: number,
  headingDeg: number
): number {
  const tiltRad = (tiltDeg * Math.PI) / 180;
  const headingRad = (headingDeg * Math.PI) / 180;
  // Antenna axis unit vector in (East, North, Up) coords
  const axis = {
    e: Math.sin(tiltRad) * Math.sin(headingRad),
    n: Math.sin(tiltRad) * Math.cos(headingRad),
    u: Math.cos(tiltRad),
  };

  let logLik = 0;
  const eps = 0.05; // floor probability so log doesn't blow up
  for (const s of samples) {
    const elRad = (s.el * Math.PI) / 180;
    const azRad = (s.az * Math.PI) / 180;
    // Satellite direction unit vector (from tag toward sat)
    const sat = {
      e: Math.cos(elRad) * Math.sin(azRad),
      n: Math.cos(elRad) * Math.cos(azRad),
      u: Math.sin(elRad),
    };
    const cos = axis.e * sat.e + axis.n * sat.n + axis.u * sat.u;
    const gain = 1 - cos * cos; // sin²(angle between)
    // Map gain (0–1) to reception probability with a soft floor
    const p = eps + (1 - 2 * eps) * gain;
    logLik += s.received === 1 ? Math.log(p) : Math.log(1 - p);
  }
  return logLik;
}

function describeOrientation(tilt: number, heading: number | null): string {
  if (tilt < 15) {
    return `Antenna near-vertical (tilt ${tilt}°) — normal upright orientation.`;
  }
  if (tilt < 45) {
    return `Antenna tilted ${tilt}° from vertical, leaning ${headingToCompass(heading!)}. Tag may be partially propped or wedged.`;
  }
  if (tilt < 75) {
    return `Antenna at a steep tilt (${tilt}°), oriented roughly ${headingToCompass(heading!)}. Tag is on its side or significantly tipped.`;
  }
  return `Antenna lying nearly horizontal (tilt ${tilt}°), pointing ${headingToCompass(heading!)}. Tag is flat on the ground with the wire parallel to the surface.`;
}

function headingToCompass(deg: number): string {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
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
type Quadrant = 'N' | 'E' | 'S' | 'W';

/** Count passes by quadrant (N: 315-45, E: 45-135, S: 135-225, W: 225-315). */
function quadrantCounts(passes: AnnotatedPass[]): Record<Quadrant, number> {
  const counts: Record<Quadrant, number> = { N: 0, E: 0, S: 0, W: 0 };
  for (const p of passes) {
    const az = p.peakAzimuth;
    if (az >= 315 || az < 45) counts.N++;
    else if (az < 135) counts.E++;
    else if (az < 225) counts.S++;
    else counts.W++;
  }
  return counts;
}

/**
 * Reception rate per compass quadrant. Shared so the sentence reported to the
 * user quotes the same numbers the verdict was computed from — they used to be
 * derived separately, and the report ended up pairing a quadrant verdict with an
 * unrelated mean azimuth that contradicted it.
 */
export function quadrantReceptionRates(
  received: AnnotatedPass[],
  missed: AnnotatedPass[]
): { q: Quadrant; rate: number; predicted: number }[] {
  const rec = quadrantCounts(received);
  const mis = quadrantCounts(missed);
  const quadrants: Quadrant[] = ['N', 'E', 'S', 'W'];
  return quadrants.map((q) => {
    const total = rec[q] + mis[q];
    return { q, rate: total > 0 ? rec[q] / total : 0, predicted: total };
  });
}

function detectAzimuthBias(
  received: AnnotatedPass[],
  missed: AnnotatedPass[]
): AntennaExposure['azimuthBias'] {
  if (received.length < 3 || missed.length < 3) return 'symmetric';

  const rates = quadrantReceptionRates(received, missed);

  // Only meaningful if each quadrant has at least 2 predicted passes
  if (rates.some((r) => r.predicted < 2)) return 'symmetric';

  const maxRate = Math.max(...rates.map((r) => r.rate));
  const minRate = Math.min(...rates.map((r) => r.rate));

  // Need significant spread to call it biased
  if (maxRate - minRate < 0.4) return 'symmetric';

  const best = rates.find((r) => r.rate === maxRate);
  return best ? best.q : 'symmetric';
}
