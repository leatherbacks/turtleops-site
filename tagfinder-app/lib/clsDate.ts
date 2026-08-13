/**
 * Parse a CLS timestamp.
 *
 * CLS is not consistent about its own format. Across three exports from one
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
const CLS_TIMESTAMP =
  /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?/;

export function parseClsDate(value: string | undefined | null): Date {
  const s = (value ?? '').trim();
  if (!s) return new Date(NaN);
  const m = CLS_TIMESTAMP.exec(s);
  if (!m) return new Date(NaN);
  const [, y, mo, d, h, mi, sec] = m;
  return new Date(
    Date.UTC(+y, +mo - 1, +d, +h, +mi, sec === undefined ? 0 : +sec)
  );
}
