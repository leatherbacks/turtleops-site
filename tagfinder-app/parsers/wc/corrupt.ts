import type { CorruptMessage } from '@/lib/types';
import { parseWCDate } from './dates';

/**
 * Parse a Wildlife Computers Corrupt.csv into CorruptMessage[].
 * Each row represents a rejected message.
 */
export function parseCorrupt(rows: Record<string, string>[]): CorruptMessage[] {
  const messages: CorruptMessage[] = [];

  for (const row of rows) {
    const date = parseWCDate(row['Date'] || '');
    if (!date) continue;

    messages.push({
      date,
      reason: (row['Reason'] || '').trim(),
      possibleType: (row['Possible Type'] || '').trim(),
    });
  }

  return messages.sort((a, b) => a.date.getTime() - b.date.getTime());
}
