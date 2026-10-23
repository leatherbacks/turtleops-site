/**
 * Swallowed, carried or on the seabed — see analysis/fateSignatures.ts.
 *
 * 47128 (Lotek PSAT+, sandbar shark): 32–34.6 °C at 14–21 m on 14 Sep 2026 in
 * 29 °C water, the day before its early release.
 * 40996 (WC MiniPAT, manta): archive from NOAA, floated 20–24 Sep, then 8–18 m
 * in a nor'easter until the archive ended on 26 Sep.
 *
 *   npx tsx parsers/__tests__/fate.verify.ts
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { analyzeFateSignatures, detectWarmBody, classifySubmerged, type FateSample } from '@/analysis/fateSignatures';
import { parseWCArchive, parseArchiveTime } from '@/parsers/wc/archive';
import { detectFile } from '@/parsers/detect';
import { parseSeries } from '@/parsers/wc/series';
import { parseLotekDiveLog } from '@/parsers/lotek/diveLog';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(64)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;
const root = process.env.TAGFINDER_FIXTURES ?? resolve(process.env.HOME ?? '', 'Documents/Apps/tagfinder/data');

console.log('== ARCHIVE FILE ==');
const hdr = ['Time', 'Depth', 'Temperature', 'Light Level', 'Ax', 'Ay', 'Az', 'Dry', 'Aux', 'Events'];
chk('a WC Archive header is recognised', detectFile(new File([''], 'Sheet1.csv'), hdr).fileType === 'wc_archive', detectFile(new File([''], 'x.csv'), hdr).fileType);
chk('Excel serial time', parseArchiveTime('46291.499131944445')?.toISOString() === '2026-09-26T11:58:45.000Z', parseArchiveTime('46291.499131944445')?.toISOString());
chk('WC time string', parseArchiveTime('11:58:45 26-Sep-2026')?.toISOString() === '2026-09-26T11:58:45.000Z');

console.log('== SYNTHETIC ==');
const t0 = Date.UTC(2026, 8, 1);
const synth = (n: number, stepS: number, f: (i: number) => [number, number]): FateSample[] =>
  Array.from({ length: n }, (_, i) => { const [d, c] = f(i); return { date: new Date(t0 + i * stepS * 1000), depth: d, temperature: c }; });
// A diving animal: surface 28 °C, 60 m 18 °C. Coming up warms it by 10 °C over its daily median — but never above the warmest water it visits.
const diver = synth(2 * 288, 300, (i) => { const d = 30 + 30 * Math.sin(i / 6); return [d, 28 - d / 6]; });
chk('a diving animal warming at the surface is not a warm body', detectWarmBody(diver).length === 0);
const lone = diver.map((s, i) => (i === 400 ? { ...s, temperature: 45 } : s));
chk('one corrupt hot reading is not a warm body', detectWarmBody(lone).length === 0);
// Random walk vs white noise at 75 s, after a float.
let walk = 10;
// mulberry32: a fixed, decent stream so the synthetic cases do not depend on luck.
let seed = 7;
const rnd = () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296 - 0.5;
};
const fl = synth(300, 75, () => [0.5, 24]);
const noise = synth(400, 75, () => [12 + rnd() * 3, 23]).map((s) => ({ ...s, date: new Date(s.date.getTime() + 300 * 75_000) }));
chk('white-noise depth after a float reads seabed', classifySubmerged([...fl, ...noise]).stretches[0]?.verdict === 'seabed', classifySubmerged([...fl, ...noise]).stretches[0]?.lag1.toFixed(2));
const swim = synth(400, 75, () => { walk = Math.min(40, Math.max(4, walk + rnd() * 2)); return [walk, 23]; }).map((s) => ({ ...s, date: new Date(s.date.getTime() + 300 * 75_000) }));
chk('a wandering depth after a float reads carried', classifySubmerged([...fl, ...swim]).stretches[0]?.verdict === 'carried', classifySubmerged([...fl, ...swim]).stretches[0]?.lag1.toFixed(2));
chk('no float, no seabed call (still on the animal)', classifySubmerged(noise).stretches.length === 0);

console.log('== 47128 WARM BODY ==');
const dive47128 = resolve(root, 'lotek/47128/47128_Dive_Log.csv');
if (!existsSync(dive47128)) console.log('  (47128 dive log absent)');
else {
  // Portal sheet saved as CSV; depth in tenths of a metre, CRC-checked rows only.
  const rows = csv(dive47128).filter((r) => r.crcStatus === 'OK');
  const seen = new Set<string>();
  const samples: FateSample[] = [];
  for (const r of rows) {
    if (seen.has(r['Date/Time'])) continue;
    seen.add(r['Date/Time']);
    samples.push({ date: new Date(r['Date/Time'].replace(' ', 'T') + 'Z'), depth: parseFloat(r.Depth) / 10, temperature: parseFloat(r.Temperature) });
  }
  samples.sort((a, b) => a.date.getTime() - b.date.getTime());
  const ev = detectWarmBody(samples);
  for (const e of ev) console.log(`        ${e.start.toISOString()} → ${e.end.toISOString()} peak ${e.peakC} water ${e.waterC} +${e.excessC.toFixed(1)}`);
  const hit = ev.find((e) => e.start < new Date('2026-09-14T22:00Z') && e.end > new Date('2026-09-14T17:00Z'));
  chk('47128: warm body on 14 Sep', !!hit);
  chk('47128: peak 34+ °C against ~29 °C water', !!hit && hit.peakC >= 34 && hit.waterC < 30, hit ? `${hit.peakC} vs ${hit.waterC}` : '');
  chk('47128: starts about 16:30Z, lasts 4 h or more', !!hit && hit.start <= new Date('2026-09-14T17:45Z') && hit.end.getTime() - hit.start.getTime() >= 4 * 3600_000);
  chk('47128: no other warm-body events in the record', ev.length === 1, `${ev.length}`);
}

console.log('== 40996 SEABED ==');
const arch40996 = resolve(root, 'wc-40996-archive-post-release/Sheet1.csv');
if (!existsSync(arch40996)) console.log('  (40996 archive absent)');
else {
  const a = parseWCArchive(csv(arch40996));
  chk('40996: archive parses', a.length > 120_000, `${a.length}`);
  const f = analyzeFateSignatures(a.map((s) => ({ date: s.date, depth: s.depth, temperature: s.temperature, light: s.light })), new Date('2026-09-19T20:00Z'))!;
  chk('40996: floating from about 00:30Z 20 Sep', !!f.floatingFrom && Math.abs(f.floatingFrom.getTime() - Date.parse('2026-09-20T00:30Z')) < 3600_000, f.floatingFrom?.toISOString());
  const s = f.submerged[0];
  console.log(`        ${s ? `${s.start.toISOString()} → ${s.end.toISOString()} ${s.depthStart}→${s.depthEnd} m, jitter ${s.jitterM.toFixed(2)}, lag1 ${s.lag1.toFixed(2)} (float ${s.floatLag1?.toFixed(2)}), dark ${s.dark}` : 'none'}`);
  chk('40996: one submerged stretch from 24 Sep ~11:00Z', f.submerged.length === 1 && Math.abs(s.start.getTime() - Date.parse('2026-09-24T11:00Z')) < 2 * 3600_000);
  chk('40996: reads seabed, not carried', s?.verdict === 'seabed', s?.verdict);
  chk('40996: dark through the day', s?.dark === true);
  chk('40996: deepest ~16–18 m, easing back to ~7–9 m', !!s && s.depthPeak >= 15 && s.depthEnd <= 10, s ? `${s.depthPeak} → ${s.depthEnd}` : '');
  chk('40996: no warm body', f.warmBody.length === 0, `${f.warmBody.length}`);
  for (const line of f.summary) console.log(`        ${line}`);
}

console.log('== NO FALSE ALARMS ==');
// 285931 dived into warmer water 30–50 m down (a Gulf winter inversion) and
// came straight back to 22 °C each time it rose: water, not a body.
const dir285931 = resolve(root, 'wc-285931');
if (existsSync(dir285931)) {
  const f = readdirSync(dir285931).find((x) => /-Series\.csv$/.test(x));
  if (f) {
    const s = parseSeries(csv(resolve(dir285931, f)));
    chk('285931: a dive into warmer deep water is not a warm body', detectWarmBody(s.map((r) => ({ date: r.date, depth: r.depth, temperature: r.temperature }))).length === 0);
  }
}
const dive47125 = resolve(root, 'lotek/PSAT+-47125_Dive Log.csv');
if (existsSync(dive47125)) {
  const d = parseLotekDiveLog(csv(dive47125));
  chk('47125: no warm body in a sandbar shark\'s ordinary record', detectWarmBody(d.readings.map((r) => ({ date: r.date, depth: r.depth, temperature: r.temperature }))).length === 0, `${d.readings.length} readings`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
