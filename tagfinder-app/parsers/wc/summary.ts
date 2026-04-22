import type { DeploySummary } from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse a Wildlife Computers Summary.csv into DeploySummary.
 * Takes the first row (one summary per deployment).
 */
export function parseSummary(rows: Record<string, string>[]): DeploySummary | null {
  if (rows.length === 0) return null;

  const row = rows[0];

  return {
    deployId: (row['DeployID'] || '').trim(),
    ptt: parseInt(row['Ptt'] || '0') || 0,
    instrument: (row['Instr'] || '').trim(),
    software: (row['SW'] || '').trim(),
    percentDecoded: parseFloat(row['PercentDecoded'] || '0') || 0,
    passes: parseInt(row['Passes'] || '0') || 0,
    releaseDate: parseWCDate(row['ReleaseDate'] || ''),
    releaseType: (row['ReleaseType'] || '').trim(),
    deployDate: parseWCDate(row['DeployDate'] || ''),
  };
}
