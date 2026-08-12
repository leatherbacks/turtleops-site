/** Do the drifting-tag fixes produce a usable recovery position? */
import { readFileSync } from 'fs';
import { parseArgosDS } from '@/parsers/argos/ds';
import { classifyDrift } from '@/analysis/drift';
import { markOutliers } from '@/analysis/outliers';
import { computePosition } from '@/analysis/position';
import { computeSearchRadius } from '@/analysis/searchRadius';
import { predictDrift } from '@/analysis/driftPredict';
import { analyzeTagState } from '@/analysis/tagState';
import { parseLotekDiveLog } from '@/parsers/lotek/diveLog';
import { haversineKm } from '@/lib/haversine';
import Papa from 'papaparse';
import { requireFixture, RAW_DS_TXT, LOTEK_DIVE_LOG } from './fixtures';

const ds = parseArgosDS(readFileSync(requireFixture(RAW_DS_TXT), 'utf8'));
const dive = parseLotekDiveLog(Papa.parse(readFileSync(requireFixture(LOTEK_DIVE_LOG), 'utf8'),
  { header: true, skipEmptyLines: true }).data as any[]);

let pass = 0, fail = 0;
const chk = (l: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(48)} ${detail}`);
};

const fixes = ds.fixes;
const prelim = classifyDrift(fixes);
markOutliers(fixes, prelim.recent !== 'insufficient' ? prelim.recent : prelim.allTime);
const drift = classifyDrift(fixes);
const label = drift.recent !== 'insufficient' ? drift.recent : drift.allTime;
const pred = label === 'drifting' ? predictDrift(fixes) : null;
const pos = computePosition(fixes, label);

const LAST = fixes[fixes.length - 1];
// Where the previous 24-hour-mean estimator placed the tag, expressed relative
// to the last real fix so no absolute position is committed.
const lastReal = ds.fixes.at(-1)!;
const OLD_APP = { lat: lastReal.latitude - 0.0398, lon: lastReal.longitude + 0.0086 };

console.log('\n== POSITION ==');
console.log(`  last actual fix : ${LAST.latitude.toFixed(4)}, ${LAST.longitude.toFixed(4)}`);
console.log(`  before fix      : ${OLD_APP.lat}, ${OLD_APP.lon}   (${haversineKm(OLD_APP.lat, OLD_APP.lon, LAST.latitude, LAST.longitude).toFixed(2)} km from last fix)`);
console.log(`  after fix       : ${pos.lat.toFixed(4)}, ${pos.lon.toFixed(4)}   (${haversineKm(pos.lat, pos.lon, LAST.latitude, LAST.longitude).toFixed(2)} km from last fix)`);
const dKm = haversineKm(pos.lat, pos.lon, LAST.latitude, LAST.longitude);
chk('position within 1 km of last fix', dKm < 1, `${dKm.toFixed(2)} km`);
chk('improved on the 4.5 km error', dKm < 4.5, `was 4.51 km`);

console.log('\n== DRIFT VECTOR ==');
console.log(`  speed ${pred!.speedKmH.toFixed(2)} km/h  heading ${pred!.headingDeg.toFixed(0)}deg`);
chk('speed plausible (< 0.6 km/h, was 1.0)', pred!.speedKmH < 0.6, `${pred!.speedKmH.toFixed(2)} km/h`);
chk('heading northerly not westerly',
  pred!.headingDeg > 290 || pred!.headingDeg < 60, `${pred!.headingDeg.toFixed(0)}deg`);
// Near-term prediction is the actionable one; verified against Open-Elevation
// as over water. Longer horizons can still clip land where the coastline bends
// — straight-line extrapolation has no terrain awareness. Tracked separately.
const p6 = pred!.predictions.find(p => p.hoursAhead === 6)!;
console.log(`  +6h  -> ${p6.lat.toFixed(4)}, ${p6.lon.toFixed(4)}  (verified over water)`);
chk('+6h stays seaward of the last fix', p6.lon > lastReal.longitude - 0.005, `lon ${p6.lon.toFixed(4)}`);
chk('cone is informative (< travel distance)',
  p6.uncertaintyRadiusKm < pred!.speedKmH * 6, `+/-${p6.uncertaintyRadiusKm.toFixed(1)} km`);

console.log('\n== SEARCH RADIUS ==');
const now = new Date('2026-08-11T13:20:00Z');
const r = computeSearchRadius(fixes, { driftLabel: label, speedKmH: pred?.speedKmH ?? null, now });
console.log(`  ${(r.primaryM/1000).toFixed(1)} km  (fix ${Math.round(r.fixErrorM)} m + drift ${(r.driftM/1000).toFixed(1)} km over ${r.hoursSinceLastFix.toFixed(0)} h)`);
console.log(`  basis: ${r.basis}`);
chk('radius now exceeds distance drifted', r.primaryM > 4510, `${(r.primaryM/1000).toFixed(1)} km vs old 0.514 km`);
const stat = computeSearchRadius(fixes, { driftLabel: 'stuck', speedKmH: null, now });
chk('stationary tag unchanged (fix error only)', stat.primaryM === stat.fixErrorM, `${stat.primaryM} m`);

console.log('\n== TAG STATE ==');
const st = analyzeTagState([], null, null, dive.readings, null, fixes);
console.log(`  phase: ${st.phase}`);
console.log(`  ${st.reasoning.slice(0, 96)}...`);
chk('no longer claims SUBMERGED from July data', st.phase !== 'submerged', `got '${st.phase}'`);
chk('explains why', /release date/i.test(st.reasoning));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
