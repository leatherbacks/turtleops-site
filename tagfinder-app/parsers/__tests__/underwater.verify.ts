/**
 * Underwater after release, from the transmitted SST records —
 * analysis/underwaterAfterRelease.ts.
 *
 * 40996 sank fouled in a nor'easter; its 25 Sep SST was taken at 4.5 m.
 * Every other tag's post-release SST was at the surface.
 *
 *   npx tsx parsers/__tests__/underwater.verify.ts
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { parseSST } from '@/parsers/wc/sst';
import { parseLightLoc } from '@/parsers/wc/lightLoc';
import { parseSummary } from '@/parsers/wc/summary';
import { effectiveRelease } from '@/lib/release';
import { analyzeUnderwaterAfterRelease } from '@/analysis/underwaterAfterRelease';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(64)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;
const root = process.env.TAGFINDER_FIXTURES ?? resolve(process.env.HOME ?? '', 'Documents/Apps/tagfinder/data');

const run = (dir: string) => {
  const d = resolve(root, dir);
  if (!existsSync(d)) return undefined;
  const files = readdirSync(d);
  const f = (suffix: string) => files.find((x) => x.endsWith(suffix));
  const sstF = f('-SST.csv'), sumF = f('-Summary.csv'), llF = f('-LightLoc.csv');
  if (!sstF || !sumF) return undefined;
  const summary = parseSummary(csv(resolve(d, sumF)));
  return analyzeUnderwaterAfterRelease(parseSST(csv(resolve(d, sstF))), llF ? parseLightLoc(csv(resolve(d, llF))) : [], effectiveRelease(summary));
};

console.log('== SYNTHETIC ==');
const rel = new Date('2026-09-19T20:00:00Z');
const s = (iso: string, depth: number, source = 'Transmission') => ({ date: new Date(iso), depth, temperature: 23, source });
chk('a surface SST after release: nothing', analyzeUnderwaterAfterRelease([s('2026-09-25T07:00Z', 0)], [], rel) === null);
chk('a deep SST in the first 12 h (still on the animal): nothing', analyzeUnderwaterAfterRelease([s('2026-09-20T02:00Z', 15)], [], rel) === null);
chk('a deep Lotek SST: nothing (Lotek depth is meaningless after release)', analyzeUnderwaterAfterRelease([s('2026-09-25T07:00Z', 9, 'lotek-sst')], [], rel) === null);
chk('no release date: nothing', analyzeUnderwaterAfterRelease([s('2026-09-25T07:00Z', 9)], [], null) === null);
chk('a 4.5 m SST five days out: underwater', analyzeUnderwaterAfterRelease([s('2026-09-25T07:00Z', 4.5)], [], rel)?.readings.length === 1);

console.log('== 40996 ==');
const f40996 = run('wc-40996-2026-10-02');
if (f40996 === undefined) console.log('  (absent)');
else {
  chk('40996: the 25 Sep 4.5 m record is found', f40996?.readings.length === 1 && f40996.readings[0].depthM === 4.5, JSON.stringify(f40996?.readings.map((r) => r.depthM)));
  chk('40996: both 25 Sep twilight curves are flat (dark at depth)', f40996?.darkCurves.length === 2, `${f40996?.darkCurves.map((c) => `${c.type} ${c.min}-${c.max}`)}`);
  chk('40996: says sunk and when to look', !!f40996 && /sunk or held under/.test(f40996.reasoning) && /onshore/.test(f40996.reasoning));
  console.log(`        ${f40996?.reasoning}`);
}

console.log('== NO FALSE ALARMS ==');
for (const dir of readdirSync(root).filter((x) => x.startsWith('wc-') && !x.startsWith('wc-40996'))) {
  const r = run(dir);
  if (r === undefined) continue;
  chk(`${dir}: nothing underwater after release`, r === null, r ? JSON.stringify(r.readings) : '');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
