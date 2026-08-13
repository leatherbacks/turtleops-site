import type {
  SeriesReading,
  TagStatus,
  DeploySummary,
  DailySummary,
  HistogramSet,
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
  },
  /** Pre-aggregated daily MinTemp/MaxTemp from DailyData.csv. When available
   *  this is preferred over computing diel amplitude from raw Series readings —
   *  the tag's firmware computes it cleanly, and a single DailyData row covers
   *  a full UTC day even when Series gaps exist. */
  dailySummaries: DailySummary[] = [],
  /** Time-At-Depth histograms from Histos.csv. When post-release TAD rows
   *  show ~100% of the day in Bin 1 (depth 0–1 m), the tag has been
   *  continuously dry — strong corroboration for beach burial vs floating. */
  histograms: HistogramSet | null = null
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

  // Preferred path: use DailyData rows if any post-release ones exist. The
  // tag's firmware has already computed MinTemp/MaxTemp per UTC day, so the
  // diel amplitude is read off directly with no bucketing logic needed.
  const postReleaseDailies = dailySummaries.filter(
    (d) =>
      d.date.getTime() > releaseTime - 12 * 60 * 60 * 1000 &&
      d.minTemp !== null &&
      d.maxTemp !== null
  );

  // Compute TAD signal if available — % of post-release time spent in Bin 1
  // (the shallowest bin, typically 0-1 m). 100% = always dry/buried.
  const tadSignal = computeTadSignal(histograms, releaseTime);

  if (postReleaseDailies.length >= 2) {
    return classifyFromDailies(postReleaseDailies, sources, tadSignal);
  }

  // Fallback: bucket raw Series/Status readings into 24h windows ourselves.
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

interface TadSignal {
  /** Mean % of post-release time in the shallowest TAD bin */
  bin1Pct: number;
  /** Bin 1 upper edge (m) — typically 1 m */
  bin1UpperM: number;
  /** Number of post-release TAD rows used */
  daysAnalyzed: number;
}

/** % of time in the shallowest TAD bin across post-release TAD rows.
 *  Returns null when histograms aren't available or no post-release rows exist. */
function computeTadSignal(
  histograms: HistogramSet | null,
  releaseTime: number
): TadSignal | null {
  if (!histograms || histograms.tad.length === 0) return null;
  const postReleaseTAD = histograms.tad.filter(
    (r) => r.date.getTime() > releaseTime - 12 * 60 * 60 * 1000
  );
  if (postReleaseTAD.length === 0) return null;
  const bin1Upper = histograms.tadBinEdges[0] ?? 1;
  const bin1Pcts = postReleaseTAD
    .map((r) => r.counts[0] ?? 0)
    .filter((v) => !isNaN(v));
  if (bin1Pcts.length === 0) return null;
  const meanBin1 = bin1Pcts.reduce((s, v) => s + v, 0) / bin1Pcts.length;
  return {
    bin1Pct: meanBin1,
    bin1UpperM: bin1Upper,
    daysAnalyzed: bin1Pcts.length,
  };
}

/** Classify burial directly from DailyData rows. Tag firmware already gave
 *  us per-day MinTemp/MaxTemp + MinDepth/MaxDepth, so we read both signals
 *  off without bucketing.
 *
 *  Two independent burial signals are used:
 *  1. Temperature: tiny diel amplitude (<3 °C, vs 10+ °C for surface)
 *  2. Depth: a buried tag's pressure sensor registers SAND PRESSURE as
 *     fake "depth" — typically 0.5-2 m of constant pseudo-depth. One
 *     recovered tag read 1.35 m of "depth" while buried with its antenna
 *     proud of the surface. The tell is depth that is consistently
 *     NON-ZERO with very low day-to-day variance.
 *
 *     The converse does NOT hold, and a second recovered tag proves it: it
 *     was buried and read no depth at all. Dry sand arches, carrying its
 *     load through grain-to-grain contact to the sides rather than onto the
 *     pressure port, so a zero reading is no evidence against burial. Depth
 *     is treated here as confirmation when present, never as a requirement.
 *
 *  When both signals agree, confidence is very high. When only one fires,
 *  the verdict still goes through but with lower confidence. */
