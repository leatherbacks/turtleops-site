import type {
  HistogramKind,
  HistogramReading,
  HistogramSet,
} from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse Wildlife Computers Histos.csv into a HistogramSet.
 *
 * Histos.csv contains four row types, distinguished by the HistType column:
 *   - TATLIMITS  → bin edges (°C) for TAT histograms
 *   - TADLIMITS  → bin edges (meters) for TAD histograms
 *   - TAT        → per-day Time-At-Temperature counts
 *   - TAD        → per-day Time-At-Depth counts
 *
 * Bin counts live in Bin1..BinN columns. The number of bins is determined
 * by reading the LIMITS row (count of non-empty Bin* values).
 */
export function parseHistos(rows: Record<string, string>[]): HistogramSet {
  let tatBinEdges: number[] = [];
  let tadBinEdges: number[] = [];
  const tat: HistogramReading[] = [];
  const tad: HistogramReading[] = [];

  for (const row of rows) {
    const histType = (row['HistType'] || '').trim();
    const bins = readBinColumns(row);

    if (histType === 'TATLIMITS') {
      tatBinEdges = bins;
    } else if (histType === 'TADLIMITS') {
      tadBinEdges = bins;
    } else if (histType === 'TAT' || histType === 'TAD') {
      const date = parseWCDate(row['Date'] || '');
      if (!date) continue;
      const reading: HistogramReading = {
        date,
        kind: histType as HistogramKind,
        counts: bins,
      };
      if (histType === 'TAT') tat.push(reading);
      else tad.push(reading);
    }
  }

  // Sort by date for downstream consumers
  tat.sort((a, b) => a.date.getTime() - b.date.getTime());
  tad.sort((a, b) => a.date.getTime() - b.date.getTime());

  return { tatBinEdges, tadBinEdges, tat, tad };
}

/** Pull all non-empty Bin1, Bin2, ... values out of a row, in order. */
function readBinColumns(row: Record<string, string>): number[] {
  const result: number[] = [];
  for (let i = 1; i <= 72; i++) {
    const raw = row[`Bin${i}`];
    if (raw === undefined || raw === '') break; // first empty = end of bins
    const n = parseFloat(raw);
    if (isNaN(n)) break;
    result.push(n);
  }
  return result;
}
