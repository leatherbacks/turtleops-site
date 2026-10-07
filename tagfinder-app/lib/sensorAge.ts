import type { ArgosFix, SeriesReading, TagStatus } from '@/lib/types';

/**
 * How old is the newest sensor reading, measured against the newest fix?
 *
 * The temperature panels — environment, burial signature, tag-versus-water —
 * each compare the tag's readings with the water and air and deliver a
 * present-tense verdict. They never asked when the readings were taken. On
 * PSAT+ 47128 the last post-release temperature was 29 Sep; the tag then
 * drifted for a week, was driven ashore by a northeaster on 7 Oct, and all
 * three panels still read IN WATER beside a fix on the Ponte Vedra shoreline,
 * and the brief leaned on them to recommend a boat. The readings were right
 * about 29 Sep. Nothing on the page said that was the date they described.
 *
 * A reading older than the newest fix by more than a day describes the tag
 * then, not now. The panels keep their verdict and gain the date; the brief is
 * told the age in its verdicts block and not to speak of the sensors in the
 * present tense.
 */

/** Readings older than this, relative to the newest fix, are stale. */
export const SENSOR_STALE_HOURS = 24;

export interface SensorDataAge {
  /** Newest post-release sensor reading. */
  asOf: Date;
  /** Newest fix the readings are being compared against. */
  lastFix: Date;
  hoursBeforeLastFix: number;
  stale: boolean;
}

export function sensorDataAge(
  series: SeriesReading[],
  statuses: TagStatus[],
  releaseDate: Date | null | undefined,
  fixes: ArgosFix[]
): SensorDataAge | null {
  const release = releaseDate?.getTime() ?? -Infinity;
  const times: number[] = [];
  for (const s of series) if (s.temperature !== null) times.push(s.date.getTime());
  for (const s of statuses) if (s.temperature !== null) times.push(s.date.getTime());
  const post = times.filter((t) => !isNaN(t) && t >= release);
  if (post.length === 0) return null;
  const dated = fixes.filter((f) => !f.isOutlier && !isNaN(f.date.getTime()));
  if (dated.length === 0) return null;
  const asOf = new Date(Math.max(...post));
  const lastFix = dated.reduce((a, b) => (a.date > b.date ? a : b)).date;
  const hoursBeforeLastFix = (lastFix.getTime() - asOf.getTime()) / 3_600_000;
  return { asOf, lastFix, hoursBeforeLastFix, stale: hoursBeforeLastFix > SENSOR_STALE_HOURS };
}

/** Attach the age to a sensor-based verdict when it is stale; otherwise return it unchanged. */
export function qualifyForAge<T extends { reasoning: string }>(
  verdict: T,
  age: SensorDataAge | null
): T & { asOf?: Date; staleHours?: number } {
  if (!age || !age.stale) return verdict;
  return { ...verdict, asOf: age.asOf, staleHours: Math.round(age.hoursBeforeLastFix) };
}

/** One sentence for a panel or the brief: when the readings stop and how far behind the fixes that is. */
export function describeSensorAge(age: SensorDataAge): string {
  const days = age.hoursBeforeLastFix / 24;
  const when = age.asOf.toISOString().slice(0, 16).replace('T', ' ');
  const behind = days >= 2 ? `${days.toFixed(1)} days` : `${Math.round(age.hoursBeforeLastFix)} hours`;
  return `Newest sensor reading ${when} UTC, ${behind} before the newest fix. This describes the tag then, not now.`;
}
