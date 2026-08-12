/**
 * Lotek timestamp handling.
 *
 * Lotek's exporter does not emit one stable format. The files from a reference PSAT+ deployment
 * use "HH:MM:SS DD/MM/YY" (Dive Log) and "DD/MM/YY" (Day Log), while the
 * RchivalTag R package documents Lotek PSAT dive logs as "MM/DD/YYYY HH:MM:SS"
 * — a different field order AND a different year width. So the order has to be
 * resolved from the data, never assumed.
 *
 * A file is only unambiguous if some row carries a day-of-month above 12.
 * When every row could be read either way we refuse rather than guess: a track
 * silently transposed by months is far worse than a file that won't load.
 */

export type DateOrder = 'dmy' | 'mdy';

export interface DateOrderResult {
  order: DateOrder | null;
  /** Human-readable explanation, shown to the user when order is null. */
  reason: string;
}

/** Pull the DD/MM/YY(YY) portion out of either "d/m/y" or "HH:MM:SS d/m/y". */
const DATE_RE = /(\d{1,2})\/(\d{1,2})\/(\d{2,4})/;

/**
 * Decide field order from a set of raw timestamp strings.
 * Both fields > 12 somewhere = contradictory file; neither = ambiguous.
 */
export function resolveDateOrder(samples: string[]): DateOrderResult {
  let firstOver12 = 0;
  let secondOver12 = 0;
  let parsed = 0;

  for (const s of samples) {
    const m = DATE_RE.exec(s || '');
    if (!m) continue;
    parsed++;
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a > 12) firstOver12++;
    if (b > 12) secondOver12++;
  }

  if (parsed === 0) {
    return { order: null, reason: 'No recognisable dates found in the file.' };
  }
  if (firstOver12 > 0 && secondOver12 > 0) {
    return {
      order: null,
      reason:
        `Contradictory dates: ${firstOver12} rows have a first field above 12 and ` +
        `${secondOver12} rows have a second field above 12. The file cannot be ` +
        `read as either DD/MM or MM/DD.`,
    };
  }
  if (firstOver12 > 0) {
    return { order: 'dmy', reason: `Day-first (DD/MM), proven by ${firstOver12} rows with day > 12.` };
  }
  if (secondOver12 > 0) {
    return { order: 'mdy', reason: `Month-first (MM/DD), proven by ${secondOver12} rows with day > 12.` };
  }
  return {
    order: null,
    reason:
      'Date order is ambiguous — every date in this file falls on the 1st to 12th, ' +
      'so DD/MM and MM/DD are indistinguishable. Confirm the export format with Lotek.',
  };
}

/** Two-digit years: Lotek tags postdate 2000 by a wide margin. */
function fullYear(y: number): number {
  if (y >= 1000) return y;
  return y < 70 ? 2000 + y : 1900 + y;
}

/**
 * Parse a Lotek timestamp into a UTC Date.
 * Accepts "DD/MM/YY", "HH:MM:SS DD/MM/YY" and "DD/MM/YYYY HH:MM:SS".
 * Returns null on anything it does not fully recognise.
 */
export function parseLotekDate(raw: string, order: DateOrder): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  const dm = DATE_RE.exec(s);
  if (!dm) return null;

  const a = parseInt(dm[1], 10);
  const b = parseInt(dm[2], 10);
  const year = fullYear(parseInt(dm[3], 10));
  const day = order === 'dmy' ? a : b;
  const month = order === 'dmy' ? b : a;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let hh = 0;
  let mm = 0;
  let ss = 0;
  const tm = /(\d{1,2}):(\d{2}):(\d{2})/.exec(s);
  if (tm) {
    hh = parseInt(tm[1], 10);
    mm = parseInt(tm[2], 10);
    ss = parseInt(tm[3], 10);
    if (hh > 23 || mm > 59 || ss > 59) return null;
  }

  const d = new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
  // Reject rollover (e.g. 31/02 becoming 3 March)
  if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}
