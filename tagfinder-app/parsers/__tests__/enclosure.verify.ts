/**
 * What surrounds a stopped tag: the readings against the air at their own
 * hour (analysis/airMatch), and the messages carried by overhead passes
 * (overheadMessages in analysis/antennaExposure). Both came out of 33938, in
 * a boat lockup at Melbourne Beach, which the site read as "overhead sky still
 * reaching the antenna" and "pattern doesn't match any known environment".
 *
 *   npx tsx parsers/__tests__/enclosure.verify.ts
 */
import { analyzeAirMatch, airAt, type AirSample } from '@/analysis/airMatch';
import { compareTemperatures } from '@/analysis/tempComparison';
import { analyzeAntennaExposure, overheadMessages } from '@/analysis/antennaExposure';
import type { AnnotatedPass, DeploySummary, TagStatus } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(64)} ${detail}`);
};
const air = (rows: [string, number][]): AirSample[] => rows.map(([t, c]) => ({ date: new Date(t), temperatureC: c }));
const tag = (rows: [string, number][]) => rows.map(([t, c]) => ({ date: new Date(t), temperatureC: c }));

// ── 33938: Status readings since the stop, KMLB hourly air (Iowa Mesonet) ──
const KMLB = air([
  ['2026-10-14T21:53Z', 28.33], ['2026-10-14T22:53Z', 27.78],
  ['2026-10-16T13:53Z', 27.78], ['2026-10-16T14:53Z', 27.78], ['2026-10-16T15:53Z', 28.33], ['2026-10-16T16:53Z', 27.78],
  ['2026-10-16T23:53Z', 27.22], ['2026-10-17T00:53Z', 26.67],
  ['2026-10-19T09:53Z', 23.33], ['2026-10-19T10:53Z', 22.78], ['2026-10-19T11:53Z', 22.78],
]);
const T33938 = tag([
  ['2026-10-14T21:53:23Z', 28.7], ['2026-10-16T14:04:18Z', 27.1], ['2026-10-16T15:48:13Z', 27.75],
  ['2026-10-16T23:46:16Z', 28.5], ['2026-10-19T10:39:28Z', 25.0],
]);

console.log('== AIR AT EACH READING ==');
const m = analyzeAirMatch(T33938, KMLB, 28.0304, -80.5448)!;
chk('33938: every reading pairs with the air at its hour', m.pairs.length === 5, `${m.pairs.length}`);
chk('33938: dawn after the front set against 22.8, not the afternoon', Math.abs(m.pairs[4].airC - 22.9) < 0.2, m.pairs[4].airC.toFixed(2));
chk('33938: follows about half the air swing', m.follows !== null && m.follows > 0.4 && m.follows < 0.7, m.follows?.toFixed(2));
chk('33938: buffered (garage, unit, building, cabin)', m.verdict === 'buffered', m.verdict);
chk('33938: says walls and mass, rules out car and AC', /walls and mass/.test(m.reasoning) && /not a car in the sun/.test(m.reasoning));

// The day's air at a shaded open spot: tag within half a degree all day.
const DAY = air([
  ['2026-10-20T06:00Z', 21], ['2026-10-20T10:00Z', 20], ['2026-10-20T14:00Z', 25], ['2026-10-20T18:00Z', 29], ['2026-10-20T22:00Z', 26],
  ['2026-10-21T02:00Z', 23], ['2026-10-20T08:00Z', 20.5], ['2026-10-20T12:00Z', 22], ['2026-10-20T16:00Z', 28], ['2026-10-20T20:00Z', 28], ['2026-10-21T00:00Z', 24],
]);
const open = analyzeAirMatch(tag([['2026-10-20T10:00Z', 20.4], ['2026-10-20T14:00Z', 25.3], ['2026-10-20T18:00Z', 28.6], ['2026-10-21T02:00Z', 23.4]]), DAY);
chk('open air / shade: tracks the air', open?.verdict === 'tracks_air', `${open?.verdict} follows ${open?.follows?.toFixed(2)}`);
const ac = analyzeAirMatch(tag([['2026-10-20T10:00Z', 22.8], ['2026-10-20T14:00Z', 23.1], ['2026-10-20T18:00Z', 23.4], ['2026-10-21T02:00Z', 22.9]]), DAY);
chk('room held at 23 °C while the air swings 9: air conditioning', ac?.verdict === 'climate_controlled', ac?.verdict);
const car = analyzeAirMatch(tag([['2026-10-20T10:00Z', 21], ['2026-10-20T18:00Z', 44], ['2026-10-21T02:00Z', 24]]), DAY, 28.03, -80.54);
chk('44 °C in afternoon sun against 29 air: sun-heated (car, dark box)', car?.verdict === 'sun_heated', car?.verdict);
const two = analyzeAirMatch(tag([['2026-10-20T10:00Z', 22.5], ['2026-10-20T18:00Z', 27]]), DAY);
chk('two readings: no lag verdict yet', two?.verdict === 'unclear' || two?.verdict === 'tracks_air', two?.verdict);
chk('air more than 90 min from any sample does not pair', airAt(KMLB, new Date('2026-10-18T06:00Z')) === null);
chk('air between two samples is interpolated', Math.abs(airAt(KMLB, new Date('2026-10-16T15:23Z'))! - 28.055) < 0.01);

console.log('== TEMPERATURE VERDICT ==');
const summary = { releaseDate: new Date('2026-10-12T00:00Z') } as unknown as DeploySummary;
const status = (t: string, c: number) => ({ date: new Date(t), temperature: c, latitude: null, longitude: null, depth: 0, type: 'Status' }) as unknown as TagStatus;
const afloat = [status('2026-10-13T02:44Z', 28.65), status('2026-10-13T18:45Z', 29.0), status('2026-10-13T20:50Z', 28.9), status('2026-10-14T05:52Z', 28.35), status('2026-10-14T16:19Z', 28.5)];
const ashore = T33938.map((r) => status(r.date.toISOString(), r.temperatureC));
const since = new Date('2026-10-14T21:49Z');
const before = compareTemperatures([], [...afloat, ...ashore], summary, { airTempC: 27.0, sstTempC: 25.0, since });
const after = compareTemperatures([], [...afloat, ...ashore], summary, { airTempC: 27.0, sstTempC: 25.0, since, airMatch: m });
chk('without paired air: the old "unknown"', before.environment === 'unknown', before.environment);
chk('with paired air: insulated / indoors', after.environment === 'in_air_insulated', after.environment);
chk('air figure is the air at the readings, not now', Math.abs((after.airTempC ?? 0) - 26.9) < 0.2, `${after.airTempC}`);
chk('Δ vs air is the mean of the paired deltas', Math.abs((after.tagMinusAir ?? 0) - 0.5) < 0.2, `${after.tagMinusAir}`);
chk('carries the pairs for the card', after.airMatch?.pairs.length === 5);
// A floating tag is buffered by the sea; the air verdict must not move it ashore.
const floating = compareTemperatures([], [...afloat, status('2026-10-15T10:00Z', 28.6), status('2026-10-15T20:00Z', 28.8)], summary, {
  airTempC: 24, sstTempC: 28.7, since: new Date('2026-10-14T21:49Z'),
  airMatch: { ...m, pairs: [{ date: new Date('2026-10-15T10:00Z'), tagC: 28.6, airC: 22, deltaC: 6.6 }] },
});
chk('in the water stays in the water whatever the air says', floating.environment === 'in_water', floating.environment);

console.log('== OVERHEAD PASSES ==');
const p = (el: number, az: number, received: boolean, messages?: number) =>
  ({ maxElevation: el, peakAzimuth: az, received, messages, trackPoints: [] }) as unknown as AnnotatedPass;
// 33938 ashore: nothing below 15°, everything above 50° heard but thin.
const resting = (overMsgs: number) => [
  ...Array.from({ length: 12 }, (_, i) => p(5 + (i % 3) * 3, i * 30, i === 0, 1)),
  ...Array.from({ length: 13 }, (_, i) => p(16 + i, i * 28, i % 3 !== 0, 2)),
  ...Array.from({ length: 10 }, (_, i) => p(32 + i, i * 36, i !== 4, 3)),
  ...Array.from({ length: 6 }, (_, i) => p(55 + i * 5, i * 60, true, overMsgs)),
];
chk('overheadMessages: mean over heard passes above 50°', overheadMessages(resting(3))?.messagesPerPass === 3 && overheadMessages(resting(3))?.n === 6);
const thin = analyzeAntennaExposure(resting(3), { messagesPerPass: 2.7, baselineMessagesPerPass: 7.7, baselineOverheadMessagesPerPass: 11.2 });
chk('thin overhead passes: covered from above', thin.pattern === 'horizon_obstructed' && /lies over the tag/.test(thin.reasoning), thin.pattern);
chk('...and says a flat antenna would not explain it', /flat antenna as well as an upright one/.test(thin.reasoning));
chk('...quoting the afloat overhead count', /against 11\.2 afloat/.test(thin.reasoning));
const full = analyzeAntennaExposure(resting(10), { messagesPerPass: 4.5, baselineMessagesPerPass: 7.7, baselineOverheadMessagesPerPass: 11.2 });
chk('full overhead passes: horizon only, sky still reaching it', /Overhead sky is still reaching/.test(full.reasoning) && !/lies over the tag/.test(full.reasoning));
chk('...and lying on its side is named as a cause', /lying on its side/.test(full.reasoning));
const noBase = analyzeAntennaExposure(resting(2), null);
chk('no afloat record: under four messages overhead still reads as covered', /lies over the tag/.test(noBase.reasoning) && /under the four/.test(noBase.reasoning));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
