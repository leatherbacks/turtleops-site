import type { DailyDiveSummary } from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse a Wildlife Computers MinMaxDepth.csv into DailyDiveSummary[].
 * Per WC spec: readings approximately 6 hours apart or at summary bin interval.
 */
export function parseMinMaxDepth(rows: Record<string, string>[]): DailyDiveSummary[] {
  const summaries: DailyDiveSummary[] = [];

  for (const row of rows) {
    const date = parseWCDate(row['Date'] || '');
    if (!date) continue;

    const minDepth = parseFloat(row['MinDepth'] || '');
    const maxDepth = parseFloat(row['MaxDepth'] || '');
    if (isNaN(minDepth) && isNaN(maxDepth)) continue;

    summaries.push({
      date,
      minDepth: isNaN(minDepth) ? 0 : minDepth,
      maxDepth: isNaN(maxDepth) ? 0 : maxDepth,
      minAccuracy: parseFloat(row['MinAccuracy'] || '0') || 0,
      maxAccuracy: parseFloat(row['MaxAccuracy'] || '0') || 0,
    });
  }

  return summaries.sort((a, b) => a.date.getTime() - b.date.getTime());
}
