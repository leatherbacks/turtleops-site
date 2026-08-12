import type {
  ArgosPass,
  DeploySummary,
  TransmissionHealth,
  TransmissionHealthWindow,
  TransmissionTrend,
} from '@/lib/types';

const ARGOS_NOMINAL_HZ = 401_650_000; // 401.650 MHz — Argos downlink center

/**
 * Diagnose whether the tag's transmission quality is degrading over the
 * post-release window. Three independent signals are tracked:
 *
 *   1. CRC failure rate — rises when signal is weak or the tag's transmitter
 *      is drifting off-spec. Pure antenna-obstruction failures still produce
 *      *heard* passes but with CRC errors.
 *   2. Received power — weakens as the tag's environment absorbs more signal
 *      (buried deeper, covered, inside a conductive enclosure).
 *   3. Frequency offset from 401.650 MHz — rises as the tag heats up. Thermal
 *      drift is roughly linear with temperature.
 *
 * Combining all three lets us distinguish "tag in trouble" (rising corruption +
 * falling power + rising Δfreq) from "tag fine, pass geometry was just bad."
 */
export function analyzeTransmissionHealth(
  passes: ArgosPass[],
  summary: DeploySummary | null
): TransmissionHealth | null {
  if (passes.length === 0) return null;

  const releaseTime = summary?.releaseDate?.getTime() ?? null;
  const postRelease = releaseTime
    ? passes.filter((p) => p.date.getTime() >= releaseTime)
    : passes;

  if (postRelease.length < 3) {
    return {
      trend: 'insufficient',
      reasoning: `Only ${postRelease.length} post-release pass${postRelease.length === 1 ? '' : 'es'} — need at least 3 to compute a trend.`,
      windows: [],
      overallCorruptPct: null,
      corruptPctSlopePerDay: 0,
      powerSlopePerDayDbm: null,
      frequencySlopePerDayHz: null,
    };
  }

  // Bucket passes into rolling windows. Use at most 8 windows across the
  // post-release span so the sparkline stays readable; fall back to per-pass
  // when the span is tight.
  const windows = bucketIntoWindows(postRelease, 8);

  // Which degradation signals this source actually reports.
  const hasCrcData = postRelease.some((p) => p.corrupt !== null);
  const hasPowerData = postRelease.some((p) => p.powerDbm !== null);

  // Aggregate totals
  let totalMsgs = 0;
  let totalCorrupt = 0;
  for (const p of postRelease) {
    totalMsgs += p.msgCount;
    if (p.corrupt !== null) totalCorrupt += p.corrupt;
  }
  const overallCorruptPct =
    hasCrcData && totalMsgs > 0 ? (totalCorrupt / totalMsgs) * 100 : null;

  // Compute slopes via simple linear regression on the window centers
  const corruptSlope = linearSlope(
    windows.map((w) => w.date.getTime() / 86_400_000), // days since epoch
    windows.map((w) => w.corruptPct)
  );

  const powerWindows = windows.filter((w) => w.meanPowerDbm !== null);
  const powerSlope =
    powerWindows.length >= 2
      ? linearSlope(
          powerWindows.map((w) => w.date.getTime() / 86_400_000),
          powerWindows.map((w) => w.meanPowerDbm as number)
        )
      : null;

  const freqWindows = windows.filter((w) => w.meanFrequencyOffsetHz !== null);
  const freqSlope =
    freqWindows.length >= 2
      ? linearSlope(
          freqWindows.map((w) => w.date.getTime() / 86_400_000),
          freqWindows.map((w) => w.meanFrequencyOffsetHz as number)
        )
      : null;

  // Classification
  // - 'failing': corrupt rate > 80% OR (rising CRC AND falling power AND large freq drift)
  // - 'degrading': clear rising CRC (>5%/day) OR notable power decay (<-2 dBm/day)
  // - 'stable': no concerning trend
  let trend: TransmissionTrend;
  const reasons: string[] = [];

  if (overallCorruptPct !== null && overallCorruptPct > 80) {
    trend = 'failing';
    reasons.push(
      `${overallCorruptPct!.toFixed(0)}% of post-release messages failed CRC — the tag is heard but almost nothing decodes.`
    );
  } else if (
    corruptSlope > 5 &&
    (powerSlope ?? 0) < -1 &&
    Math.abs(freqSlope ?? 0) > 100
  ) {
    trend = 'failing';
    reasons.push(
      `All three signals worsening together: CRC rate +${corruptSlope.toFixed(1)}%/day, power ${powerSlope!.toFixed(2)} dBm/day, frequency drift ${freqSlope! > 0 ? '+' : ''}${freqSlope!.toFixed(0)} Hz/day.`
    );
  } else if (corruptSlope > 5 || (powerSlope !== null && powerSlope < -2)) {
    trend = 'degrading';
    if (corruptSlope > 5) {
      reasons.push(`CRC rate climbing at +${corruptSlope.toFixed(1)}%/day.`);
    }
    if (powerSlope !== null && powerSlope < -2) {
      reasons.push(`Signal weakening ${powerSlope.toFixed(2)} dBm/day.`);
    }
  } else {
    trend = 'stable';
    // Only claim a clean bill of health for signals this source actually
    // reports. The Argos DS dump carries neither CRC counts nor received
    // power, and saying "CRC 0%" for absent data reads as perfect rather than
    // unmeasured.
    const measured: string[] = [];
    if (hasCrcData && overallCorruptPct !== null)
      measured.push(`CRC ${overallCorruptPct.toFixed(0)}%`);
    if (hasPowerData) measured.push('power');
    if (freqSlope !== null) measured.push('frequency');

    const missing: string[] = [];
    if (!hasCrcData) missing.push('CRC');
    if (!hasPowerData) missing.push('received power');

    reasons.push(
      measured.length > 0
        ? `No significant degradation trend across ${measured.join(', ')}.`
        : 'No degradation signals are reported by this data source.'
    );
    if (missing.length > 0) {
      reasons.push(
        `${missing.join(' and ')} ${missing.length === 1 ? 'is' : 'are'} not reported in this format, ` +
          `so ${missing.length === 1 ? 'it was' : 'they were'} not assessed.`
      );
    }
  }

  if (freqSlope !== null && Math.abs(freqSlope) > 200 && trend !== 'failing') {
    reasons.push(
      `Frequency drift ${freqSlope > 0 ? '+' : ''}${freqSlope.toFixed(0)} Hz/day suggests rising tag temperature.`
    );
  }

  return {
    trend,
    reasoning: reasons.join(' '),
    windows,
    overallCorruptPct,
    corruptPctSlopePerDay: corruptSlope,
    powerSlopePerDayDbm: powerSlope,
    frequencySlopePerDayHz: freqSlope,
  };
}

