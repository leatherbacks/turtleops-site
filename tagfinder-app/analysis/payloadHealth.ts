import type { PayloadHealth } from '@/lib/types';

/**
 * Is the tag's sensor stream still readable?
 *
 * A CLS export reports no CRC of its own, so the Data Quality and Transmission
 * Health panels say "corrupted: not reported" and a reader assumes the sensor
 * data is fine. On PSAT+ 47128 it was not: from about 17:00 UTC on 3 Oct every
 * dive payload failed its checksum — bytes 2–30 random, only the type byte and
 * the top byte of the clock surviving — while the Doppler fixes carried on
 * every twenty minutes at full signal. Nothing on the page said so. The last
 * post-release temperature was eight days old by the time the tag beached, and
 * three panels were still presenting it as the tag's present environment.
 *
 * The dive payloads' own checksums are the measurement. Per reception day,
 * what share passed; from that, the last day the stream was readable and the
 * first day it was not. Readable means a quarter or more pass (this tag ran
 * 50–60% when healthy, because the second block has no check and half the
 * messages are the block-2-only kind); unreadable means under 5% over enough
 * messages that chance cannot explain it.
 */

const READABLE_MIN_RATE = 0.25;
const UNREADABLE_MAX_RATE = 0.05;
/** Days with fewer messages than this do not move the verdict either way. */
const MIN_MESSAGES_PER_DAY = 20;

export function analyzePayloadHealth(
  daily: Record<string, { passed: number; failed: number; clockRejected: number }>
): PayloadHealth | null {
  const days = Object.keys(daily).sort();
  if (days.length === 0) return null;

  let passed = 0, failed = 0, clockRejected = 0;
  const rated: { day: string; n: number; rate: number }[] = [];
  for (const day of days) {
    const d = daily[day];
    passed += d.passed; failed += d.failed; clockRejected += d.clockRejected;
    const n = d.passed + d.failed + d.clockRejected;
    rated.push({ day, n, rate: n ? d.passed / n : 0 });
  }
  const total = passed + failed + clockRejected;
  if (total === 0) return null;

  const judged = rated.filter((r) => r.n >= MIN_MESSAGES_PER_DAY);
  const lastReadable = [...judged].reverse().find((r) => r.rate >= READABLE_MIN_RATE) ?? null;
  // Unreadable since: the first judged day after the last readable one on
  // which the rate fell below the floor, provided it has stayed there since.
  let unreadableSince: string | null = null;
  if (lastReadable) {
    const after = judged.filter((r) => r.day > lastReadable.day);
    if (after.length > 0 && after.every((r) => r.rate < UNREADABLE_MAX_RATE)) unreadableSince = after[0].day;
  } else if (judged.length > 0 && judged.every((r) => r.rate < UNREADABLE_MAX_RATE)) {
    unreadableSince = judged[0].day;
  }

  const overall = passed / total;
  const recent = judged.slice(-3);
  const recentRate = recent.length
    ? recent.reduce((s, r) => s + r.rate * r.n, 0) / recent.reduce((s, r) => s + r.n, 0)
    : overall;

  let verdict: PayloadHealth['verdict'];
  if (unreadableSince) verdict = 'unreadable';
  else if (recentRate >= READABLE_MIN_RATE) verdict = 'readable';
  else verdict = 'degraded';

  const pct = (x: number) => `${(100 * x).toFixed(x < 0.01 && x > 0 ? 1 : 0)}%`;
  let reasoning: string;
  if (verdict === 'unreadable') {
    const before = judged.filter((r) => r.day <= (lastReadable?.day ?? ''));
    const beforeRate = before.length
      ? before.reduce((s, r) => s + r.rate * r.n, 0) / before.reduce((s, r) => s + r.n, 0)
      : overall;
    const since = judged.filter((r) => r.day >= unreadableSince!);
    const sinceN = since.reduce((s, r) => s + r.n, 0);
    reasoning =
      `The sensor stream has been unreadable since ${unreadableSince}: ${pct(recentRate)} of dive payloads ` +
      `pass their checksum against ${pct(beforeRate)} through ${lastReadable?.day ?? 'the start'}. ` +
      `${sinceN.toLocaleString()} messages since then carry a valid header and random contents` +
      `${clockRejected ? `, and ${clockRejected} passed the checksum by chance with impossible clocks and were dropped` : ''}. ` +
      `The Doppler positions are unaffected — they come from the carrier, not the payload — but no temperature or depth ` +
      `reading newer than ${lastReadable?.day ?? 'the start'} exists, and nothing on this page should describe the tag's ` +
      `present environment from its sensors.`;
  } else if (verdict === 'degraded') {
    reasoning =
      `Only ${pct(recentRate)} of recent dive payloads pass their checksum, against ${pct(overall)} overall. ` +
      `Sensor readings from the last few days are thin and should be weighed accordingly.`;
  } else {
    reasoning =
      `${pct(recentRate)} of recent dive payloads pass their checksum (${pct(overall)} over the record), ` +
      `the normal rate for a tag whose second block carries no check. The sensor stream is readable.`;
  }

  return {
    verdict,
    reasoning,
    messages: total,
    passed,
    failed,
    clockRejected,
    overallPassRate: Number(overall.toFixed(3)),
    recentPassRate: Number(recentRate.toFixed(3)),
    lastReadableDay: lastReadable?.day ?? null,
    unreadableSince,
    daily: rated.map((r) => ({ day: r.day, messages: r.n, passRate: Number(r.rate.toFixed(3)) })),
  };
}
