import type { DailySummary } from '@/lib/types';

/**
 * Parse Wildlife Computers DailyData.csv.
 *
 * Headers: Ptt,Instr,Date,MinTemp,MaxTemp,MinDepth,MaxDepth,
 *          MaxDeltaTilt,AvgMinMaxTilt,DeltaLight
 *
 * Date format here is M/D/YYYY (US-format), unlike most other WC files
 * which use HH:MM:SS DD-Mon-YYYY. We parse it as midnight UTC of that day.
 */
export function parseDailyData(rows: Record<string, string>[]): DailySummary[] {
  const summaries: DailySummary[] = [];

  for (const row of rows) {
    const dateStr = (row['Date'] || '').trim();
    const date = parseUSDate(dateStr);
    if (!date) continue;

    summaries.push({
      date,
      minTemp: parseNumOrNull(row['MinTemp']),
      maxTemp: parseNumOrNull(row['MaxTemp']),
      minDepth: parseNumOrNull(row['MinDepth']),
      maxDepth: parseNumOrNull(row['MaxDepth']),
      deltaLight: parseNumOrNull(row['DeltaLight']),
    });
  }

  return summaries.sort((a, b) => a.date.getTime() - b.date.getTime());
}

/** Parse "M/D/YYYY" or "MM/DD/YYYY" as midnight UTC. */
function parseUSDate(s: string): Date | null {
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(Date.UTC(year, month - 1, day));
}

function parseNumOrNull(s: string | undefined): number | null {
  if (s === undefined || s === null || s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
