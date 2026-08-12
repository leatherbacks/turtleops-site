import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { parseArgosMessages } from '@/parsers/argos/messages';
import { parseArgosDS } from '@/parsers/argos/ds';
import { analyzeTransmissionHealth } from '@/analysis/transmissionHealth';
import { computePosition } from '@/analysis/position';
import { markOutliers } from '@/analysis/outliers';
import { getPositionFixes } from '@/analysis/quality';
import { requireFixture, MESSAGES_CSV, RAW_DS_TXT , fixturePtt } from './fixtures';

const REF_PTT = fixturePtt();


const CSV = requireFixture(MESSAGES_CSV);
const DS = requireFixture(RAW_DS_TXT);

let pass = 0,
  fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(56)} got=${got}${ok ? '' : ` want=${want}`}`);
};

const rows = Papa.parse<Record<string, string>>(readFileSync(CSV, 'utf8'), {
  header: true,
  skipEmptyLines: true,
}).data;

const m = parseArgosMessages(rows);

console.log('\n== PARSE ==');
chk('PTT resolved', m.ptt, REF_PTT);
chk('unique positions deduped from 1203 rows', m.fixes.length, 137);
chk('fixes sorted ascending',
  m.fixes.every((f, i) => i === 0 || f.date >= m.fixes[i - 1].date), true);
chk('every fix has a valid date', m.fixes.every((f) => !isNaN(f.date.getTime())), true);
chk('every pass has a valid date', m.passes.every((p) => !isNaN(p.date.getTime())), true);
chk('corrupt stays null (not reported by this export)',
  m.passes.every((p) => p.corrupt === null), true);

console.log('\n== THE POINT OF THIS FORMAT: REAL ERROR RADII ==');
const withRadius = m.fixes.filter((f) => f.errorRadius > 0).length;
chk('most fixes carry a reported radius', withRadius > 130, true);
// Both final fixes are class B. The empirical table scores them identically at
// 14098 m; their reported radii differ by 16x. This is the whole reason the
// message export outranks the DS dump.
const finals = m.fixes.filter((f) => f.date >= new Date('2026-08-11T00:00:00Z'));
chk('two class-B fixes on Aug 11', finals.length, 2);
chk('both are class B', finals.every((f) => f.quality === 'B'), true);
chk('their effective errors are NOT equal',
  finals[0].effectiveError !== finals[1].effectiveError, true);
chk('junk fix scored at its reported 24474 m',
  Math.max(...finals.map((f) => f.effectiveError)), 24474);
chk('usable fix scored at its reported 1535 m',
  Math.min(...finals.map((f) => f.effectiveError)), 1535);

console.log('\n== SIGNAL LEVEL SURVIVES ==');
const withPower = m.passes.filter((p) => p.powerDbm !== null);
chk('passes carry dBm', withPower.length > 50, true);
chk('dBm in a plausible Argos range',
  withPower.every((p) => p.powerDbm! < -100 && p.powerDbm! > -160), true);

console.log('\n== UNLOCATED PASSES: THE Aug 9-10 SIGNATURE ==');
const day = (d: string) => m.passes.filter((p) => p.date.toISOString().slice(0, 10) === d);
for (const d of ['2026-08-07', '2026-08-08', '2026-08-09', '2026-08-10', '2026-08-11']) {
  const ps = day(d);
  const located = ps.filter((p) => p.latitude !== null).length;
  const msgs = ps.reduce((s, p) => s + p.msgCount, 0);
  console.log(`        ${d}  passes=${String(ps.length).padStart(3)} located=${String(located).padStart(3)} msgs=${String(msgs).padStart(4)}`);
}
// Steady message flow with zero position solutions is the diagnostic that
// distinguishes an obstructed tag from a silent one.
chk('Aug 9 delivered messages', day('2026-08-09').reduce((s, p) => s + p.msgCount, 0) > 150, true);
chk('Aug 9 produced no located pass',
  day('2026-08-09').every((p) => p.latitude === null), true);
chk('Aug 10 produced no located pass',
  day('2026-08-10').every((p) => p.latitude === null), true);

console.log('\n== AGREES WITH THE DS DUMP OVER THE OVERLAPPING WINDOW ==');
const ds = parseArgosDS(readFileSync(DS, 'utf8'));
const dsEnd = ds.fixes[ds.fixes.length - 1].date;
const overlap = m.fixes.filter((f) => f.date <= dsEnd);
chk('DS fix count', ds.fixes.length, 110);
console.log(`        messages export has ${overlap.length} fixes in the same window`);
// Same satellite geometry, same Doppler solutions — positions must match.
let maxDeltaM = 0;
for (const f of ds.fixes) {
  const near = m.fixes.find((x) => Math.abs(x.date.getTime() - f.date.getTime()) < 1000);
  if (!near) continue;
  const dLat = (near.latitude - f.latitude) * 111320;
  const dLon = (near.longitude - f.longitude) * 111320 * Math.cos((f.latitude * Math.PI) / 180);
  maxDeltaM = Math.max(maxDeltaM, Math.hypot(dLat, dLon));
}
chk('matched positions agree to <1 m', maxDeltaM < 1, true);

console.log('\n== A BAD FIX MUST NOT DISQUALIFY A GOOD ONE ==');
// The 24 km fix arrives 22 min before the 1535 m fix. Compared as exact points
// they imply 10.9 km/h and the good fix gets flagged; charged only for
// displacement beyond their combined error, neither accuses the other.
markOutliers(m.fixes, 'drifting');
const aug11 = m.fixes.filter((f) => f.date >= new Date('2026-08-11T00:00:00Z'));
chk('the 1535 m fix is not flagged an outlier',
  aug11.find((f) => f.errorRadius === 1535)!.isOutlier, false);
chk('a real jump between tight fixes still trips the cap', (() => {
  const tight = (t: string, lat: number, lon: number): any => ({
    date: new Date(t), latitude: lat, longitude: lon, quality: '3',
    errorRadius: 514, semiMajor: 0, semiMinor: 0, orientation: 0,
    effectiveError: 514, isOutlier: false,
  });
  // 60 km apart in one hour, both class 3 — combined error only ~1 km.
  const f = [tight('2026-01-01T00:00:00Z', 25.0, -80.0),
             tight('2026-01-01T01:00:00Z', 25.54, -80.0)];
  markOutliers(f, 'drifting');
  return f[1].isOutlier;
})(), true);

console.log('\n== THE HEADLINE MUST NOT MOVE ON TWO 2-MESSAGE FIXES ==');
// Both Aug 11 fixes are class B, and they contradict each other by 10.9 km/h.
// The best-estimate position must stay on the last well-supported cluster.
const posFixes = getPositionFixes(m.fixes);
chk('no class-B fix reaches position estimation',
  posFixes.some((f) => f.quality === 'B'), false);
chk('last position-grade fix is the Aug 8 class A',
  posFixes[posFixes.length - 1].date.toISOString(), '2026-08-08T15:51:50.000Z');

console.log('\n== DOWNSTREAM ANALYZERS DO NOT CRASH ==');
let crashed: string | null = null;
try {
  analyzeTransmissionHealth(m.passes, null);
  markOutliers(m.fixes, 'drifting'); // mutates in place
  const pos = computePosition(m.fixes, 'drifting');
  console.log(`        position ${pos.lat.toFixed(5)}, ${pos.lon.toFixed(5)} (${pos.method})`);
} catch (e: any) {
  crashed = e.message;
}
chk('health + outliers + position run clean', crashed, null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
