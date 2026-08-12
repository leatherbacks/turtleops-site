import { readFileSync } from 'fs';
import { parseArgosDS } from '@/parsers/argos/ds';
import { analyzeTransmissionHealth } from '@/analysis/transmissionHealth';
import type { ArgosPass } from '@/lib/types';
import { requireFixture, RAW_DS_TXT } from './fixtures';

const RAW = requireFixture(RAW_DS_TXT);
let pass = 0, fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(50)} got=${got}${ok ? '' : ` want=${want}`}`);
};

const ds = parseArgosDS(readFileSync(RAW, 'utf8'));
console.log('\n== NO UNDATED PASSES ESCAPE THE PARSER ==');
chk('every pass has a valid date', ds.passes.every(p => !isNaN(p.date.getTime())), true);
chk('passes are sorted ascending',
  ds.passes.every((p, i) => i === 0 || p.date >= ds.passes[i-1].date), true);
chk('located fixes unchanged', ds.fixes.length, 110);
const unloc = ds.passes.filter(p => p.latitude === null).length;
console.log(`        located=${ds.passes.length - unloc} unlocated=${unloc} total=${ds.passes.length}`);
chk('unlocated passes retained with real dates', unloc > 90, true);
const msgs = ds.passes.reduce((s, p) => s + p.msgCount, 0);
chk('message yield preserved (>1100)', msgs > 1100, true);

console.log('\n== THE ACTUAL CRASH: transmissionHealth on real data ==');
let crashed = null;
try { analyzeTransmissionHealth(ds.passes, null); } catch (e: any) { crashed = e.message; }
chk('no crash on real pass data', crashed, null);

console.log('\n== REGRESSION: hostile inputs that used to throw ==');
const mk = (d: Date): ArgosPass => ({
  date: d, satellite: 'MC', msgCount: 4, duplicates: 0, corrupt: 0, avgInterval: 60,
  locationQuality: '2', latitude: 25.8, longitude: -80.1, latitude2: null,
  longitude2: null, frequencyHz: 401675940, powerDbm: null,
});
const t = (n: number) => new Date(Date.UTC(2026, 7, 7, n));
const cases: [string, ArgosPass[]][] = [
  ['NaN date mixed in', [mk(t(1)), mk(new Date(NaN)), mk(t(5))]],
  ['reverse-sorted passes', [mk(t(9)), mk(t(5)), mk(t(1))]],
  ['all dates NaN', [mk(new Date(NaN)), mk(new Date(NaN))]],
  ['single pass', [mk(t(1))]],
  ['empty', []],
  ['all identical timestamps', [mk(t(3)), mk(t(3)), mk(t(3))]],
];
for (const [label, ps] of cases) {
  let err = null;
  try { analyzeTransmissionHealth(ps, null); } catch (e: any) { err = e.message; }
  chk(label, err, null);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
