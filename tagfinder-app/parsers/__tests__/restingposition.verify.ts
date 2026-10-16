/**
 * A tag that drifted and then stopped is searched for where it stopped.
 *
 * MiniPAT 33938 drifted three days off Satellite Beach and came ashore at
 * Melbourne Beach on 14 Oct 2026. The site averaged all 73 fixes into a
 * headline 13 km out at sea, read the antenna "clear" off the whole record's
 * 6.6 messages a pass (2.4 since landfall), and kept a two-day-old "bobbing in
 * surf" as the tag state. Exports of 15 and 16 Oct; the 16 Oct joint fit of the
 * class A/1/3 ellipses puts the tag at 28.0299 N 80.5435 W.
 *
 *   npx tsx parsers/__tests__/restingposition.verify.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { classifyDrift } from '@/analysis/drift';
import { markOutliers } from '@/analysis/outliers';
import { computePosition, stoppedCluster } from '@/analysis/position';
import { computeSearchRadius } from '@/analysis/searchRadius';
import { restingSince, stoppedSince } from '@/analysis/restingPeriod';
import { analyzeReceptionQuality } from '@/analysis/receptionQuality';
import { analyzeTagState } from '@/analysis/tagState';
import { detectGrounding } from '@/analysis/grounding';
import { getPositionFixes } from '@/analysis/quality';
import { parseLocations } from '@/parsers/wc/locations';
import { parseArgos } from '@/parsers/wc/argos';
import { parseStatus } from '@/parsers/wc/status';
import { parseSummary } from '@/parsers/wc/summary';
import { parseSeries } from '@/parsers/wc/series';
import { parseArgosMessages } from '@/parsers/argos/messages';
import { haversineKm } from '@/lib/haversine';
import type { ArgosFix, ArgosPass, DeploySummary, TagStatus } from '@/lib/types';
import { fixture } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(60)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;

/** An export folder by name, under TAGFINDER_FIXTURES or the development data directory. */
function dataDir(name: string): string | null {
  for (const root of [process.env.TAGFINDER_FIXTURES, process.env.HOME && resolve(process.env.HOME, 'Documents/Apps/tagfinder/data')]) {
    if (root && existsSync(resolve(root, name))) return resolve(root, name);
  }
  return null;
}

/** The parts of useAnalysis and the page that decide position, window and state. */
function run(fixes: ArgosFix[], passes: ArgosPass[], statuses: TagStatus[], summary: DeploySummary | null) {
  const prelim = classifyDrift(fixes);
  // mirrors useAnalysis 4-7
  markOutliers(fixes, prelim.recent !== 'insufficient' ? prelim.recent : prelim.allTime === 'insufficient' ? 'stuck' : prelim.allTime);
  const drift = classifyDrift(fixes);
  const grounded = passes.length > 0 && detectGrounding(fixes, passes, summary?.releaseDate ?? null).verdict === 'grounded';
  let label = drift.recent !== 'insufficient' ? drift.recent : drift.allTime;
  if (!grounded && label === 'drifting' && stoppedSince(fixes)) label = 'stuck';
  const pos = computePosition(fixes, grounded ? 'drifting' : label === 'insufficient' ? 'stuck' : label);
  const radius = computeSearchRadius(label === 'drifting' || grounded ? fixes : pos.basis, { driftLabel: label });
  const since = restingSince(fixes);
  const located = fixes.filter((f) => !f.isOutlier && (!since || f.date >= since));
  const rq = analyzeReceptionQuality(passes, located.length, located.map((f) => f.quality), { since });
  const ts = analyzeTagState(statuses, summary, null, [], null, fixes, rq, null, null, null);
  // What the headline used to be for a stuck tag: every position fix.
  const all = getPositionFixes(fixes);
  const w = all.reduce((s, f) => s + 1 / f.effectiveError ** 2, 0);
  const old = {
    lat: all.reduce((s, f) => s + f.latitude / f.effectiveError ** 2, 0) / w,
    lon: all.reduce((s, f) => s + f.longitude / f.effectiveError ** 2, 0) / w,
  };
  return { label, grounded, pos, radius, since, rq, ts, old };
}

function report(r: ReturnType<typeof run>) {
  console.log(`        drift ${r.label}${r.grounded ? ' (grounded)' : ''}; position ${r.pos.lat.toFixed(4)}, ${r.pos.lon.toFixed(4)} from ${r.pos.basis.length} fixes` +
    ` since ${r.pos.basis[0]?.date.toISOString().slice(0, 16)}; radius ${Math.round(r.radius.primaryM)} m`);
  console.log(`        old whole-record mean ${r.old.lat.toFixed(4)}, ${r.old.lon.toFixed(4)}; resting since ${r.since?.toISOString().slice(0, 16) ?? 'none'}`);
  console.log(`        reception ${r.rq.verdict}: ${r.rq.messagesPerPass} over ${r.rq.passes} passes, baseline ${r.rq.baselineMessagesPerPass ?? '—'}`);
  console.log(`        tag state ${r.ts.phase}: ${r.ts.reasoning}`);
}

