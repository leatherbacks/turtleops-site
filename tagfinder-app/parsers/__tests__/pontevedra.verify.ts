/**
 * PSAT+ 47128, 7 Oct 2026: a northeaster moved the tag 41 km in 33 silent
 * hours onto the Ponte Vedra Beach shoreline, and the CLS export of that
 * morning exposed four general defects in the analysis chain. None of them is
 * about beaches; each is about stale fixes or corrupt records and applies to
 * any tag.
 *
 *   1. A drifting tag's position fell back to "the last three quality fixes"
 *      with no age limit and averaged fixes 39 h and 41 km apart — a pin in
 *      open water 28 km from the tag.
 *   2. CRC-8 lets one random payload in 256 through; once the tag began
 *      sending noise, a chance pass dated October 2028 became the only
 *      post-release depth reading and set the tag state to "submerged".
 *   3. The drift projection, fitted over class 2/3 fixes that ended before
 *      the gap, kept projecting from the old position after a newer fix
 *      landed 40 km outside its cone.
 *   4. Reception quality printed "111% of heard passes produced a position".
 *
 * Synthetic checks run everywhere; the real-file checks need the export at
 * data/lotek/47128/47128-cls-messages-2026-10-07.csv (see fixtures.ts).
 *
 *   npx tsx parsers/__tests__/pontevedra.verify.ts
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { parseArgosMessages } from '@/parsers/argos/messages';
import { parseLotekActivityMessages, crc8 } from '@/parsers/lotek/activityMessage';
import { computePosition } from '@/analysis/position';
import { predictDrift } from '@/analysis/driftPredict';
import { analyzeReceptionQuality } from '@/analysis/receptionQuality';
import { classifyDrift } from '@/analysis/drift';
import { detectCarried } from '@/analysis/carried';
import { markOutliers } from '@/analysis/outliers';
import { haversineKm } from '@/lib/haversine';
import { analyzePayloadHealth } from '@/analysis/payloadHealth';
import { sensorDataAge, qualifyForAge } from '@/lib/sensorAge';
import { computeSearchRadius } from '@/analysis/searchRadius';
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
const mkPass = (h: number, msgs: number, lat: number | null) =>
  ({ date: new Date(T0 + h * H), satellite: 'MC', msgCount: msgs, duplicates: 0, corrupt: null, avgInterval: 60, locationQuality: lat === null ? '' : '2', latitude: lat, longitude: lat === null ? null : -81.2, latitude2: null, longitude2: null, frequencyHz: null, powerDbm: null }) as ArgosPass;

console.log('\n== 1. position: the fix-count fallback does not reach across a gap ==');
{
  // Twelve hours of slow drift, a 39 h silence, then one class 1 fix 41 km away.
  const track = [0, 2, 4, 6, 8, 10, 12].map((h) => fix(h, '2', 30.60 - h * 0.004, -81.20));
  const after = [...track, fix(51, '1', 30.188, -81.360, 507)];
  const pos = computePosition(after, 'drifting');
  chk('position is the fresh fix, not a mean with stale ones', haversineKm(pos.lat, pos.lon, 30.188, -81.360) < 0.01, true);
  // Sparse but continuous: fixes 3 h apart still get averaged.
  const sparse = [0, 3, 6].map((h) => fix(h, '2', 30.60 - h * 0.001, -81.20));
  const p2 = computePosition(sparse, 'drifting');
  chk('fixes within six hours are still averaged', p2.lat > 30.594 && p2.lat < 30.600, true);
}

console.log('\n== 2. activity parser: a CRC pass with an impossible clock is dropped ==');
{
  // Build a syntactically perfect 0xA0 message with a valid CRC and a chosen clock.
  const build = (tagSeconds: number) => {
    const b = new Uint8Array(31);
    b[0] = 0xa0;
    b[1] = (tagSeconds >>> 24) & 0xff; b[2] = (tagSeconds >>> 16) & 0xff; b[3] = (tagSeconds >>> 8) & 0xff; b[4] = tagSeconds & 0xff;
    b[5] = 0xe4;
    // three records at 27.0 °C (raw 2350 = 0x92E), depth 10
    for (const off of [6, 9, 12, 16, 19, 22]) { b[off] = 0x92; b[off + 1] = 0xe0; b[off + 2] = 0x00; }
    b[15] = crc8(b.subarray(0, 15));
    return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
  };
  const rx = '2026-10-04 13:41:31';
  const secs = (iso: string) => Math.floor((Date.parse(iso) - Date.UTC(2000, 0, 1)) / 1000);
  const rows = [
    { 'Message date (UTC)': rx, 'Raw data': build(secs('2026-09-10T12:00:00Z')) }, // genuine archive replay
    { 'Message date (UTC)': rx, 'Raw data': build(secs('2028-10-16T18:56:04Z')) }, // clock after reception
    { 'Message date (UTC)': rx, 'Raw data': build(secs('2025-07-13T17:04:14Z')) }, // clock 448 days before reception
  ];
  const r = parseLotekActivityMessages(rows);
  chk('one message kept, two rejected on the clock', [r.records.length > 0, r.clockRejected], [true, 2]);
  chk('kept records all date from 2026', r.records.every((x) => x.date.getUTCFullYear() === 2026), true);
  chk('CRC failures are still counted separately', r.crcFailed, 0);
}

console.log('\n== 3. drift projection: a fit the newest fix contradicts is not reused ==');
{
  const track = [0, 2, 4, 6, 8, 10, 12].map((h) => fix(h, '2', 30.60 - h * 0.004, -81.20));
  const base = predictDrift(track);
  chk('a continuous track still yields a projection', base !== null, true);
  // The next fix, 39 h later, is 41 km away: far outside the cone. One fresh
  // fix cannot be fitted, so there is no projection rather than a stale one.
  const after = [...track, fix(51, '1', 30.188, -81.360, 507)];
  chk('newest fix outside the cone: projection withheld', predictDrift(after), null);
  // Two fresh fixes 1 h apart on a new heading: the refit comes from them.
  const after2 = [...track, fix(50, '1', 30.20, -81.355, 507), fix(51, '1', 30.188, -81.360, 507)];
  const refit = predictDrift(after2);
  chk('two fresh fixes: refit from them alone', refit !== null && refit.fitFrom.getTime() === T0 + 50 * H, true);
  // A newest fix inside the cone leaves the original fit in place.
  const inside = [...track, fix(13, '1', 30.60 - 13 * 0.004, -81.20, 507)];
  const kept = predictDrift(inside);
  chk('newest fix inside the cone: original fit kept', kept !== null && kept.fitTo.getTime() === T0 + 12 * H, true);
}

console.log('\n== 4. reception: location yield never exceeds the passes heard ==');
{
  const passes = Array.from({ length: 10 }, (_, i) => mkPass(i, 5, i % 2 === 0 ? 30.5 : null));
  const r = analyzeReceptionQuality(passes, 14, Array(14).fill('2'));
  chk('yield read from the passes that carry a position', r.locationYield, 0.5);
  const bare = Array.from({ length: 10 }, (_, i) => mkPass(i, 5, null));
  chk('fix count fallback is capped at 100%', analyzeReceptionQuality(bare, 14).locationYield, 1);
}

console.log('\n== 5. drift classifier: windows anchored on the newest position-quality fix ==');
{
  const track = [0, 2, 4, 6, 8, 10, 12, 24, 30, 36].map((h) => fix(h, '2', 30.60 - h * 0.004, -81.20));
  const after = [...track, fix(75, '1', 30.188, -81.360, 507)];
  const d = classifyDrift(after);
  chk('one fresh fix: last 24 h reads insufficient, not the old track', d.recent, 'insufficient');
  chk('...all-time still drifting', d.allTime, 'drifting');
  const sr = computeSearchRadius(after, { driftLabel: 'drifting', speedKmH: null, now: new Date(T0 + 76 * H) });
  chk('radius basis does not call a drifting tag "not drifting"', /not drifting/.test(sr.basis), false);
}

console.log('\n== 6. sensor age: a week-old temperature is dated, not current ==');
{
  const fixes = [fix(0, '2', 30.6, -81.2), fix(200, '1', 30.188, -81.360, 507)];
  const series = [{ date: new Date(T0 + 10 * H), depth: null, depthRange: null, temperature: 27.1, temperatureRange: null }];
  const age = sensorDataAge(series as never, [], new Date(T0 - H), fixes);
  chk('age measured against the newest fix', age && Math.round(age.hoursBeforeLastFix), 190);
  chk('...and flagged stale', age?.stale, true);
  const q = qualifyForAge({ environment: 'in_water', reasoning: 'matches SST' } as never, age);
  chk('verdict keeps its answer and gains the date', [(q as any).environment, (q as any).staleHours], ['in_water', 190]);
  const fresh = sensorDataAge(series as never, [], new Date(T0 - H), [fix(0, '2', 30.6, -81.2), fix(11, '2', 30.6, -81.2)]);
  chk('an hour behind the newest fix is not stale', fresh?.stale, false);
}

console.log('\n== 7. payload health from the checksums ==');
{
  const daily: Record<string, { passed: number; failed: number; clockRejected: number }> = {};
  for (let d = 1; d <= 5; d++) daily[`2026-10-0${d}`] = { passed: 60, failed: 50, clockRejected: 0 };
  daily['2026-10-06'] = { passed: 1, failed: 300, clockRejected: 1 };
  daily['2026-10-07'] = { passed: 0, failed: 120, clockRejected: 0 };
  const h = analyzePayloadHealth(daily)!;
  chk('unreadable since the day the rate collapsed', [h.verdict, h.unreadableSince, h.lastReadableDay], ['unreadable', '2026-10-06', '2026-10-05']);
  const ok = analyzePayloadHealth({ '2026-10-01': { passed: 60, failed: 50, clockRejected: 0 } })!;
  chk('a healthy tag reads readable', ok.verdict, 'readable');
  chk('a thin day cannot flip the verdict', analyzePayloadHealth({ ...daily, '2026-10-08': { passed: 3, failed: 2, clockRejected: 0 } })!.verdict, 'unreadable');
}

const real = fixture(/47128-cls-messages-2026-10-07\.csv$/);
if (real) {
  console.log(`\n== REAL: ${real} ==`);
  const rows = Papa.parse<Record<string, string>>(readFileSync(real, 'utf8'), { header: true, skipEmptyLines: true }).data;
  const am = parseArgosMessages(rows);
  const act = parseLotekActivityMessages(rows);
  const now = Date.now();
  chk('no verified activity record dated after reception or before 2026', act.records.filter((r) => r.date.getTime() > now || r.date.getUTCFullYear() < 2026).length, 0);
  chk('chance CRC passes rejected on the clock', act.clockRejected >= 2, true);
  const fixes = am.fixes;
  const prelim = classifyDrift(fixes);
  const carried = detectCarried(fixes);
  const label = prelim.recent !== 'insufficient' ? prelim.recent : prelim.allTime;
  markOutliers(fixes, label === 'insufficient' ? 'stuck' : label);
  chk('the 41 km storm run is not an outlier', fixes.filter((f) => f.isOutlier).length, 0);
  chk('...and is not "carried"', carried.verdict, 'none');
  const drift = classifyDrift(fixes);
  const finalLabel = drift.recent !== 'insufficient' ? drift.recent : drift.allTime;
  const pos = computePosition(fixes, finalLabel === 'insufficient' ? 'stuck' : finalLabel);
  chk('best position within 1 km of the 7 Oct class 1 fix', haversineKm(pos.lat, pos.lon, 30.18837, -81.36016) < 1, true);
  const pred = predictDrift(fixes);
  chk('no projection from the pre-storm fit', pred === null || pred.fitTo.getTime() >= Date.UTC(2026, 9, 7), true);
  const located = fixes.filter((f) => !f.isOutlier);
  const rq = analyzeReceptionQuality(am.passes, located.length, located.map((f) => f.quality));
  chk('location yield is a fraction', rq.locationYield !== null && rq.locationYield <= 1, true);
  chk('drift: last 24 h is insufficient, not "drifting 12 km" from 5-6 Oct', drift.recent, 'insufficient');
  const ph = analyzePayloadHealth(act.daily)!;
  chk('payloads unreadable since 3 or 4 Oct', [ph.verdict, ph.unreadableSince], ['unreadable', '2026-10-04']);
  chk('...after a readable record through 3 Oct', ph.lastReadableDay, '2026-10-03');
} else {
  console.log('\n(real 47128 export not present; synthetic checks only)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
