/**
 * Heat the sun can explain is not an indoor signal. 47127 at noon in July
 * and 40996 mid-morning in October both read hot on open sand and were
 * called "taken indoors"; heat at night or a flat air-conditioned record
 * still is one.
 *
 *   npx tsx parsers/__tests__/sunheat.verify.ts
 */
import { classifyHeat } from '@/analysis/sunHeat';
import { analyzeTagState } from '@/analysis/tagState';
import { compareTemperatures } from '@/analysis/tempComparison';
import type { ArgosFix } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const fix = (iso: string, lat: number, lon: number) => ({ date: new Date(iso), quality: '2', latitude: lat, longitude: lon, errorRadius: 300, semiMajor: 0, semiMinor: 0, orientation: 0, effectiveError: 300, isOutlier: false }) as unknown as ArgosFix;
const st = (iso: string, temp: number) => ({ date: new Date(iso), temperature: temp, depth: 0 }) as never;
const land = (m: number) => ({ elevation: { meters: m, source: 'usgs', classification: 'land' } }) as never;
const summary = { releaseDate: new Date('2026-07-20T00:00:00Z') } as never;

console.log('\n== CLASSIFY HEAT ==');
{
  // 47127: Ocean Ridge, 23 Jul 2026, 06:22 and 12:36 local.
  const h = classifyHeat([{ date: new Date('2026-07-23T10:22:00Z'), temp: 27.6 }, { date: new Date('2026-07-23T16:36:00Z'), temp: 41.6 }], 26.5635, -80.0414);
  chk('47127 noon reading is sunlit', h.sunlitHot, 1);
  chk('...nothing unexplained', h.unexplainedHot, 0);
  chk('...note names the sun', /sun on an exposed surface/.test(h.note ?? ''), true);
  // 40996: Waves NC, 1 Oct 2026, 09:51 and 10:15 local.
  const w = classifyHeat([{ date: new Date('2026-10-01T13:51:00Z'), temp: 36.7 }, { date: new Date('2026-10-01T14:15:00Z'), temp: 40.9 }], 35.5735, -75.465);
  chk('40996 morning readings are sunlit', w.unexplainedHot, 0);
  // Same heat at 02:00 local is not the sun.
  const n = classifyHeat([{ date: new Date('2026-07-23T06:00:00Z'), temp: 38 }], 26.5635, -80.0414);
  chk('38 °C at 02:00 local is unexplained', n.unexplainedHot, 1);
  chk('55 °C at noon is beyond sun on sand', classifyHeat([{ date: new Date('2026-07-23T16:36:00Z'), temp: 55 }], 26.5635, -80.0414).unexplainedHot, 1);
  const ac = classifyHeat(Array.from({ length: 8 }, (_, i) => ({ date: new Date(Date.UTC(2026, 6, 23, i * 3)), temp: 23.5 + (i % 2) * 0.8 })), 26.5635, -80.0414);
  chk('flat low twenties day and night is air-conditioned', ac.airConditioned, true);
  chk('no position: nothing can be blamed on the sun', classifyHeat([{ date: new Date('2026-07-23T16:36:00Z'), temp: 41.6 }], null, null).unexplainedHot, 1);
}

console.log('\n== TAG STATE ==');
{
  // 47127 as the page sees it: on land at 4.9 m, fixes over ~1 km, two readings.
  const fixes = [fix('2026-07-23T12:00:00Z', 26.5631, -80.0414), fix('2026-07-24T12:00:00Z', 26.5660, -80.0420), fix('2026-07-25T12:00:00Z', 26.5640, -80.0380)];
  const statuses = [st('2026-07-23T10:22:00Z', 27.6), st('2026-07-23T16:36:00Z', 41.6)];
  const r = analyzeTagState(statuses, summary, land(4.9), [], null, fixes, null, null, null);
  chk('47127 is not "taken indoors"', r.phase !== 'likely_recovered', true);
  chk('...it is stranded on land', r.phase, 'stranded_on_land');
  chk('...and the reasoning explains the noon reading', /sun on an exposed surface/.test(r.reasoning), true);

  // Same tag, same heat, but at 02:00 local and the fixes within 100 m: indoors.
  const tight = [fix('2026-07-23T12:00:00Z', 26.5631, -80.0414), fix('2026-07-24T12:00:00Z', 26.5632, -80.0415), fix('2026-07-25T12:00:00Z', 26.5631, -80.0416)];
  const night = [st('2026-07-23T06:00:00Z', 38.0), st('2026-07-23T16:36:00Z', 41.6)];
  chk('night heat plus a tight cluster is still indoors', analyzeTagState(night, summary, land(4.9), [], null, tight, null, null, null).phase, 'likely_recovered');

  // Air-conditioned record plus a tight cluster: indoors.
  const acs = Array.from({ length: 8 }, (_, i) => st(new Date(Date.UTC(2026, 6, 23, i * 3)).toISOString(), 23.5 + (i % 2) * 0.8));
  chk('flat 24 °C plus a tight cluster is indoors', analyzeTagState(acs, summary, land(2), [], null, tight, null, null, null).phase, 'likely_recovered');

  // A dune at 4.9 m no longer counts as inland on its own.
  chk('4.9 m with a tight cluster and no heat: not indoors', analyzeTagState([st('2026-07-23T10:22:00Z', 27.6)], summary, land(4.9), [], null, tight, null, null, null).phase !== 'likely_recovered', true);
  chk('12 m with a tight cluster: inland and clustered, indoors', analyzeTagState([st('2026-07-23T10:22:00Z', 27.6)], summary, land(12), [], null, tight, null, null, null).phase, 'likely_recovered');

  // Obstructed reception with a one-sided sky is a wall, not sand over the tag.
  const reception = { verdict: 'obstructed', reasoning: '2.1 messages per pass' } as never;
  const wall = { pattern: 'directional', reasoning: 'Reception is one-sided: a wall to the W.', obstruction: { toward: 'W' } } as never;
  chk('obstructed + one-sided sky: stranded, not buried', analyzeTagState(statuses, summary, land(4.9), [], null, fixes, reception, null, wall).phase, 'stranded_on_land');
  chk('obstructed with no sky verdict: still buried', analyzeTagState(statuses, summary, land(4.9), [], null, fixes, reception, null, null).phase, 'buried');
}

console.log('\n== TEMPERATURE ENVIRONMENT ==');
{
  const statuses = [st('2026-07-23T10:22:00Z', 27.6), st('2026-07-23T16:36:00Z', 41.6)];
  const sunlit = compareTemperatures([], statuses, summary, { airTempC: 30, sstTempC: 30, lat: 26.5635, lon: -80.0414 });
  chk('hot only by day: in air, exposed', sunlit.environment, 'in_air_exposed');
  chk('...says so', /only with the sun up/.test(sunlit.reasoning), true);
  const night = compareTemperatures([], [st('2026-07-23T06:00:00Z', 38.0), st('2026-07-23T16:36:00Z', 41.6)], summary, { airTempC: 30, sstTempC: 30, lat: 26.5635, lon: -80.0414 });
  chk('hot at night: anomalous', night.environment, 'anomalous_hot');
  const noPos = compareTemperatures([], statuses, summary, { airTempC: 30, sstTempC: 30 });
  chk('no position: the old verdict stands', noPos.environment, 'anomalous_hot');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
