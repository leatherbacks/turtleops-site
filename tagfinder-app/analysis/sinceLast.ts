import { haversineKm, bearing } from '@/lib/haversine';

/**
 * What changed since the user last analysed this tag.
 *
 * On MiniPAT 33938 at Melbourne Beach each new export answered one question —
 * still there? moved? anything new at all? — and that was read by hand against
 * the previous export. A Wildlife Computers export is cumulative, so the new
 * upload already holds the whole record; all that is needed from last time is
 * what was seen and concluded then. That is the row kept in tag_last_seen
 * (supabase/tag_last_seen.sql): a few timestamps and the position, never the
 * files.
 *
 * Lotek and CLS downloads are not cumulative: each covers a window. A file
 * that starts later than the record seen before is flagged so the user adds
 * the earlier downloads; the position comparison still works without them.
 */

/** The row kept per user and PTT, as the API returns it. */
export interface LastSeen {
  ptt: number;
  releaseAt: string | null;
  firstDataAt: string | null;
  lastFixAt: string | null;
  lastMessageAt: string | null;
  fixCount: number | null;
  bestLat: number | null;
  bestLon: number | null;
  radiusM: number | null;
  analyzedAt: string;
}

export interface SinceLastInput {
  releaseAt: Date | null;
  fixes: { date: Date; latitude: number; longitude: number }[];
  newestMessage: Date | null;
  bestLat: number;
  bestLon: number;
}

export type SinceItemKind = 'moved' | 'steady' | 'new_data' | 'nothing_new' | 'older_file' | 'partial_file';

export interface SinceItem {
  kind: SinceItemKind;
  text: string;
}

export interface SinceLast {
  previousAnalysisAt: Date;
  items: SinceItem[];
}

/** Below this the position is noise: Argos class 3 is good to a few hundred metres. */
const MIN_MOVE_M = 300;
/** Release dates further apart than this are a different deployment of the PTT. */
const SAME_DEPLOYMENT_MS = 86_400_000;
const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

const fmt = (d: Date) =>
  `${d.getUTCDate()} ${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ` +
  `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`;
const dist = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`);
const date = (s: string | null) => {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
};

export function sinceLast(prev: LastSeen | null, cur: SinceLastInput): SinceLast | null {
  if (!prev) return null;
  const prevRelease = date(prev.releaseAt);
  if (prevRelease && cur.releaseAt && Math.abs(prevRelease.getTime() - cur.releaseAt.getTime()) > SAME_DEPLOYMENT_MS) return null;

  const items: SinceItem[] = [];
  const prevLastFix = date(prev.lastFixAt);
  const prevLastMsg = date(prev.lastMessageAt);
  const prevFirst = date(prev.firstDataAt);
  const fixTimes = cur.fixes.map((f) => f.date.getTime()).filter((t) => !isNaN(t));
  const curFirst = fixTimes.length ? new Date(Math.min(...fixTimes)) : null;
  const curLastFix = fixTimes.length ? new Date(Math.max(...fixTimes)) : null;

  if (prevLastFix && curLastFix && curLastFix < prevLastFix) {
    items.push({
      kind: 'older_file',
      text: `This file ends ${fmt(curLastFix)}, before the one you analysed last time (to ${fmt(prevLastFix)}). Download a fresh export.`,
    });
  }
  if (prevFirst && curFirst && curFirst.getTime() - prevFirst.getTime() > SAME_DEPLOYMENT_MS) {
    items.push({
      kind: 'partial_file',
      text: `This file starts ${fmt(curFirst)}, but the record you analysed before went back to ${fmt(prevFirst)}. Add the earlier downloads with it for the full history.`,
    });
  }

  const newFixes = prevLastFix ? cur.fixes.filter((f) => f.date > prevLastFix).length : 0;
  const newMessages = !!(cur.newestMessage && prevLastMsg && cur.newestMessage > prevLastMsg);
  if (newFixes === 0 && !newMessages && !items.some((i) => i.kind === 'older_file')) {
    const upTo = prevLastMsg ?? prevLastFix;
    items.push({
      kind: 'nothing_new',
      text: `No new data since your last analysis${upTo ? ` (data to ${fmt(upTo)})` : ''}. Download a fresh export later.`,
    });
  } else if (newFixes > 0 || newMessages) {
    const parts = [newFixes > 0 ? `${newFixes} new fix${newFixes === 1 ? '' : 'es'}` : 'new messages but no new fixes'];
    if (cur.newestMessage) parts.push(`data now to ${fmt(cur.newestMessage)}`);
    items.push({ kind: 'new_data', text: `${parts.join(', ')}.` });
  }

  if (prev.bestLat !== null && prev.bestLon !== null) {
    const m = haversineKm(prev.bestLat, prev.bestLon, cur.bestLat, cur.bestLon) * 1000;
    const threshold = Math.max(2 * (prev.radiusM ?? 0), MIN_MOVE_M);
    if (m > threshold) {
      const toward = COMPASS[Math.round(bearing(prev.bestLat, prev.bestLon, cur.bestLat, cur.bestLon) / 45) % 8];
      items.unshift({
        kind: 'moved',
        text: `This tag has moved ${dist(m)} ${toward} since your last analysis.`,
      });
    } else if (newFixes > 0) {
      items.push({ kind: 'steady', text: `Position unchanged: ${dist(m)} from last time, inside the search radius.` });
    }
  }

  return { previousAnalysisAt: new Date(prev.analyzedAt), items };
}