function classifyFromDailies(
  dailies: DailySummary[],
  sources: { airTempC: number | null; sstTempC: number | null },
  tad: TadSignal | null
): BurialDetection {
  const amplitudes = dailies.map((d) => (d.maxTemp as number) - (d.minTemp as number));
  const meanTemps = dailies.map((d) => ((d.maxTemp as number) + (d.minTemp as number)) / 2);
  const medianAmp = median(amplitudes);
  const medianTemp = median(meanTemps);

  // Depth signal: median per-day mean depth + day-to-day variability
  const depthCapableDays = dailies.filter(
    (d) => d.minDepth !== null && d.maxDepth !== null
  );
  let depthSignal: 'sand_pressure' | 'dry' | 'tidal' | 'unavailable' = 'unavailable';
  let medianDepth: number | null = null;
  if (depthCapableDays.length >= 2) {
    const meanDepths = depthCapableDays.map(
      (d) => ((d.minDepth as number) + (d.maxDepth as number)) / 2
    );
    medianDepth = median(meanDepths);
    const dailyDepthRanges = depthCapableDays.map(
      (d) => (d.maxDepth as number) - (d.minDepth as number)
    );
    const medianDepthRange = median(dailyDepthRanges);
    // Sand-pressure signature: median depth > 0.3 m AND daily range < 0.5 m
    // (constant pressure means it's not water — water levels would change
    // diurnally with tides and waves).
    if (medianDepth > 0.3 && medianDepthRange < 0.5) {
      depthSignal = 'sand_pressure';
    } else if (medianDepth < 0.2) {
      depthSignal = 'dry';
    } else {
      depthSignal = 'tidal';
    }
  }

  const airDelta =
    sources.airTempC !== null ? Math.abs(medianTemp - sources.airTempC) : null;
  const sstDelta =
    sources.sstTempC !== null ? Math.abs(medianTemp - sources.sstTempC) : null;

  const LOW_AMPLITUDE = 3;
  const HIGH_AMPLITUDE = 5;

  let verdict: BurialVerdict;
  let reasoning: string;
  let confidence: number;

  const dayCount = dailies.length;
  const sourceNote = `(${dayCount} day${dayCount === 1 ? '' : 's'} of DailyData.csv)`;
  const tadDryNote =
    tad && tad.bin1Pct > 95
      ? ` Time-at-Depth shows ${tad.bin1Pct.toFixed(0)}% of post-release time in the shallowest bin (0–${tad.bin1UpperM} m) across ${tad.daysAnalyzed} days — tag has been continuously dry, corroborating beach burial.`
      : '';
  const depthNote =
    depthSignal === 'sand_pressure'
      ? ` Pressure sensor reads ${medianDepth!.toFixed(2)} m of constant pseudo-depth — the tag's sensor is being squeezed by sand pressure, not water column. This is the same signature seen on a previously recovered tag, found buried in beach sand with its antenna proud of the surface, whose sensor read a constant 1.35 m.`
      : depthSignal === 'dry'
        ? ` Pressure sensor reads ~0 m (dry, no pressure on the tag).`
        : depthSignal === 'tidal'
          ? ` Depth varies day-to-day (medianDepth ${medianDepth!.toFixed(2)} m) — possibly tidal flooding rather than burial.`
          : '';

  if (medianAmp < LOW_AMPLITUDE) {
    if (sstDelta !== null && sstDelta < 2) {
      verdict = 'in_water';
      reasoning = `Diel amplitude only ${medianAmp.toFixed(1)} °C and mean (${medianTemp.toFixed(1)} °C) matches SST (${sources.sstTempC!.toFixed(1)} °C). Tag is in or just below the sea surface ${sourceNote}.`;
      confidence = 0.9;
    } else if (airDelta !== null && airDelta > 8) {
      verdict = 'insulated_indoor';
      reasoning = `Low diel amplitude (${medianAmp.toFixed(1)} °C) but mean (${medianTemp.toFixed(1)} °C) is ${airDelta.toFixed(1)} °C from ambient air — climate-controlled enclosure ${sourceNote}.${depthNote}`;
      confidence = 0.85;
    } else {
      verdict = 'buried_in_sand';
      const meanNote =
        airDelta !== null
          ? ` Mean (${medianTemp.toFixed(1)} °C) tracks local air (${sources.airTempC!.toFixed(1)} °C, Δ=${airDelta.toFixed(1)} °C).`
          : '';
      reasoning = `Diel amplitude only ${medianAmp.toFixed(1)} °C — in the 0.3–1.4 °C range published for sea turtle nest loggers at sand depth.${meanNote}${depthNote}${tadDryNote} ${sourceNote}.`;
      // Each independent corroborating signal raises confidence
      const corroborators =
        (depthSignal === 'sand_pressure' ? 1 : 0) +
        (tad && tad.bin1Pct > 95 ? 1 : 0);
      confidence = Math.min(0.98, 0.85 + 0.05 * corroborators);
    }
  } else if (medianAmp > HIGH_AMPLITUDE) {
    verdict = 'surface_exposed';
    reasoning = `Diel amplitude ${medianAmp.toFixed(1)} °C — surface-exposed under direct sun/shade cycles ${sourceNote}.${depthNote}${tadDryNote}`;
    confidence = 0.85;
  } else if (depthSignal === 'sand_pressure' || (tad && tad.bin1Pct > 95)) {
    // Temperature is ambiguous but depth or TAD strongly suggests burial — call it
    verdict = 'buried_in_sand';
    reasoning = `Diel temperature amplitude is ${medianAmp.toFixed(1)} °C (between thresholds), but${depthSignal === 'sand_pressure' ? ` depth sensor reads ${medianDepth!.toFixed(2)} m of constant pseudo-depth — sand pressure, matching a previously recovered buried tag that read a constant 1.35 m.` : ''}${tadDryNote} Likely buried ${sourceNote}.`;
    confidence = 0.8;
  } else {
    verdict = 'unknown';
    reasoning = `Diel amplitude ${medianAmp.toFixed(1)} °C — between sand-buried (<3 °C) and surface-exposed (>5 °C) thresholds. Ambiguous ${sourceNote}.${depthNote}${tadDryNote}`;
    confidence = 0.4;
  }

  return {
    verdict,
    reasoning,
    medianDielAmplitudeC: Number(medianAmp.toFixed(2)),
    medianTempC: Number(medianTemp.toFixed(2)),
    windowsAnalyzed: dayCount,
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