function bucketIntoWindows(
  passes: ArgosPass[],
  targetBuckets: number
): TransmissionHealthWindow[] {
  // Only passes that can be placed on a timeline can be bucketed. Sort rather
  // than assume order: an out-of-order or undated pass produced a negative or
  // NaN index below, and buckets[NaN] is undefined.
  const dated = passes
    .filter((p) => !isNaN(p.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (dated.length === 0) return [];

  // If we have few passes, each pass is its own window
  const n = Math.min(targetBuckets, dated.length);
  const firstTs = dated[0].date.getTime();
  const lastTs = dated[dated.length - 1].date.getTime();
  const span = Math.max(1, lastTs - firstTs);
  const step = span / n;

  const buckets: ArgosPass[][] = Array.from({ length: n }, () => []);
  for (const p of dated) {
    const raw = Math.floor((p.date.getTime() - firstTs) / step);
    const idx = Number.isFinite(raw) ? Math.max(0, Math.min(n - 1, raw)) : 0;
    buckets[idx].push(p);
  }

  return buckets
    .filter((b) => b.length > 0)
    .map((b): TransmissionHealthWindow => {
      const midTs = b.reduce((s, p) => s + p.date.getTime(), 0) / b.length;
      let totalMsgs = 0;
      let corruptMsgs = 0;
      const powers: number[] = [];
      const offsets: number[] = [];
      for (const p of b) {
        totalMsgs += p.msgCount;
        if (p.corrupt !== null) corruptMsgs += p.corrupt;
        if (p.powerDbm !== null) powers.push(p.powerDbm);
        if (p.frequencyHz !== null) offsets.push(p.frequencyHz - ARGOS_NOMINAL_HZ);
      }
      return {
        date: new Date(midTs),
        totalMessages: totalMsgs,
        corruptMessages: corruptMsgs,
        corruptPct: totalMsgs > 0 ? (corruptMsgs / totalMsgs) * 100 : 0,
        meanPowerDbm:
          powers.length > 0 ? powers.reduce((s, v) => s + v, 0) / powers.length : null,
        meanFrequencyOffsetHz:
          offsets.length > 0
            ? offsets.reduce((s, v) => s + v, 0) / offsets.length
            : null,
      };
    });
}

/** Ordinary least-squares slope of y on x. Returns 0 if degenerate. */
function linearSlope(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - meanX) * (y[i] - meanY);
    den += (x[i] - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}
