import { parseWCDate } from './dates';

/**
 * Message times from a Wildlife Computers RawArgos.csv, one row per message.
 *
 * The transmission interval is measured from these (analysis/repetitionRate),
 * and Argos.csv only carries per-pass summaries. Without this file a WC tag
 * had no measured interval: 33938's reports never said it transmits every
 * 60 s, which is the number a receiver sweep is planned around. Rows repeat
 * when one message is heard twice; the estimator discards sub-second repeats.
 */
export function parseWCRawArgosTimes(rows: Record<string, string>[]): { date: Date; satellite: string }[] {
  const out: { date: Date; satellite: string }[] = [];
  for (const r of rows) {
    const date = parseWCDate(`${(r['MsgTime'] || '').trim()} ${(r['MsgDate'] || '').trim()}`);
    if (!date) continue;
    out.push({ date, satellite: (r['Satellite'] || '').trim() || 'unknown' });
  }
  return out.sort((a, b) => a.date.getTime() - b.date.getTime());
}
