/**
 * The sky view split at the moment the tag stopped — see analysis/restingPeriod.ts.
 *
 *   npx tsx parsers/__tests__/skywindow.verify.ts
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { parseArgosMessages } from '@/parsers/argos/messages';
import { restingSince, skyWindowEnd } from '@/analysis/restingPeriod';
import type { ArgosFix, ArgosPass } from '@/lib/types';
import { fixture } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(66)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const T0 = Date.UTC(2026, 9, 5, 12), H = 3600_000;
const fix = (h: number, q: string, lat: number, lon: number, e = 400) =>
  ({ date: new Date(T0 + h * H), quality: q, latitude: lat, longitude: lon, errorRadius: e, semiMajor: 0, semiMinor: 0, orientation: 0, effectiveError: e, isOutlier: false }) as unknown as ArgosFix;
const pass_ = (h: number) => ({ date: new Date(T0 + h * H), satellite: 'MC', msgCount: 3 }) as ArgosPass;

console.log('\n== resting since ==');
{
  const track = [0, 2, 4, 6, 8, 10, 12].map((h) => fix(h, '2', 30.60 - h * 0.004, -81.20));
  chk('a tag still moving has no resting period', restingSince(track), null);
  const beached = [...track, fix(51, 'B', 30.1891, -81.3605, 568), fix(51.5, '1', 30.1884, -81.3602, 507), fix(53, 'B', 30.1885, -81.3601, 996)];
  chk('resting since the first fix of the final cluster', restingSince(beached)?.getTime(), T0 + 51 * H);
  const always = [0, 5, 10, 20].map((h) => fix(h, '2', 30.1884 + h * 0.0005, -81.3602));
  chk('a tag that never moved is not split', restingSince(always), null);
  const one = [...track, fix(51, '1', 30.1884, -81.3602, 507)];
  chk('one fix at the new place is not yet a resting period', restingSince(one), null);
}

console.log('\n== window end ==');
{
  const now = new Date(T0 + 60 * H);
  chk('live file: window runs to now', skyWindowEnd([pass_(0), pass_(50)], now)?.getTime(), now.getTime());
  chk('archive: window ends at the last message', skyWindowEnd([pass_(0), pass_(5)], now)?.getTime(), T0 + 5 * H);
  chk('no passes: no window', skyWindowEnd([], now), null);
}

const real = fixture(/47128-cls-messages-2026-10-07\.csv$/);
if (real) {
  console.log(`\n== REAL: ${real} ==`);
  const rows = Papa.parse<Record<string, string>>(readFileSync(real, 'utf8'), { header: true, skipEmptyLines: true }).data;
  const am = parseArgosMessages(rows);
  chk('47128 stopped at the first Ponte Vedra fix', restingSince(am.fixes)?.toISOString(), '2026-10-07T15:02:58.000Z');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
