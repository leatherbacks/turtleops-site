import type { DeploySummary } from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse a Wildlife Computers Summary.csv into DeploySummary.
 * Takes the first row (one summary per deployment).
 */
export function parseSummary(rows: Record<string, string>[]): DeploySummary | null {
  if (rows.length === 0) return null;

  const row = rows[0];
  const releaseDate = parseWCDate(row['ReleaseDate'] || '');
  const earliestXmit = parseWCDate(row['EarliestXmitTime'] || '');
  const latestData = parseWCDate(row['LatestDataTime'] || '');

  // Only worth inferring when the manufacturer left the field blank, and only
  // when transmission clearly postdates the archive. A tag still on the animal
  // has no reception after its last sample, so the ordering is the evidence
  // that it came off — not evidence of when. See inferredReleaseDate.
  const inferredReleaseDate =
    !releaseDate && earliestXmit && latestData && earliestXmit > latestData
      ? latestData
      : null;

  return {
    deployId: (row['DeployID'] || '').trim(),
    ptt: parseInt(row['Ptt'] || '0') || 0,
    instrument: (row['Instr'] || '').trim(),
    software: (row['SW'] || '').trim(),
    percentDecoded: parseFloat(row['PercentDecoded'] || '0') || 0,
    passes: parseInt(row['Passes'] || '0') || 0,
    releaseDate,
    releaseType: (row['ReleaseType'] || '').trim(),
    deployDate: parseWCDate(row['DeployDate'] || ''),
    earliestXmit,
    latestData,
    inferredReleaseDate,
  };
}
