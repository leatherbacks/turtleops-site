/**
 * Light and tide since the tag stopped.
 *
 * MiniPAT 33938 was carried indoors at Melbourne Beach about 6:35 pm EDT on
 * 14 Oct 2026. The site's light panel read its dusk curve that evening as
 * "normal day/night cycle, open sky"; the tidal panel read 20 status messages
 * from the drift as "tidally flooded, wet 67%"; the tide-reception panel mixed
 * passes from both sides of the landing. 40996 sat in a camper (covered), 41008
 * is an afloat control.
 *
 *   npx tsx parsers/__tests__/lightandtide.verify.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { analyzeLightAfterStop } from '@/analysis/lightAfterStop';
import { analyzeTidalIntrusion } from '@/analysis/tidalIntrusion';
import { analyzeTidePhase } from '@/analysis/tidePhase';
import { restingSince } from '@/analysis/restingPeriod';
import { computePosition } from '@/analysis/position';
import { classifyDrift } from '@/analysis/drift';
import { markOutliers } from '@/analysis/outliers';
import { parseLocations } from '@/parsers/wc/locations';
import { parseLightLoc } from '@/parsers/wc/lightLoc';
import { parseStatus } from '@/parsers/wc/status';
import { parseSummary } from '@/parsers/wc/summary';
import { parseArgos } from '@/parsers/wc/argos';
import type { TideExtreme } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(60)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;
function dataDir(name: string): string | null {
  for (const root of [process.env.TAGFINDER_FIXTURES, process.env.HOME && resolve(process.env.HOME, 'Documents/Apps/tagfinder/data')]) {
    if (root && existsSync(resolve(root, name))) return resolve(root, name);
  }
  return null;
}

function load(dir: string, ptt: string) {
  const fixes = parseLocations(csv(resolve(dir, `${ptt}-Locations.csv`)));
  const prelim = classifyDrift(fixes);
  markOutliers(fixes, prelim.recent !== 'insufficient' ? prelim.recent : 'stuck');
  const drift = classifyDrift(fixes);
  const label = drift.recent !== 'insufficient' ? drift.recent : drift.allTime;
  const since = restingSince(fixes);
  const pos = computePosition(fixes, since ? 'stuck' : label === 'insufficient' ? 'stuck' : label);
  const light = existsSync(resolve(dir, `${ptt}-LightLoc.csv`)) ? parseLightLoc(csv(resolve(dir, `${ptt}-LightLoc.csv`))) : [];
  return { fixes, since, pos, light, drifting: label === 'drifting' && !since };
}

console.log('\n== SYNTHETIC ==');
{
  // Three open-sky dusks at the surface, then one recorded after the stop that is 60 units darker.
  const mk = (day: number, offset = 0) => ({
    date: new Date(Date.UTC(2026, 9, day, 22, 20)), type: 'Dusk', deltaSeconds: 300,
    lightSamples: [170, 165, 160, 154, 148, 140, 132, 122, 110].map((v) => v - offset), depthSamples: [],
  }) as never;
  const stop = new Date(Date.UTC(2026, 9, 13, 12));
  const r = analyzeLightAfterStop([mk(10), mk(11), mk(12), mk(14, 60)], stop, 28.03, -80.545);
  chk('60 units under the reference at every sun height: covered', r.verdict === 'covered', r.verdict);
  const o = analyzeLightAfterStop([mk(10), mk(11), mk(12), mk(14, 5)], stop, 28.03, -80.545);
  chk('5 units under: open', o.verdict === 'open', o.verdict);
  const n = analyzeLightAfterStop([mk(10), mk(11), mk(12), mk(14, 60)], null, 28.03, -80.545);
  chk('no stop: insufficient', n.verdict === 'insufficient', n.verdict);
}

for (const name of ['wc-33938-2026-10-15', 'wc-33938-2026-10-16']) {
  const dir = dataDir(name);
  if (!dir) { console.log(`\n  (${name} absent)`); continue; }
  console.log(`\n== MiniPAT 33938 — ${name} ==`);
  const t = load(dir, '33938');
  const l = analyzeLightAfterStop(t.light, t.since, t.pos.lat, t.pos.lon);
  console.log('        ' + l.reasoning);
  if (name.endsWith('15')) {
    // The 14 Oct dusk curve had not been transmitted yet.
    chk('no curve since the stop yet: insufficient, not open', l.verdict === 'insufficient', l.verdict);
  } else {
    chk('light since the stop: covered', l.verdict === 'covered', l.verdict);
    chk('dark from 22:25–22:35Z on 14 Oct', !!l.darkSince && l.darkSince >= new Date('2026-10-14T22:25Z') && l.darkSince <= new Date('2026-10-14T22:35Z'), l.darkSince?.toISOString() ?? 'none');
  }
  chk('reference is the afloat curves (>= 10)', l.referenceCurves >= 10, `${l.referenceCurves}`);
  const summary = parseSummary(csv(resolve(dir, '33938-Summary.csv')));
  const ti = analyzeTidalIntrusion([], parseStatus(csv(resolve(dir, '33938-Status.csv'))), summary, { stoppedAt: t.since, drifting: t.drifting });
  console.log('        ' + ti?.reasoning);
  chk('not called tidally flooded', ti?.detected === false, `${ti?.detected}`);
  const old = analyzeTidalIntrusion([], parseStatus(csv(resolve(dir, '33938-Status.csv'))), summary);
  chk('...even without the stop, 0.5 m steps are not "wet"', (old?.wetPct ?? 100) < 50, `${old?.wetPct?.toFixed(0)}% wet`);
  const hilo = resolve(dir, 'coops-8721604-tide-hilo-2026-10-14_16.csv');
  if (existsSync(hilo)) {
    const ex: TideExtreme[] = csv(hilo).map((r) => ({ time: new Date(r['Date Time'].replace(' ', 'T') + 'Z'), height: +r[' Prediction'], type: r[' Type'].trim() as 'H' | 'L' }) as TideExtreme);
    const passes = parseArgos(csv(resolve(dir, '33938-Argos.csv')));
    const tp = analyzeTidePhase(passes, ex, new Date('2026-10-16T12:00Z'), t.since);
    console.log('        ' + tp?.reasoning);
    chk('tide-reception uses only passes since the stop', !!tp && !!t.since && tp.analyzedFrom >= t.since, tp?.analyzedFrom.toISOString() ?? 'none');
    chk('one window of passes is not "consistent across windows"', tp?.strength === 'none', tp?.strength ?? 'none');
  }
}

const d40996 = dataDir('wc-40996-2026-10-02');
if (d40996) {
  console.log('\n== MiniPAT 40996 — CAMPER ==');
  const t = load(d40996, '40996');
  const l = analyzeLightAfterStop(t.light, t.since, t.pos.lat, t.pos.lon);
  console.log('        ' + l.reasoning);
  chk('not read as open sky', l.verdict !== 'open', l.verdict);
}

const d41008 = dataDir('wc-41008');
if (d41008) {
  console.log('\n== MiniPAT 41008 — AFLOAT CONTROL ==');
  const t = load(d41008, '41008');
  const l = analyzeLightAfterStop(t.light, t.since, t.pos.lat, t.pos.lon);
  console.log(`        since ${t.since?.toISOString() ?? 'none'}: ${l.reasoning}`);
  chk('never called covered', l.verdict !== 'covered', l.verdict);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
