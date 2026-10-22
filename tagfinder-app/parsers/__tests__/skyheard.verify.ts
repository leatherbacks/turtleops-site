/**
 * Where on each pass the tag got through, and which satellites can hear it.
 *
 * MiniPAT 33938 sat a week in a boat lockup at Melbourne Beach. The sky chart
 * drew every heard pass as a whole green arc and looked like open sky; its
 * messages in fact arrived only near the top of each pass. The report's next
 * reception was a Kinéis satellite the account cannot hear, and OTB-3 Gazelle
 * ("CS"), which heard it 30 times, matched nothing.
 *
 *   npx tsx parsers/__tests__/skyheard.verify.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { predictPassesInWindow } from '@/analysis/satPrediction';
import { analyzeSatCoverage, normalizeSatName } from '@/analysis/satCoverage';
import { parseArgos } from '@/parsers/wc/argos';
import { parseWCRawArgosTimes } from '@/parsers/wc/rawArgos';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(64)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;

chk('"CS" is OTB-3 Gazelle', normalizeSatName('CS') === 'OTB-3-GAZELLE' && normalizeSatName('OTB-3-GAZELLE') === 'OTB-3-GAZELLE');

const root = process.env.TAGFINDER_FIXTURES ?? resolve(process.env.HOME ?? '', 'Documents/Apps/tagfinder/data');
const dir = resolve(root, 'wc-33938-2026-10-21c');
const tleFile = resolve(dir, 'celestrak-argos-tles-2026-10-21.txt');
if (!existsSync(tleFile)) {
  console.log('  (33938 export or TLE snapshot absent)');
} else {
  const lines = readFileSync(tleFile, 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
  const tles = [];
  for (let i = 0; i + 2 < lines.length + 1; i += 3) tles.push({ name: lines[i], line1: lines[i + 1], line2: lines[i + 2] });
  const passes = parseArgos(csv(resolve(dir, '33938-Argos.csv')));
  const messages = parseWCRawArgosTimes(csv(resolve(dir, '33938-RawArgos.csv')));
  // Resting, from landfall; TLEs of 21 Oct hold well for a week back.
  const start = new Date('2026-10-14T21:49:00Z'), end = new Date('2026-10-21T12:15:00Z');
  const predicted = predictPassesInWindow(tles, 28.0304, -80.5447, start, end);
  const cov = analyzeSatCoverage(predicted, passes.filter((p) => p.date >= start), messages);

  const gaz = cov.passes.filter((p) => p.satelliteName === 'OTB-3-GAZELLE');
  chk('Gazelle passes predicted and heard', gaz.some((p) => p.received), `${gaz.filter((p) => p.received).length}/${gaz.length}`);

  const heard = cov.passes.filter((p) => p.received && (p.heardPoints?.length ?? 0) > 0);
  const received = cov.passes.filter((p) => p.received);
  chk('most heard passes have their messages placed on the arc', heard.length >= 0.8 * received.length, `${heard.length}/${received.length}`);

  // Messages arrive high: compare their elevation with the arc's own spread.
  const msgEl = heard.flatMap((p) => p.heardPoints!.map((h) => h.elevation)).sort((a, b) => a - b);
  const arcEl = heard.flatMap((p) => p.trackPoints.map((t) => t.elevation)).sort((a, b) => a - b);
  const med = (a: number[]) => a[Math.floor(a.length / 2)];
  console.log(`        message elevation median ${med(msgEl).toFixed(0)}° vs arc ${med(arcEl).toFixed(0)}°; ${msgEl.filter((e) => e < 15).length} of ${msgEl.length} messages below 15°`);
  chk('messages sit higher on the arcs than the arcs run', med(msgEl) > med(arcEl) + 10);
  chk('few messages below 15° (walled in all round)', msgEl.filter((e) => e < 15).length < 0.1 * msgEl.length);
  chk('a heard point lies on its own pass (within the arc)', heard.every((p) => p.heardPoints!.every((h) => h.elevation >= 0 && h.elevation <= p.maxElevation + 0.5)));

  const missed = cov.passes.filter((p) => !p.received);
  chk('missed passes carry no heard points', missed.every((p) => p.heardPoints === undefined));
  const noTimes = analyzeSatCoverage(predicted, passes.filter((p) => p.date >= start));
  chk('without message times nothing is placed (chart falls back to whole arcs)', noTimes.passes.every((p) => p.heardPoints === undefined));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
