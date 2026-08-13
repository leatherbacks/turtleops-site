/**
 * Parse a space-or-T separated calendar timestamp, strictly.
 *
 * Used for both CLS exports and NOAA CO-OPS responses, which happen to emit
 * the same shape. The strictness is the point, and it is not what `new Date`
 * gives you: V8 falls back to a lenient parser that accepts `'GARBAGE:00Z'`
 * and returns 2000-01-01T00:00:00Z. That is finite, sorts, formats, and plots
 * — a `Number.isFinite` screen does not catch it, and a Y2K-dated tide event
 * lands in the "past" bucket and drives the rising/falling determination. So
 * the shape is matched explicitly here rather than delegated.
 *
 * CLS is also not consistent about its own format. Across three exports from one
 * programme the same column appeared as:
 *
 *   2026-08-11 14:20:54     seconds present, hour zero-padded
 *   2026-07-31 17:29        no seconds
 *   2026-07-23 8:35         no seconds AND no leading zero on the hour
 *
 * The last of those is the dangerous one. `new Date('2026-07-23T8:35Z')` returns
 * Invalid Date rather than throwing, so a naive parse yields NaN and the record
 * is silently dropped or, worse, sorted to the epoch. On one deployment that hit
 * 36% of the decoded health records — the sensor readings that say whether a tag
 * is in the water — and nothing anywhere reported a problem.
 *
 * Returns an Invalid Date for genuinely unparseable input so callers can screen
 * it, rather than substituting a plausible-looking wrong time.
 */
const TIMESTAMP =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/;

export function parseTimestamp(value: string | undefined | null): Date {
  const s = (value ?? '').trim();
  if (!s) return new Date(NaN);
  const m = TIMESTAMP.exec(s);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h, mi, sec] = m;
  const [Y, Mo, D, H, Mi, S] = [+y, +mo, +d, +h, +mi, sec === undefined ? 0 : +sec];

  const t = Date.UTC(Y, Mo - 1, D, H, Mi, S);
  const out = new Date(t);

  // Date.UTC rolls out-of-range components over instead of rejecting them:
  // month 13 becomes January of the next year, hour 99 becomes four days on.
  // '2026-13-45 99:99' would otherwise return a perfectly ordinary-looking
  // 2027-02-18 — the same silent-plausible-wrong-answer failure this function
  // exists to prevent, just arriving by a different route. Reading the fields
  // back off the result rejects anything that rolled, including 31 April and
  // 29 February in a common year, without a calendar table.
  if (
    out.getUTCFullYear() !== Y ||
    out.getUTCMonth() !== Mo - 1 ||
    out.getUTCDate() !== D ||
    out.getUTCHours() !== H ||
    out.getUTCMinutes() !== Mi ||
    out.getUTCSeconds() !== S
  ) {
    return new Date(NaN);
  }
  return out;
}
