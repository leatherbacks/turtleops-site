import type { ArgosFix, ArgosPass } from '@/lib/types';
import { haversineKm } from '@/lib/haversine';
import { stoppedCluster } from './position';
import { getPositionFixes } from './quality';

/**
 * When did the tag stop?
 *
 * The sky view and the coverage rate were computed over every pass since the
 * first fix, at the final position. On PSAT+ 47128 that was 2,135 passes, 99%
 * of them while the tag floated up to 200 km from where it ended up, and the
 * verdict — "horizon obstructed all round, overhead clear" — described three
 * weeks in a weed mat. The panel sat beside a fix on the Ponte Vedra shoreline
 * and said nothing about the beach, which is the only place the sky now
 * matters. Worse, the window ended at the last fix, so the overhead passes the
 * tag missed after it went quiet were not counted at all; those misses are the
 * evidence.
 *
 * The record splits at the moment the tag stopped moving: the earliest fix
 * after which every later fix sits with the newest one. Before that is the
 * float and describes the float; from then on is the resting place and
 * describes the resting place. The two are reported separately, the resting
 * period first.
 */

/** Fixes this close to the newest one, after their errors, are the same place. */
export const RESTING_CLUSTER_KM = 1.5;
/** The fix before the cluster must be at least this far away for the split to mean anything. */
export const RESTING_BREAK_KM = 3;
/**
 * A live recovery: when the newest message is this recent, the resting window
 * runs to now so that silent overpasses count as missed. Older than this the
 * file is an archive and the window ends at the last message.
 */
export const LIVE_WINDOW_HOURS = 48;

function err(f: ArgosFix): number {
  return Number.isFinite(f.effectiveError) ? f.effectiveError : 0;
}

/**
 * The time of the first fix in the final stationary cluster, or null when the
 * record has no distinct resting period: fewer than two fixes in the cluster,
 * or nothing before it that is clearly somewhere else.
 *
 * The 3 km break is sound for a tag that jumped, and it misses the commonest
 * landing of all: a tag that drifts the last kilometre onto the beach. MiniPAT
 * 33938 came from 1.9 km off Melbourne Beach to the island, the break came out
 * at 2.1 km after errors, and every panel stayed on the whole record — reading
 * "antenna clear, 6.6 messages a pass" for a tag that had been sending 2.4 since
 * it landed. When the break test finds nothing, a cluster of fixes that has
 * agreed for STOPPED_MIN_HOURS (see stoppedSince) marks the moment it stopped.
 */
export function restingSince(fixes: ArgosFix[]): Date | null {
  return restingSinceByBreak(fixes) ?? stoppedSince(fixes);
}

/**
 * Fixes that agree within their errors for this long are a tag that has
 * stopped, whatever the 24-hour drift window says. That window straddled
 * 33938's landfall for a day, so the tag read ACTIVELY DRIFTING on the
 * morning after it came ashore, and the drift projection crossed the island
 * into the lagoon. At the 0.3 km/h it had been drifting, twelve hours is
 * 4 km, beyond the cluster tolerance of anything better than class A.
 */
export const STOPPED_MIN_HOURS = 12;

/** When a tag the drift window still calls drifting has in fact stopped, or null. */
export function stoppedSince(fixes: ArgosFix[]): Date | null {
  return clusterStart(fixes, STOPPED_MIN_HOURS);
}

function clusterStart(fixes: ArgosFix[], minHours: number): Date | null {
  const positions = getPositionFixes(fixes).filter((f) => !isNaN(f.date.getTime()));
  const cluster = stoppedCluster(positions);
  if (cluster.length < 2 || cluster.length === positions.length) return null;
  const spanH = (cluster[cluster.length - 1].date.getTime() - cluster[0].date.getTime()) / 3_600_000;
  return spanH >= minHours ? cluster[0].date : null;
}

function restingSinceByBreak(fixes: ArgosFix[]): Date | null {
  const dated = fixes
    .filter((f) => !f.isOutlier && !isNaN(f.date.getTime()))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  if (dated.length < 3) return null;
  const newest = dated[dated.length - 1];
  const sits = (f: ArgosFix) =>
    haversineKm(f.latitude, f.longitude, newest.latitude, newest.longitude) - (err(f) + err(newest)) / 1000 <=
    RESTING_CLUSTER_KM;
  let i = dated.length - 1;
  while (i > 0 && sits(dated[i - 1])) i--;
  const cluster = dated.slice(i);
  if (cluster.length < 2 || i === 0) return null;
  const before = dated[i - 1];
  const breakKm =
    haversineKm(before.latitude, before.longitude, newest.latitude, newest.longitude) - (err(before) + err(newest)) / 1000;
  if (breakKm < RESTING_BREAK_KM) return null;
  return cluster[0].date;
}

/** Where the sky window ends: now for a live file, the last message for an archive. */
export function skyWindowEnd(passes: ArgosPass[], now: Date = new Date()): Date | null {
  const dated = passes.filter((p) => !isNaN(p.date.getTime()));
  if (dated.length === 0) return null;
  const last = dated.reduce((a, b) => (a.date > b.date ? a : b)).date;
  const ageH = (now.getTime() - last.getTime()) / 3_600_000;
  return ageH <= LIVE_WINDOW_HOURS && ageH >= 0 ? now : last;
}
