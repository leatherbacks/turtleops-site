/** Landfall prediction against the a real drifting-tag track + real terrain. */
import { readFileSync } from 'fs';
import { parseArgosDS } from '@/parsers/argos/ds';
import { classifyDrift } from '@/analysis/drift';
import { markOutliers } from '@/analysis/outliers';
import { computePosition } from '@/analysis/position';
import { predictDrift } from '@/analysis/driftPredict';
import { landfallProbePath, findLandfall, type ProbeSample } from '@/analysis/landfall';
import { requireFixture, RAW_DS_TXT } from './fixtures';

const ds = parseArgosDS(readFileSync(requireFixture(RAW_DS_TXT),'utf8'));
let pass = 0, fail = 0;
const chk = (l: string, ok: boolean, d = '') => { ok ? pass++ : fail++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l.padEnd(46)} ${d}`); };

(async () => {
const fixes = ds.fixes;
const p0 = classifyDrift(fixes);
markOutliers(fixes, p0.recent !== 'insufficient' ? p0.recent : p0.allTime);
const drift = classifyDrift(fixes);
const label = drift.recent !== 'insufficient' ? drift.recent : drift.allTime;
const pred = predictDrift(fixes)!;
const pos = computePosition(fixes, label);

const path = landfallProbePath(pred, pos.lat, pos.lon);
console.log(`\n== PROBE PATH ==`);
console.log(`  ${path.length} probes, ${(path[1].distanceKm - path[0].distanceKm)*1000 | 0} m spacing, horizon ${path[path.length-1].hours.toFixed(1)} h`);
chk('within batch cap (64)', path.length <= 64, `${path.length}`);
chk('resolution <= 300 m', (path[1].distanceKm - path[0].distanceKm) <= 0.3);

// real elevation lookups, one batched call
const locs = path.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|');
const res = await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${locs}`);
const data = await res.json();
const samples: ProbeSample[] = path.map((p, i) => ({
  ...p, elevationM: typeof data.results?.[i]?.elevation === 'number' ? data.results[i].elevation : null,
}));
chk('all probes resolved', samples.every(s => s.elevationM !== null), `${samples.filter(s=>s.elevationM!==null).length}/${samples.length}`);

const lastFix = fixes[fixes.length - 1];
const hoursSince = (Date.now() - lastFix.date.getTime()) / 3_600_000;
const lf = findLandfall(samples, pred, hoursSince)!;

console.log(`\n== LANDFALL ==`);
console.log(`  willStrand: ${lf.willStrand}   alreadyPassed: ${lf.alreadyPassed}`);
if (lf.lat) console.log(`  at ${lf.lat.toFixed(4)}, ${lf.lon!.toFixed(4)}  after ${lf.hoursFromLastFix!.toFixed(1)} h  (${lf.distanceKm!.toFixed(1)} km)`);
console.log(`  ${lf.reasoning}`);
chk('predicts a strand', lf.willStrand);
chk('already passed (last fix 2.9 d ago)', lf.alreadyPassed);
chk('landfall point is actually on land',
  (samples.find(s => s.lat === lf.lat)?.elevationM ?? 0) >= 1);
chk('landfall before the +24h point that was inland',
  (lf.hoursFromLastFix ?? 99) < 24, `${lf.hoursFromLastFix?.toFixed(1)} h`);

console.log(`\n== NO-LANDFALL CASE (heading due east, open ocean) ==`);
const east = { ...pred, headingDeg: 90 };
const ep = landfallProbePath(east, pos.lat, pos.lon);
const eloc = ep.map(p => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|');
const er = await (await fetch(`https://api.open-elevation.com/api/v1/lookup?locations=${eloc}`)).json();
const es: ProbeSample[] = ep.map((p,i) => ({...p, elevationM: er.results?.[i]?.elevation ?? null}));
const elf = findLandfall(es, east, hoursSince)!;
console.log(`  ${elf.reasoning}`);
chk('no strand heading offshore', !elf.willStrand);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
