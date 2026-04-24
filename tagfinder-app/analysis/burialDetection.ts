import type {
  SeriesReading,
  TagStatus,
  DeploySummary,
  BurialDetection,
  BurialVerdict,
} from '@/lib/types';

/**
 * Detect whether the tag's post-release temperature profile matches the
 * thermal signature of an object buried in sand.
 *
 * Published reference (sea turtle nest + soil physics):
 *   - Diel amplitude at nest-chamber depth (~40–60 cm): 0.3–1.4 °C
 *   - Open-air diel swing for a sun-exposed surface object: 10–20 °C
 *   - Thermal diffusivity of sandy soil: ~2–9 × 10⁻⁷ m²/s; amplitude
 *     attenuates exponentially with depth
 *
 * Classification logic (in order of precedence):
 *   1. Need ≥2 full 24-hour windows of post-release readings, else 'insufficient'
 *   2. Low diel amplitude (< 3 °C median) + mean near ambient air → 'buried_in_sand'
 *   3. Low diel amplitude + mean matches SST → 'in_water'
 *   4. Low diel amplitude + mean far from ambient (cooler than air in hot month,
 *      warmer in cold month, > 8 °C off) → 'insulated_indoor'
 *   5. High diel amplitude (> 5 °C) → 'surface_exposed'
 *   6. Middle ground → 'unknown'
 *
 * Distinguishing this from `tempComparison` (which checks MEAN vs ambient):
 * burial detection is about the SHAPE of the time series — specifically the
 * diurnal amplitude — which is the positive-ID signal for sand burial.
 */