const ISLAND = { lat: 28.0299, lon: -80.5435 };
for (const name of ['wc-33938-2026-10-15', 'wc-33938-2026-10-16']) {
  const dir = dataDir(name);
  if (!dir) { console.log(`\n  (${name} absent)`); continue; }
  console.log(`\n== MiniPAT 33938 — ${name} ==`);
  const r = run(
    parseLocations(csv(resolve(dir, '33938-Locations.csv'))),
    parseArgos(csv(resolve(dir, '33938-Argos.csv'))),
    parseStatus(csv(resolve(dir, '33938-Status.csv'))),
    parseSummary(csv(resolve(dir, '33938-Summary.csv')))
  );
  report(r);
  const d = haversineKm(r.pos.lat, r.pos.lon, ISLAND.lat, ISLAND.lon);
  chk('the old whole-record mean was at sea, > 10 km off', haversineKm(r.old.lat, r.old.lon, ISLAND.lat, ISLAND.lon) > 10);
  chk('position on the island, within 0.6 km of the joint fit', d < 0.6, `${d.toFixed(2)} km`);
  chk('position rests only on fixes since landfall (21:49Z 14 Oct)', r.pos.basis[0]?.date.toISOString() === '2026-10-14T21:49:25.000Z');
  chk('search radius from the island fixes, not a drift-day class 3', r.radius.primaryM < 1000, `${Math.round(r.radius.primaryM)} m`);
  chk('resting window starts at landfall', r.since?.toISOString() === '2026-10-14T21:49:25.000Z');
  chk('antenna not called clear', r.rq.verdict !== 'clear', r.rq.verdict);
  chk('afloat baseline above 6 a pass', (r.rq.baselineMessagesPerPass ?? 0) > 6, `${r.rq.baselineMessagesPerPass}`);
  chk('tag state does not carry the stale "in surf"', !['surface', 'partially_submerged', 'submerged'].includes(r.ts.phase), r.ts.phase);
}

const wc285927 = dataDir('wc-285927');
if (wc285927) {
  console.log('\n== MiniPAT 285927 — PADRE ISLAND, FOUND ==');
  const fixes = parseLocations(csv(resolve(wc285927, '285927-Locations.csv')));
  const r = run(fixes, parseArgos(csv(resolve(wc285927, '285927-Argos.csv'))), [], null);
  report(r);
  const q3 = r.pos.basis.find((f) => f.quality === '3');
  chk('the class 3 (306 × 66 m) is in the position', !!q3);
  const d = haversineKm(r.pos.lat, r.pos.lon, 27.58633, -97.22134);
  chk('position within 0.5 km of the class 3, not on the 3.9 km class 2', d < 0.5, `${d.toFixed(2)} km`);
  // Found buried flat in the sand. The export has no ReleaseDate; the parser
  // infers one from transmission starting after the archive ended.
  const summary = parseSummary(csv(resolve(wc285927, '285927-Summary.csv')));
  chk('release inferred from the record', summary?.inferredReleaseDate?.toISOString() === '2026-04-01T01:20:00.000Z');
  const env = { elevation: { meters: 1.88, classification: 'land', source: 'test' }, location: { name: 'Nueces County, TX', place: { name: 'Access Raod 5', kind: 'road', category: 'highway', type: 'service' } } } as never;
  const st = analyzeTagState([], summary, env, parseSeries(csv(resolve(wc285927, '285927-Series.csv'))), null, fixes, r.rq, null, null, null);
  chk('tag state: buried, as found', st.phase === 'buried', st.phase);
}

const wc40996 = dataDir('wc-40996-2026-10-02');
if (wc40996) {
  console.log('\n== MiniPAT 40996 — CAMPER, THEN CARRIED (control) ==');
  const fixes = parseLocations(csv(resolve(wc40996, '40996-Locations.csv')));
  report(run(fixes, parseArgos(csv(resolve(wc40996, '40996-Argos.csv'))), [], null));
}

const f47128 = fixture(/47128-cls-messages-2026-10-07\.csv$/);
if (f47128) {
  console.log('\n== PSAT+ 47128 — PONTE VEDRA SURF (control) ==');
  const m = parseArgosMessages(csv(f47128));
  const r = run(m.fixes, m.passes, [], null);
  report(r);
  const d = haversineKm(r.pos.lat, r.pos.lon, 30.188, -81.36);
  chk('position within 2 km of the Ponte Vedra landing', d < 2, `${d.toFixed(2)} km`);
}

for (const [ptt, file] of [['47125', '47125-cls-messages-2026-10-01.csv'], ['47127', '47127-cls-messages-2026-10-01.csv']] as const) {
  const f = fixture(file);
  if (!f) { console.log(`\n  (${ptt} absent)`); continue; }
  console.log(`\n== PSAT+ ${ptt} (control) ==`);
  const m = parseArgosMessages(csv(f));
  const r = run(m.fixes, m.passes, [], null);
  report(r);
  const c = stoppedCluster(getPositionFixes(m.fixes));
  chk('stopped cluster is non-empty', c.length > 0, `${c.length} fixes`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
