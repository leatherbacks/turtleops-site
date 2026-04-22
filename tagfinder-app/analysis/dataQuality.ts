import type { ArgosPass, DataQuality } from '@/lib/types';

/**
 * Compute data quality metrics from Argos.csv per-pass stats.
 */
export function analyzeDataQuality(passes: ArgosPass[]): DataQuality {
  if (passes.length === 0) {
    return {
      totalPasses: 0,
      totalMessages: 0,
      totalDuplicates: 0,
      totalCorrupt: 0,
      corruptPct: 0,
      avgMsgPerPass: 0,
      firstPass: null,
      lastPass: null,
      nominalFrequencyMHz: null,
    };
  }

  let totalMessages = 0;
  let totalDuplicates = 0;
  let totalCorrupt = 0;

  for (const pass of passes) {
    totalMessages += pass.msgCount;
    totalDuplicates += pass.duplicates;
    totalCorrupt += pass.corrupt;
  }

  const corruptPct =
    totalMessages > 0 ? (totalCorrupt / totalMessages) * 100 : 0;
  const avgMsgPerPass = totalMessages / passes.length;

  const sorted = [...passes].sort((a, b) => a.date.getTime() - b.date.getTime());

  // Median transmit frequency — cancels Doppler shift across passes from
  // different satellites. Argos samples are in Hz; convert to MHz.
  const freqsHz = passes
    .map((p) => p.frequencyHz)
    .filter((f): f is number => f !== null && f > 0);
  let nominalFrequencyMHz: number | null = null;
  if (freqsHz.length > 0) {
    const sortedFreqs = [...freqsHz].sort((a, b) => a - b);
    const mid = Math.floor(sortedFreqs.length / 2);
    const medianHz =
      sortedFreqs.length % 2 === 0
        ? (sortedFreqs[mid - 1] + sortedFreqs[mid]) / 2
        : sortedFreqs[mid];
    nominalFrequencyMHz = medianHz / 1_000_000;
  }

  return {
    totalPasses: passes.length,
    totalMessages,
    totalDuplicates,
    totalCorrupt,
    corruptPct,
    avgMsgPerPass,
    firstPass: sorted[0].date,
    lastPass: sorted[sorted.length - 1].date,
    nominalFrequencyMHz,
  };
}
