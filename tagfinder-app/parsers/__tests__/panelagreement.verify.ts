/**
 * The panels agree with each other once the tag has stopped.
 *
 * The 16 Oct 2026 report on MiniPAT 33938, after the resting-position and
 * light fixes, still read Tag State BURIED at a residential lot, and the sky
 * view called the antenna "relatively exposed" beside an Antenna Exposure
 * panel reading 2.4 messages a pass against 7.7 afloat.
 *
 *   npx tsx parsers/__tests__/panelagreement.verify.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { analyzeTagState } from '@/analysis/tagState';
import { analyzeReceptionQuality } from '@/analysis/receptionQuality';
import { analyzeAntennaExposure } from '@/analysis/antennaExposure';
import { restingSince } from '@/analysis/restingPeriod';
import { parseLocations } from '@/parsers/wc/locations';
import { parseArgos } from '@/parsers/wc/argos';
import { parseStatus } from '@/parsers/wc/status';
import { parseSummary } from '@/parsers/wc/summary';
import type { AnnotatedPass } from '@/lib/types';
import { findContradiction } from '@/lib/briefGuard';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(60)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;

console.log('\n== SKY VIEW: EVEN SKY, THIN PASSES ==');
{
  // Two thirds heard from every direction and elevation.
  const even: AnnotatedPass[] = Array.from({ length: 30 }, (_, i) =>
    ({ maxElevation: 10 + (i * 7) % 75, peakAzimuth: (i * 47) % 360, received: i % 3 !== 0, trackPoints: [] }) as unknown as AnnotatedPass);
  const bare = analyzeAntennaExposure(even);
  chk('without a message rate: clear, as before', bare.pattern === 'clear', bare.pattern);
  const thin = analyzeAntennaExposure(even, { messagesPerPass: 2.4, baselineMessagesPerPass: 7.7 });
  chk('2.4 a pass against 7.7 afloat: covered all round, shown', thin.pattern === 'covered_all_round' && /cover all round/.test(thin.reasoning), thin.pattern);
  const full = analyzeAntennaExposure(even, { messagesPerPass: 7.1, baselineMessagesPerPass: 7.7 });
  chk('7.1 against 7.7: still clear', full.pattern === 'clear', full.pattern);
}

console.log('\n== BRIEF GUARD: NEGATED CLAIMS ==');
{
  const ashore = { tagState: { phase: 'likely_recovered' } };
  const real =
    "**Headline: the tag is OUT OF THE WATER and almost certainly in somebody's possession — it is sitting at a residence. Do not plan a boat.**\n\n" +
    'The tag is not afloat and is not drifting. It stopped dead on 14 October at 21:49 UTC and has not moved since.';
  chk('33938 16 Oct brief ("is not afloat"): no contradiction', findContradiction(real, ashore) === null, String(findContradiction(real, ashore)));
  chk('"the tag is afloat": contradiction', findContradiction('Headline: the tag is afloat off the beach.', ashore) !== null);
  chk('"no longer afloat, but search by boat": still caught', findContradiction('It is no longer afloat. Search by boat at first light.', ashore) !== null);
  const afloat = { tagState: { phase: 'surface' } };
  chk('"not stranded" with an afloat verdict: no contradiction', findContradiction('The tag is not stranded; it floats 2 km off.', afloat) === null);
}

const dir = process.env.HOME && resolve(process.env.HOME, 'Documents/Apps/tagfinder/data/wc-33938-2026-10-16');
if (dir && existsSync(dir)) {
  console.log('\n== MiniPAT 33938 — TAG STATE WITH THE ENVIRONMENT ==');
  const fixes = parseLocations(csv(resolve(dir, '33938-Locations.csv')));
  const since = restingSince(fixes);
  const located = fixes.filter((f) => !since || f.date >= since);
  const rq = analyzeReceptionQuality(parseArgos(csv(resolve(dir, '33938-Argos.csv'))), located.length, located.map((f) => f.quality), { since });
  const statuses = parseStatus(csv(resolve(dir, '33938-Status.csv')));
  const summary = parseSummary(csv(resolve(dir, '33938-Summary.csv')));
  const env = (kind: string) => ({
    elevation: { meters: 1.05, classification: 'land', source: 'test' },
    location: { name: 'Brevard County, FL', place: { name: null, kind, category: 'building', type: 'house' } },
  }) as never;
  const house = analyzeTagState(statuses, summary, env('residence'), [], null, fixes, rq, null, null, null);
  console.log('        ' + house.reasoning.slice(0, 160) + '…');
  chk('covered at a house: likely recovered, not buried', house.phase === 'likely_recovered', house.phase);
  const beach = analyzeTagState(statuses, summary, env('beach'), [], null, fixes, rq, null, null, null);
  chk('covered on a beach: still buried', beach.phase === 'buried', beach.phase);
} else console.log('\n  (wc-33938-2026-10-16 absent)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
