/**
 * A tag that moves faster than water can move it is in somebody's hands, and
 * its latest quality fix is where it is — not an outlier.
 *
 *   npx tsx parsers/__tests__/carried.verify.ts
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { detectCarried } from '@/analysis/carried';
import { markOutliers } from '@/analysis/outliers';
import { analyzeTagState } from '@/analysis/tagState';
import { parseLocations } from '@/parsers/wc/locations';
import type { ArgosFix } from '@/lib/types';
import { fixture } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const T0 = Date.UTC(2026, 9, 1, 12), H = 3600_000;
const fix = (h: number, q: string, lat: number, lon: number, e = 200) => ({ date: new Date(T0 + h * H), quality: q, latitude: lat, longitude: lon, errorRadius: e, semiMajor: 0, semiMinor: 0, orientation: 0, effectiveError: e, isOutlier: false }) as unknown as ArgosFix;

console.log('\n== SYNTHETIC ==');
{
  // A day on a table, then 50 km in three hours at class 3.
  const camp = [0, 2, 5, 9, 14, 18].map((h) => fix(h, '3', 35.571 + (h % 3) * 0.0004, -75.463));
  const moved = [...camp, fix(21, '3', 35.995, -75.663, 166)];
  const c = detectCarried(moved);
  chk('50 km at class 3 in 3 h: carried', c.verdict, 'carried');
  chk('...speed about 17 km/h', Math.round(c.speedKmH ?? 0), 17);
  chk('...destination is the latest fix', c.to?.latitude, 35.995);
  markOutliers(moved, 'stuck');
  chk('the stuck outlier screen flags the destination', moved[6].isOutlier, true);
  for (const f of moved) if (c.since && f.date.getTime() > c.since.getTime() && ['3', '2', '1'].includes(f.quality)) f.isOutlier = false;
  chk('...and the carried leg is restored', moved[6].isOutlier, false);
  const st = analyzeTagState([], { releaseDate: new Date(T0 - H) } as never, { elevation: { meters: 2.4, source: 'usgs', classification: 'land' } } as never, [], null, moved, null, null, null, c);
  chk('tag state: likely recovered, by the move', st.phase === 'likely_recovered' && /Carried/.test(st.reasoning), true);

  // The same jump at class B is scatter, not a move.
  chk('50 km at class B: not carried', detectCarried([...camp, fix(21, 'B', 35.995, -75.663, 1500)]).verdict, 'none');
  // 3 km over a day is drift.
  chk('3 km in 24 h: not carried', detectCarried([...camp, fix(42, '3', 35.598, -75.463)]).verdict, 'none');
  // 50 km over three days at class 3 is drift too, the drift model's job.
  chk('50 km in 72 h: not carried', detectCarried([...camp, fix(90, '3', 35.995, -75.663)]).verdict, 'none');
  // A single fix cannot be carried from anywhere.
  chk('one fix: none', detectCarried([fix(0, '3', 35.571, -75.463)]).verdict, 'none');
  // Out at 17 km/h and back at 17 km/h: still carried, and now back at the cluster.
  const back = detectCarried([...camp, fix(21, '3', 35.995, -75.663, 166), fix(24, '3', 35.571, -75.463)]);
  chk('jump then back: carried, to the cluster', back.verdict === 'carried' && Math.abs((back.to?.latitude ?? 0) - 35.571) < 0.001, true);
}

const loc = fixture('40996-Locations-2026-10-02.csv');
if (loc) {
  console.log('\n== MiniPAT 40996, 2 Oct 2026 — campground to Kill Devil Hills ==');
  const fixes = parseLocations(Papa.parse<Record<string, string>>(readFileSync(loc, 'utf8'), { header: true, skipEmptyLines: true }).data);
  const c = detectCarried(fixes);
  console.log('        ' + c.reasoning);
  chk('carried', c.verdict, 'carried');
  chk('from the campground', Math.abs((c.from?.latitude ?? 0) - 35.572) < 0.003, true);
  chk('to Kill Devil Hills', Math.abs((c.to?.latitude ?? 0) - 35.9953) < 0.001 && Math.abs((c.to?.longitude ?? 0) + 75.6626) < 0.001, true);
  chk('about 50 km', Math.abs((c.distanceKm ?? 0) - 50.5) < 1, true);
  chk('after the 06:39 UTC+4 fix', c.since?.toISOString().slice(0, 16), '2026-10-02T10:39');
} else console.log('\n  (40996 fixture absent)');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
