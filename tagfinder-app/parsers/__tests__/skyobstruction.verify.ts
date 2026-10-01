/**
 * The half-sky obstruction test: two seawall tags it must catch, a tag on
 * open sand it must leave alone, and the real 47127 and 47125 exports run
 * through the same pass matching the site uses.
 *
 *   npx tsx parsers/__tests__/skyobstruction.verify.ts
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { analyzeAntennaExposure, findSkyObstruction } from '@/analysis/antennaExposure';
import { analyzeSatCoverage } from '@/analysis/satCoverage';
import { predictPassesInWindow, type TLEEntry } from '@/analysis/satPrediction';
import { parseArgosMessages } from '@/parsers/argos/messages';
import type { AnnotatedPass } from '@/lib/types';
import { fixture } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const mk = (el: number, az: number, received: boolean) =>
  ({ maxElevation: el, peakAzimuth: az, received, trackPoints: [] }) as unknown as AnnotatedPass;

// A polar constellation over a mid-latitude site: peaks spread east and west,
// elevations spread 5-85. Reception drawn deterministically from a rate.
function sky(rateFor: (el: number, az: number) => number): AnnotatedPass[] {
  const out: AnnotatedPass[] = [];
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let i = 0; i < 800; i++) {
    const az = i % 2 === 0 ? 60 + (i * 7) % 60 : 240 + (i * 7) % 60; // east or west
    const el = 5 + (i * 13) % 80;
    out.push(mk(el, az, rnd() < rateFor(el, az)));
  }
  return out;
}

console.log('\n== SYNTHETIC ==');
{
  // Ocean Ridge: 19% heard to the east, 1% to the west, at every elevation.
  const tallWall = sky((_el, az) => (az < 180 ? 0.19 : 0.01));
  const r = analyzeAntennaExposure(tallWall);
  chk('tall wall west: directional', r.pattern, 'directional');
  chk('...toward W', r.obstruction?.toward, 'W');
  chk('...reaching high', (r.obstruction?.blockedUpToDeg ?? 0) >= 50, true);
  chk('...named as wall-height', /well above the tag/.test(r.reasoning), true);

  // Surfside: the low western sky is cut, and the west leans lower overall.
  const lowLip = sky((el, az) => (az >= 180 ? (el < 15 ? 0.02 : 0.22) : el < 15 ? 0.17 : 0.3));
  const l = analyzeAntennaExposure(lowLip);
  chk('low lip west: still found', l.obstruction !== null, true);
  chk('...toward W', l.obstruction?.toward, 'W');
  chk('...only the bottom band', l.obstruction?.blockedUpToDeg, 15);
  chk('...named as low', /it is low/.test(l.reasoning), true);

  // Open sand, 19% everywhere: the old quadrant test could never fire here,
  // and the new one must not either.
  const sand = sky(() => 0.19);
  const s = analyzeAntennaExposure(sand);
  chk('open sand: no obstruction', s.obstruction, null);
  chk('...not directional', s.pattern !== 'directional', true);

  // All-round horizon block (wrack) is symmetric and stays horizon_obstructed.
  const wrack = sky((el) => (el < 15 ? 0.03 : el < 30 ? 0.15 : 0.45));
  const w = analyzeAntennaExposure(wrack);
  chk('wrack: no obstruction', w.obstruction, null);
  chk('...horizon_obstructed', w.pattern, 'horizon_obstructed');

  chk('too few passes: null', findSkyObstruction(tallWall.slice(0, 30)), null);
  chk('too_few_passes result carries the field', analyzeAntennaExposure([]).obstruction, null);
}

function loadTles(path: string): TLEEntry[] {
  const lines = readFileSync(path, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const out: TLEEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) out.push({ name: lines[i], line1: lines[i + 1], line2: lines[i + 2] });
  return out;
}

function realCase(label: string, csv: string, tle: string, lat: number, lon: number, from: string, to: string) {
  const rows = Papa.parse<Record<string, string>>(readFileSync(csv, 'utf8'), { header: true, skipEmptyLines: true }).data;
  const m = parseArgosMessages(rows);
  const start = new Date(from), end = new Date(to);
  const received = m.passes.filter((p) => p.date >= start && p.date <= end);
  const predicted = predictPassesInWindow(loadTles(tle), lat, lon, start, end, 5);
  const cov = analyzeSatCoverage(predicted, received);
  const r = analyzeAntennaExposure(cov.passes);
  console.log(`        ${label}: ${predicted.length} predicted, ${cov.passes.filter((p) => p.received).length} heard; ${r.reasoning}`);
  return r;
}

const tle = fixture('argos-tles-2026-10-01.tle');
const f47127 = fixture('47127-cls-messages-2026-10-01.csv');
if (tle && f47127) {
  console.log('\n== PSAT+ 47127, OCEAN RIDGE FL — 3 m STEEL SEAWALL 1 m WEST ==');
  const r = realCase('47127', f47127, tle, 26.56346, -80.04144, '2026-07-23T00:00:00Z', '2026-07-30T00:00:00Z');
  chk('directional', r.pattern, 'directional');
  chk('blocked side is W', r.obstruction?.toward, 'W');
  chk('blocked nearly to the zenith', (r.obstruction?.blockedUpToDeg ?? 0) >= 50, true);
  chk('land half nearly silent', (r.obstruction?.blockedHeard ?? 99) <= 10, true);
} else {
  console.log('\n  (47127 fixtures absent — real-data check skipped)');
}

const f47125 = fixture('ID 47125_messages.csv');
if (tle && f47125) {
  console.log('\n== PSAT+ 47125, SURFSIDE FL — LOW WESTERN SKY CUT ==');
  const r = realCase('47125', f47125, tle, 25.89097, -80.11793, '2026-08-08T16:00:00Z', '2026-08-11T15:00:00Z');
  chk('obstruction found', r.obstruction !== null, true);
  chk('blocked side is W', r.obstruction?.toward, 'W');
} else {
  console.log('\n  (47125 fixture absent — real-data check skipped)');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