export function detectBurial(
  seriesReadings: SeriesReading[],
  statuses: TagStatus[],
  summary: DeploySummary | null,
  sources: {
    airTempC: number | null;
    sstTempC: number | null;
  }
): BurialDetection {
  const releaseTime = summary?.releaseDate?.getTime() ?? null;

  if (releaseTime === null) {
    return {
      verdict: 'insufficient',
      reasoning:
        "Summary.csv has no ReleaseDate — can't separate pre-release (in-water dive profile) readings from post-release (current environment) readings. Burial detection requires a confidently post-popoff thermal time series.",
      medianDielAmplitudeC: null,
      medianTempC: null,
      windowsAnalyzed: 0,
      confidence: 0,
    };
  }

  // Assemble post-release temperature readings with timestamps.
  const readings: { t: number; temp: number }[] = [];

  const postSeries = seriesReadings.filter(
    (s) => s.date.getTime() > releaseTime && s.temperature !== null
  );
  for (const s of postSeries) {
    readings.push({ t: s.date.getTime(), temp: s.temperature as number });
  }

  const postStatus = statuses.filter(
    (s) => s.date.getTime() > releaseTime && s.temperature !== null
  );
  for (const s of postStatus) {
    readings.push({ t: s.date.getTime(), temp: s.temperature as number });
  }

  readings.sort((a, b) => a.t - b.t);

  if (readings.length === 0) {
    return {
      verdict: 'insufficient',
      reasoning:
        'No post-release tag temperature readings have come through yet — the tag may still be replaying its pre-release archive.',
      medianDielAmplitudeC: null,
      medianTempC: null,
      windowsAnalyzed: 0,
      confidence: 0,
    };
  }

  // Bucket readings into 24-hour windows anchored to the first reading.
  // A "window" is valid if it spans at least 18 hours and has ≥6 readings
  // (a reasonable lower bound to estimate amplitude).
  const DAY_MS = 24 * 60 * 60 * 1000;
  const firstT = readings[0].t;
  const windows: { temps: number[]; spanH: number }[] = [];
  let currentStart = firstT;
  let currentTemps: number[] = [];
  let currentMinT = firstT;
  let currentMaxT = firstT;

  for (const r of readings) {
    if (r.t - currentStart >= DAY_MS) {
      const spanH = (currentMaxT - currentMinT) / (60 * 60 * 1000);
      if (currentTemps.length >= 6 && spanH >= 18) {
        windows.push({ temps: currentTemps, spanH });
      }
      currentStart = r.t;
      currentTemps = [];
      currentMinT = r.t;
      currentMaxT = r.t;
    }
    currentTemps.push(r.temp);
    if (r.t < currentMinT) currentMinT = r.t;
    if (r.t > currentMaxT) currentMaxT = r.t;
  }
  // Tail window
  {
    const spanH = (currentMaxT - currentMinT) / (60 * 60 * 1000);
    if (currentTemps.length >= 6 && spanH >= 18) {
      windows.push({ temps: currentTemps, spanH });
    }
  }

  if (windows.length < 2) {
    return {
      verdict: 'insufficient',
      reasoning: `Only ${windows.length} full 24-hour window${windows.length === 1 ? '' : 's'} of post-release temperature data — need at least 2 complete days to compute a reliable diel amplitude.`,
      medianDielAmplitudeC: null,
      medianTempC:
        readings.length > 0 ? median(readings.map((r) => r.temp)) : null,
      windowsAnalyzed: windows.length,
      confidence: 0.2,
    };
  }

  // Compute diel amplitudes per window (max minus min of temps in that window)
  const amplitudes = windows.map((w) => Math.max(...w.temps) - Math.min(...w.temps));
  const medianAmp = median(amplitudes);
  const medianTemp = median(readings.map((r) => r.temp));

  // Classify
  let verdict: BurialVerdict;
  let reasoning: string;
  let confidence: number;

  const LOW_AMPLITUDE = 3; // °C — sand signature
  const HIGH_AMPLITUDE = 5; // °C — surface-exposed signature

  const airDelta =
    sources.airTempC !== null ? Math.abs(medianTemp - sources.airTempC) : null;
  const sstDelta =
    sources.sstTempC !== null ? Math.abs(medianTemp - sources.sstTempC) : null;

  if (medianAmp < LOW_AMPLITUDE) {
    // Low amplitude — distinguish between the three flat-line scenarios
    if (sstDelta !== null && sstDelta < 2) {
      verdict = 'in_water';
      reasoning = `Diel temperature amplitude is only ${medianAmp.toFixed(1)} °C and mean (${medianTemp.toFixed(1)} °C) matches SST (${sources.sstTempC!.toFixed(1)} °C). Consistent with the tag floating at or just below the sea surface — low amplitude from water's high thermal inertia, not from burial.`;
      confidence = 0.8;
    } else if (airDelta !== null && airDelta > 8) {
      verdict = 'insulated_indoor';
      reasoning = `Low diel amplitude (${medianAmp.toFixed(1)} °C) but mean tag temp (${medianTemp.toFixed(1)} °C) is ${airDelta.toFixed(1)} °C away from ambient air (${sources.airTempC!.toFixed(1)} °C). Signature of a climate-controlled enclosure — AC building, heated room, or refrigerator — not beach burial.`;
      confidence = 0.75;
    } else {
      verdict = 'buried_in_sand';
      const meanNote =
        airDelta !== null
          ? ` Mean (${medianTemp.toFixed(1)} °C) tracks local air (${sources.airTempC!.toFixed(1)} °C, Δ=${airDelta.toFixed(1)} °C) — consistent with shallow burial.`
          : '';
      reasoning = `Diel amplitude is only ${medianAmp.toFixed(1)} °C across ${windows.length} days — vastly below the 10+ °C swing a surface-exposed tag would show, and in the 0.3–1.4 °C range published for sea turtle nest loggers at sand depth.${meanNote} Tag is likely buried in sand or shallow sediment.`;
      confidence = 0.8;
    }
  } else if (medianAmp > HIGH_AMPLITUDE) {
    verdict = 'surface_exposed';
    reasoning = `Diel amplitude is ${medianAmp.toFixed(1)} °C across ${windows.length} days — consistent with a tag exposed to direct sun/shade cycles above ground. Not buried.`;
    confidence = 0.75;
  } else {
    verdict = 'unknown';
    reasoning = `Diel amplitude is ${medianAmp.toFixed(1)} °C — between the sand-buried (< 3 °C) and surface-exposed (> 5 °C) thresholds. Ambiguous; could be partial cover, intermittent exposure, or unusual ambient conditions.`;
    confidence = 0.4;
  }

  return {
    verdict,
    reasoning,
    medianDielAmplitudeC: Number(medianAmp.toFixed(2)),
    medianTempC: Number(medianTemp.toFixed(2)),
    windowsAnalyzed: windows.length,
    confidence,
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n % 2 === 1) return sorted[(n - 1) / 2];
  return (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}
