/**
 * Hours dry from the tag's own transmission counter — analysis/transmitCounter.ts.
 *
 * 33938 (MiniPAT, manta): a week in a boat lockup at Melbourne Beach from
 * 14 Oct 21:49Z, counting about 60 an hour (dry) while satellites heard little.
 * 40996 (MiniPAT, manta): on a camper table 1–2 Oct.
 *
 *   npx tsx parsers/__tests__/txcounter.verify.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { parseStatus } from '@/parsers/wc/status';
import { parseWCRawArgosTimes } from '@/parsers/wc/rawArgos';
import { estimateRepetitionRate } from '@/analysis/repetitionRate';
import { analyzeTransmitCounter } from '@/analysis/transmitCounter';
import type { TagStatus } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(64)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;
const root = process.env.TAGFINDER_FIXTURES ?? resolve(process.env.HOME ?? '', 'Documents/Apps/tagfinder/data');

console.log('== SYNTHETIC ==');
const st = (h: number, n: number): TagStatus => ({ date: new Date(Date.UTC(2026, 9, 1) + h * 3600e3), latitude: null, longitude: null, temperature: null, depth: null, type: 'CRC', wetDry: null, minWetDry: null, maxWetDry: null, transmits: n });
const wet = analyzeTransmitCounter([st(0, 320), st(12, 320), st(30, 448)], [], 60);
chk('counter barely moving over 30 h reads wet', wet?.latest?.verdict === 'wet', `${wet?.latest?.verdict} ${wet?.latest?.dryFraction?.toFixed(2)}`);
chk('...and says the silence is water', !!wet && /silence here is water/.test(wet.reasoning));
const dry = analyzeTransmitCounter([st(0, 1000), st(10, 1640), st(24, 2440)], [], 60);
chk('60 an hour reads dry', dry?.latest?.verdict === 'dry', `${dry?.latest?.dryFraction?.toFixed(2)}`);
const short = analyzeTransmitCounter([st(0, 1000), st(1, 1128), st(2, 1128)], [], 60);
chk('spans under 6 h are not reported on their own', short === null);
const back = analyzeTransmitCounter([st(0, 5000), st(8, 400), st(16, 5480)], [], 60);
chk('a counter that falls (garbled message) is skipped', back?.windows.length === 1 && back.windows[0].sent === 480, `${back?.windows.map((w) => w.sent)}`);
const noPeriod = analyzeTransmitCounter([st(0, 1000), st(10, 1640)], [], null);
chk('without a period: counts only, no verdict', noPeriod?.latest?.verdict === null && /cannot be turned into hours dry/.test(noPeriod.reasoning));

const load = (dir: string, ptt: string) => {
  const d = resolve(root, dir);
  if (!existsSync(resolve(d, `${ptt}-Status.csv`))) return null;
  const statuses = parseStatus(csv(resolve(d, `${ptt}-Status.csv`)));
  const msgs = parseWCRawArgosTimes(csv(resolve(d, `${ptt}-RawArgos.csv`)));
  return { statuses, msgs, period: estimateRepetitionRate(msgs)?.periodS ?? null };
};

console.log('== 33938 LOCKUP ==');
const a = load('wc-33938-2026-10-21c', '33938');
if (!a) console.log('  (absent)');
else {
  chk('Transmits parsed from Status', a.statuses.filter((s) => s.transmits != null).length === 27);
  const c = analyzeTransmitCounter(a.statuses, a.msgs, a.period, new Date('2026-10-14T21:49:00Z'), new Date('2026-10-12T00:00:00Z'))!;
  for (const w of c.windows) console.log(`        ${w.from.toISOString().slice(5, 16)} → ${w.to.toISOString().slice(5, 16)} ${w.hours.toFixed(1)} h sent ${w.sent} dry ${(w.dryFraction! * 100).toFixed(0)}% heard ${w.heard} (${((w.heardPerSent ?? 0) * 100).toFixed(1)}%)${w.resting ? ' R' : ''}`);
  chk('33938: step of 64 or 128', c.step === 64 || c.step === 128, `${c.step}`);
  chk('33938: dry the whole time it rested', c.latest?.verdict === 'dry', `${c.latest?.dryFraction?.toFixed(2)}`);
  chk('33938: heard far less of it than afloat', !!c.latest?.heardPerSent && !!c.afloatHeardPerSent && c.latest.heardPerSent < 0.5 * c.afloatHeardPerSent, `${c.latest?.heardPerSent?.toFixed(3)} vs ${c.afloatHeardPerSent?.toFixed(3)}`);
  chk('33938: says blocked, not water', /being blocked/.test(c.reasoning));
  console.log(`        ${c.reasoning}`);
}

console.log('== 40996 CAMPER ==');
const b = load('wc-40996-2026-10-02', '40996');
if (!b) console.log('  (absent)');
else {
  const c = analyzeTransmitCounter(b.statuses, b.msgs, b.period)!;
  chk('40996: one window on the camper, dry', c.windows.length >= 1 && (c.latest?.dryFraction ?? 0) >= 0.85, `${c.latest?.dryFraction?.toFixed(2)}`);
  console.log(`        ${c.reasoning}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
