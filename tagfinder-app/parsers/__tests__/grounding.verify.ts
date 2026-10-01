/**
 * The out-of-the-water rule: a tag that stops moving and stops resolving
 * while still being heard has grounded. Synthetic cases, then the real
 * exports — 47125 as a live user would have had it on 10 Aug (grounded), the
 * full 47125 record (moved again, not grounded), two floating controls, and
 * 47127 with no adrift baseline (insufficient).
 *
 *   npx tsx parsers/__tests__/grounding.verify.ts
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { detectGrounding } from '@/analysis/grounding';
import { analyzeTagState } from '@/analysis/tagState';
import { parseArgosMessages } from '@/parsers/argos/messages';
import { parseLotekArgosContainer } from '@/parsers/lotek/argosContainer';
import { parseArgos } from '@/parsers/wc/argos';
import { parseLocations } from '@/parsers/wc/locations';
import type { ArgosFix, ArgosPass } from '@/lib/types';
import { fixture } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;
const T0 = Date.UTC(2026, 7, 7), H = 3600_000;
const mkPass = (h: number) => ({ date: new Date(T0 + h * H), satellite: 'MC', msgCount: 5, duplicates: 0, corrupt: null, avgInterval: 60, locationQuality: '3', latitude: null, longitude: null, latitude2: null, longitude2: null, frequencyHz: null, powerDbm: null }) as unknown as ArgosPass;
const mkFix = (h: number, q: string, lat: number, lon: number) => ({ date: new Date(T0 + h * H), quality: q, latitude: lat, longitude: lon, errorRadius: 300, semiMajor: 0, semiMinor: 0, orientation: 0, effectiveError: 300, isOutlier: false }) as unknown as ArgosFix;

console.log('\n== SYNTHETIC ==');
{
  // Drifts 10 km north over 72 h resolving every pass, then sits still with
  // passes continuing and no fixes for 60 h.
  const passes: ArgosPass[] = [], fixes: ArgosFix[] = [];
  for (let h = 0; h < 132; h += 1.5) {
    passes.push(mkPass(h));
    if (h < 72) fixes.push(mkFix(h, '2', 25.8 + (h / 72) * 0.09, -80.1));
  }
  const g = detectGrounding(fixes, passes, null);
  chk('beached: grounded', g.verdict, 'grounded');
  chk('...since the last quality fix', g.groundedSince?.toISOString().slice(0, 13), '2026-08-09T22');
  chk('...reference yield about 1 per pass', (g.reference?.qualityFixesPerPass ?? 0) > 0.95, true);
  const st = analyzeTagState([], { releaseDate: new Date(T0 - H) } as never, null, [], null, fixes, null, g);
  chk('tag state becomes stranded_on_land', st.phase, 'stranded_on_land');
  chk('...with the grounding reasoning', /Out of the water since/.test(st.reasoning), true);

  // Same tag, still drifting and resolving: nothing to report.
  const p2: ArgosPass[] = [], f2: ArgosFix[] = [];
  for (let h = 0; h < 132; h += 1.5) { p2.push(mkPass(h)); f2.push(mkFix(h, '2', 25.8 + (h / 132) * 0.2, -80.1)); }
  chk('drifting: not grounded', detectGrounding(f2, p2, null).verdict, 'not_grounded');

  // Yield collapses but the fixes that remain still move 5 km: not grounded.
  const p3: ArgosPass[] = [], f3: ArgosFix[] = [];
  for (let h = 0; h < 132; h += 1.5) { p3.push(mkPass(h)); if (h < 72) f3.push(mkFix(h, '2', 25.8 + (h / 72) * 0.09, -80.1)); else if (h % 12 < 1) f3.push(mkFix(h, 'B', 25.9 + ((h - 72) / 60) * 0.05, -80.1)); }
  chk('collapsed yield but still moving: not grounded', detectGrounding(f3, p3, null).verdict, 'not_grounded');

  // Passes thin to one a day after the drift: cannot be read as grounding.
  const p4: ArgosPass[] = [], f4: ArgosFix[] = [];
  for (let h = 0; h < 72; h += 1.5) { p4.push(mkPass(h)); f4.push(mkFix(h, '2', 25.8 + (h / 72) * 0.09, -80.1)); }
  for (let h = 72; h < 132; h += 24) p4.push(mkPass(h));
  chk('transmissions thinning: insufficient', detectGrounding(f4, p4, null).verdict, 'insufficient');

  // Never adrift (popped on the beach): no baseline.
  const p5: ArgosPass[] = [], f5: ArgosFix[] = [];
  for (let h = 0; h < 132; h += 1.5) { p5.push(mkPass(h)); if (h % 6 < 1) f5.push(mkFix(h, 'B', 25.8, -80.1)); }
  chk('no adrift reference: insufficient', detectGrounding(f5, p5, null).verdict, 'insufficient');
  chk('too few passes: insufficient', detectGrounding([], p5.slice(0, 5), null).verdict, 'insufficient');
  chk('a submerged verdict is not overridden', analyzeTagState([], { releaseDate: new Date(T0 - H) } as never, null, [
    { date: new Date(T0 + 100 * H), depth: 12, temperature: 20 }, { date: new Date(T0 + 101 * H), depth: 13, temperature: 20 }, { date: new Date(T0 + 102 * H), depth: 12, temperature: 20 },
  ] as never, null, fixes, null, g).phase, 'submerged');
}

const f47125 = fixture('47125-cls-messages-2026-10-01.csv');
if (f47125) {
  console.log('\n== PSAT+ 47125 — AS SEEN ON 10 AUG 15:00 UTC ==');
  const m = parseArgosMessages(csv(f47125));
  const until = Date.parse('2026-08-10T15:00:00Z');
  // Release date as the hook derives it for a Lotek tag: the first health
  // message, 7 Aug 13:26, ten hours after the first Argos message.
  const g = detectGrounding(m.fixes.filter((f) => f.date.getTime() <= until), m.passes.filter((p) => p.date.getTime() <= until), new Date('2026-08-07T13:26:21Z'));
  console.log('        ' + g.reasoning);
  chk('grounded', g.verdict, 'grounded');
  chk('since the last class 1-3 fix, 8 Aug 15:21', g.groundedSince?.toISOString().slice(0, 16), '2026-08-08T15:21');
  chk('reference adrift yield above 0.6', (g.reference?.qualityFixesPerPass ?? 0) > 0.6, true);
  chk('recent yield below 0.1 (the 48 h window catches the landing itself)', (g.recent?.qualityFixesPerPass ?? 1) < 0.1, true);
  chk('passes continued (>= 30/day)', (g.recent?.passesPerDay ?? 0) >= 30, true);
  console.log('\n== PSAT+ 47125 — FULL RECORD TO 13 AUG (moved to a balcony, then Miami) ==');
  const full = detectGrounding(m.fixes, m.passes, new Date('2026-08-07T03:00:00Z'));
  console.log('        ' + full.reasoning);
  chk('not grounded at the end of the record', full.verdict, 'not_grounded');
} else console.log('\n  (47125 fixture absent)');

const f47128 = fixture('PID047128_TagID49319_PsatPlus_LVS.bin');
if (f47128) {
  console.log('\n== PSAT+ 47128 — AFLOAT CONTROL ==');
  const b = readFileSync(f47128);
  const c = parseLotekArgosContainer(new Uint8Array(b.buffer, b.byteOffset, b.byteLength));
  const g = detectGrounding(c.fixes, c.passes, null);
  console.log('        ' + g.reasoning);
  chk('not grounded', g.verdict, 'not_grounded');
} else console.log('\n  (47128 fixture absent)');

const loc41008 = fixture('41008-Locations.csv'), arg41008 = fixture('41008-Argos.csv');
if (loc41008 && arg41008) {
  console.log('\n== MiniPAT 41008 — AFLOAT CONTROL, THREE DAYS ==');
  const g = detectGrounding(parseLocations(csv(loc41008)), parseArgos(csv(arg41008)), new Date('2026-08-09T20:00:00Z'));
  console.log('        ' + g.reasoning);
  chk('never called grounded', g.verdict !== 'grounded', true);
} else console.log('\n  (41008 fixtures absent)');

const f47127 = fixture('47127-cls-messages-2026-10-01.csv');
if (f47127) {
  console.log('\n== PSAT+ 47127 — BEACHED WITHIN A DAY, NO ADRIFT BASELINE ==');
  const m = parseArgosMessages(csv(f47127));
  const g = detectGrounding(m.fixes, m.passes, new Date('2026-07-20T00:00:00Z'));
  console.log('        ' + g.reasoning);
  chk('insufficient, not a false negative dressed as afloat', g.verdict, 'insufficient');
} else console.log('\n  (47127 fixture absent)');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
