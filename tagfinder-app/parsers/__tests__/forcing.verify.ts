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

// live data
const url = `https://api.open-meteo.com/v1/forecast?latitude=${pos.lat}&longitude=${pos.lon}&hourly=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&past_days=7&forecast_days=3&timezone=UTC`;
const murl = `https://marine-api.open-meteo.com/v1/marine?latitude=${pos.lat}&longitude=${pos.lon}&hourly=ocean_current_velocity,ocean_current_direction&past_days=7&forecast_days=3&timezone=UTC`;
const [w, m] = await Promise.all([fetch(url).then(r=>r.json()), fetch(murl).then(r=>r.json()).catch(()=>null)]);
const ci = new Map<string, number>((m?.hourly?.time ?? []).map((t: string, i: number) => [t, i]));
const samples: ForcingSample[] = (w.hourly.time as string[]).map((t, i) => {
  const j = ci.get(t);
  return {
    time: new Date(t + 'Z'),
    windSpeedMs: w.hourly.wind_speed_10m[i] ?? null,
    windFromDeg: w.hourly.wind_direction_10m[i] ?? null,
    currentKmH: j !== undefined ? m.hourly.ocean_current_velocity[j] ?? null : null,
    currentTowardDeg: j !== undefined ? m.hourly.ocean_current_direction[j] ?? null : null,
  };
});
console.log(`\n  ${samples.length} hourly samples, ${samples.filter(s=>s.currentKmH!==null).length} with current`);
chk('fit window is covered by history', samples.some(s => s.time >= pred.fitFrom && s.time <= pred.fitTo));

const f = assessDriftForcing(pred, samples, new Date(), 24)!;
console.log('\n== FORCING CHECK ==');
console.log(`  measured drift : ${pred.speedKmH.toFixed(2)} km/h toward ${pred.headingDeg.toFixed(0)}deg`);
if (f.current) console.log(`  model current  : ${f.current.speedKmH.toFixed(2)} km/h toward ${f.current.towardDeg.toFixed(0)}deg`);
if (f.windDuringFit) console.log(`  wind at fit    : ${f.windDuringFit.speedMs.toFixed(1)} m/s from ${f.windDuringFit.fromDeg.toFixed(0)}deg`);
if (f.windAhead) console.log(`  wind ahead     : ${f.windAhead.speedMs.toFixed(1)} m/s from ${f.windAhead.fromDeg.toFixed(0)}deg`);
console.log(`  agreement ${f.currentAgreementDeg?.toFixed(0)}deg   speed ratio ${f.currentSpeedRatio?.toFixed(2)}   confidence ${f.confidence}`);
console.log(`\n  ${f.reasoning}`);

chk('current direction agrees (<45deg)', (f.currentAgreementDeg ?? 999) < 45, `${f.currentAgreementDeg?.toFixed(0)}deg`);
chk('detects tag slower than current', (f.currentSpeedRatio ?? 9) < 0.4, `ratio ${f.currentSpeedRatio?.toFixed(2)}`);
// Deliberately NOT asserting the live wind is steady — it is a forecast and it
// moves. This test failed once because the model updated between runs, which is
// the data changing, not the code. Wind-shift logic is checked synthetically
// below, where the input is fixed.
console.log(`  (live wind shift ${f.windShiftDeg?.toFixed(0)}deg -> windShifted=${f.windShifted}, confidence ${f.confidence})`);
chk('wind shift is computed', f.windShiftDeg !== null);
chk('confidence is one of the three', ['good','caution','low'].includes(f.confidence), f.confidence);

console.log('\n== STEADY-WIND CASE (synthetic) ==');
const steady: ForcingSample[] = samples.map(s => ({ ...s, windFromDeg: 110, windSpeedMs: 4.5 }));
const f3 = assessDriftForcing(pred, steady, new Date(), 24)!;
chk('constant wind -> not shifted', !f3.windShifted, `${f3.windShiftDeg?.toFixed(0)}deg`);
chk('constant wind -> confidence good', f3.confidence === 'good', f3.confidence);

console.log('\n== SHIFTED-WIND CASE (synthetic) ==');
const flipped: ForcingSample[] = samples.map(s => ({
  ...s,
  windFromDeg: s.time > new Date() ? ((s.windFromDeg ?? 0) + 150) % 360 : s.windFromDeg,
}));
const f2 = assessDriftForcing(pred, flipped, new Date(), 24)!;
chk('detects a wind reversal', f2.windShifted, `${f2.windShiftDeg?.toFixed(0)}deg shift`);
chk('drops confidence to low', f2.confidence === 'low', f2.confidence);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
})();
