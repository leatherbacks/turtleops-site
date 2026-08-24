/** Drift forcing cross-check: a real measured drift vector against live wind/current. */
import { readFileSync } from 'fs';
import { parseArgosDS } from '@/parsers/argos/ds';
import { classifyDrift } from '@/analysis/drift';
import { markOutliers } from '@/analysis/outliers';
import { computePosition } from '@/analysis/position';
import { predictDrift } from '@/analysis/driftPredict';
import { assessDriftForcing, angleDelta } from '@/analysis/driftForcing';
import type { ForcingSample } from '@/lib/types';
import { requireFixture, RAW_DS_TXT } from './fixtures';

let pass = 0, fail = 0;
const chk = (l: string, ok: boolean, d = '') => { ok?pass++:fail++; console.log(`  ${ok?'ok  ':'FAIL'}  ${l.padEnd(46)} ${d}`); };

(async () => {
console.log('\n== ANGLE MATH ==');
chk('355 vs 0 -> 5', angleDelta(355, 0) === 5, `${angleDelta(355,0)}`);
chk('10 vs 350 -> 20', angleDelta(10, 350) === 20, `${angleDelta(10,350)}`);
chk('0 vs 180 -> 180', angleDelta(0, 180) === 180);
chk('90 vs 270 -> 180', angleDelta(90, 270) === 180);

const ds = parseArgosDS(readFileSync(requireFixture(RAW_DS_TXT),'utf8'));
const fixes = ds.fixes;
const p0 = classifyDrift(fixes);
markOutliers(fixes, p0.recent !== 'insufficient' ? p0.recent : p0.allTime);
const d = classifyDrift(fixes);
const label = d.recent !== 'insufficient' ? d.recent : d.allTime;
const pred = predictDrift(fixes)!;
const pos = computePosition(fixes, label);

console.log('\n== FIT WINDOW EXPOSED ==');
console.log(`  ${pred.fitFrom.toISOString()} -> ${pred.fitTo.toISOString()}`);
chk('fit window populated', !isNaN(pred.fitFrom.getTime()) && !isNaN(pred.fitTo.getTime()));
chk('window is ~12h', (pred.fitTo.getTime()-pred.fitFrom.getTime())/3.6e6 <= 12.5);

// Forcing samples are generated around the fit window rather than fetched.
//
// This block used to call open-meteo with past_days=7 relative to the wall
// clock, then assert that the history covered a fit window derived from the
// fixture's own dates. That holds only while the machine's date is within a
// week of the deployment, and silently rots afterwards: run eleven days later,
// four assertions fail because the fetched window no longer reaches the fixture
// and because the shifted-wind case flips only samples "after now", of which
// there are then none. The failures say nothing about the code.
//
// The subject here is assessDriftForcing, not the weather service. Samples are
// synthesised across the fit window with a known current and wind so every
// assertion has a fixed answer, and NOW is pinned to the data instead of to the
// calendar.
const NOW = new Date(pred.fitTo.getTime());
const CURRENT_TOWARD = pred.headingDeg;          // aligned, so agreement is ~0
const CURRENT_KMH = pred.speedKmH / 0.09;        // tag much slower than the water
const samples: ForcingSample[] = [];
for (let h = -7 * 24; h <= 3 * 24; h++) {
  samples.push({
    time: new Date(NOW.getTime() + h * 3_600_000),
    windSpeedMs: 4.5,
    windFromDeg: 110,
    currentKmH: CURRENT_KMH,
    currentTowardDeg: CURRENT_TOWARD,
  });
}
console.log(`\n  ${samples.length} hourly samples, ${samples.filter(s=>s.currentKmH!==null).length} with current`);
chk('fit window is covered by history', samples.some(s => s.time >= pred.fitFrom && s.time <= pred.fitTo));

const f = assessDriftForcing(pred, samples, NOW, 24)!;
console.log('\n== FORCING CHECK ==');
console.log(`  measured drift : ${pred.speedKmH.toFixed(2)} km/h toward ${pred.headingDeg.toFixed(0)}deg`);
if (f.current) console.log(`  model current  : ${f.current.speedKmH.toFixed(2)} km/h toward ${f.current.towardDeg.toFixed(0)}deg`);
if (f.windDuringFit) console.log(`  wind at fit    : ${f.windDuringFit.speedMs.toFixed(1)} m/s from ${f.windDuringFit.fromDeg.toFixed(0)}deg`);
if (f.windAhead) console.log(`  wind ahead     : ${f.windAhead.speedMs.toFixed(1)} m/s from ${f.windAhead.fromDeg.toFixed(0)}deg`);
console.log(`  agreement ${f.currentAgreementDeg?.toFixed(0)}deg   speed ratio ${f.currentSpeedRatio?.toFixed(2)}   confidence ${f.confidence}`);
console.log(`\n  ${f.reasoning}`);

chk('current direction agrees (<45deg)', (f.currentAgreementDeg ?? 999) < 45, `${f.currentAgreementDeg?.toFixed(0)}deg`);
chk('detects tag slower than current', (f.currentSpeedRatio ?? 9) < 0.4, `ratio ${f.currentSpeedRatio?.toFixed(2)}`);
console.log(`  (wind shift ${f.windShiftDeg?.toFixed(0)}deg -> windShifted=${f.windShifted}, confidence ${f.confidence})`);
chk('wind shift is computed', f.windShiftDeg !== null);
chk('confidence is one of the three', ['good','caution','low'].includes(f.confidence), f.confidence);

console.log('\n== STEADY-WIND CASE (synthetic) ==');
const steady: ForcingSample[] = samples.map(s => ({ ...s, windFromDeg: 110, windSpeedMs: 4.5 }));
const f3 = assessDriftForcing(pred, steady, NOW, 24)!;
chk('constant wind -> not shifted', !f3.windShifted, `${f3.windShiftDeg?.toFixed(0)}deg`);
chk('constant wind -> confidence good', f3.confidence === 'good', f3.confidence);

console.log('\n== SHIFTED-WIND CASE (synthetic) ==');
const flipped: ForcingSample[] = samples.map(s => ({
  ...s,
  windFromDeg: s.time > NOW ? ((s.windFromDeg ?? 0) + 150) % 360 : s.windFromDeg,
}));
const f2 = assessDriftForcing(pred, flipped, NOW, 24)!;
chk('detects a wind reversal', f2.windShifted, `${f2.windShiftDeg?.toFixed(0)}deg shift`);
chk('drops confidence to low', f2.confidence === 'low', f2.confidence);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
