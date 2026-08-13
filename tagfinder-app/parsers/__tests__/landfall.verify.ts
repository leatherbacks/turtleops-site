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
// The real dataset's last fix is days old, which the projection now correctly
// refuses to extrapolate (covered separately below). These checks are about the
// path walker itself — does it find the first land crossing along a track — so
// they run it at a position age the vector actually supports.
const hoursSince = (Date.now() - lastFix.date.getTime()) / 3_600_000;
const FRESH_HOURS = 6;
const lf = findLandfall(samples, pred, FRESH_HOURS)!;

console.log(`\n== LANDFALL ==`);
console.log(`  willStrand: ${lf.willStrand}   alreadyPassed: ${lf.alreadyPassed}`);
if (lf.lat) console.log(`  at ${lf.lat.toFixed(4)}, ${lf.lon!.toFixed(4)}  after ${lf.hoursFromLastFix!.toFixed(1)} h  (${lf.distanceKm!.toFixed(1)} km)`);
console.log(`  ${lf.reasoning}`);
chk('predicts a strand', lf.willStrand);
chk('projects while the vector is still current', lf.projectable === true);
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
const elf = findLandfall(es, east, FRESH_HOURS)!;
console.log(`  ${elf.reasoning}`);
chk('no strand heading offshore', !elf.willStrand);

console.log('\n== THE REAL DATASET IS TOO STALE TO PROJECT ==');
const realAge = findLandfall(samples, pred, hoursSince)!;
console.log(`        last usable position is ${hoursSince.toFixed(1)} h old`);
chk('real dataset refuses to project', realAge.projectable === false);
chk('...and names no strand point', realAge.lat === null);

console.log('\n== A STALE VECTOR MUST NOT PRODUCE A STRAND POINT ==');
// The failure this guards against: a vector fitted over 12 h, a tag that then
// stopped producing positions, and four days later a confident strand point
// 4.8 km up the coast labelled "likely already ashore" — while the same report
// said "Insufficient recent data" two panels below it. The tag was ~2 km from
// its last good fix in almost the opposite direction.
const stalePred: any = {
  speedKmH: 0.34,
  headingDeg: 356,
  fitFrom: new Date('2026-01-01T03:00:00Z'),
  fitTo: new Date('2026-01-01T15:00:00Z'),
  predictions: [],
};
const straightPath = Array.from({ length: 20 }, (_, i) => ({
  lat: 25.9 + i * 0.002, lon: -80.12,
  distanceKm: i * 0.25, hours: i * 0.7,
  elevationM: i < 19 ? 0 : 5,   // land at the far end
}));
const fresh = findLandfall(straightPath as any, stalePred, 6)!;
chk('fresh position still projects', fresh.projectable === true);
chk('...and finds the land crossing', fresh.willStrand === true);
const borderline = findLandfall(straightPath as any, stalePred, 20)!;
chk('20 h old still projects', borderline.projectable === true);
const stale = findLandfall(straightPath as any, stalePred, 96)!;
chk('4 days old refuses to project', stale.projectable === false);
chk('...and offers no coordinate', stale.lat === null);
chk('...and does not claim a strand', stale.willStrand === false);
chk('...and does not claim it already went ashore', stale.alreadyPassed === false);
chk('...and explains why', /beyond the/.test(stale.reasoning));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
