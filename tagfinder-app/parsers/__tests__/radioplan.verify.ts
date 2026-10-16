/**
 * The radio plan: the tag's own frequency and interval, listening spots whose
 * bearings cross on the position, and the pinger question for WC tags.
 *
 *   npx tsx parsers/__tests__/radioplan.verify.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { planRadio, type RadioPlanInput } from '@/analysis/radioPlan';
import { estimateRepetitionRate } from '@/analysis/repetitionRate';
import { parseWCRawArgosTimes } from '@/parsers/wc/rawArgos';
import { detectFile } from '@/parsers/detect';
import { analyzeDataQuality } from '@/analysis/dataQuality';
import { parseArgos } from '@/parsers/wc/argos';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(60)} ${detail}`);
};
const bearing = (a: number, b: number, c: number, d: number) => {
  const r = Math.PI / 180;
  const y = Math.sin((d - b) * r) * Math.cos(c * r);
  const x = Math.cos(a * r) * Math.sin(c * r) - Math.sin(a * r) * Math.cos(c * r) * Math.cos((d - b) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
};

const dir = process.env.HOME && resolve(process.env.HOME, 'Documents/Apps/tagfinder/data/wc-33938-2026-10-16');
const raw = dir && existsSync(resolve(dir, '33938-RawArgos.csv'))
  ? Papa.parse<Record<string, string>>(readFileSync(resolve(dir, '33938-RawArgos.csv'), 'utf8'), { header: true, skipEmptyLines: true })
  : null;

console.log('\n== WC RAWARGOS GIVES THE INTERVAL ==');
if (raw) {
  const det = detectFile({ name: '33938-RawArgos.csv' } as File, raw.meta.fields ?? []);
  chk('RawArgos.csv is recognised', det.fileType === 'raw_argos', det.fileType);
  const rep = estimateRepetitionRate(parseWCRawArgosTimes(raw.data));
  chk('33938 transmits every 60 s', rep?.periodS === 60, String(rep?.periodS));
} else console.log('  (33938 RawArgos absent)');

const f927 = process.env.HOME && resolve(process.env.HOME, 'Documents/Apps/tagfinder/data/wc-285927/285927-Argos.csv');
if (f927 && existsSync(f927)) {
  console.log('\n== FREQUENCY IGNORES THE 401.650 FILL ==');
  const q = analyzeDataQuality(parseArgos(Papa.parse<Record<string, string>>(readFileSync(f927, 'utf8'), { header: true, skipEmptyLines: true }).data));
  // 9 of 16 passes carry the 401.650000 placeholder; the 5 measured ones sit at 401.6776.
  chk('285927: 401.6776 MHz, not the placeholder', Math.abs((q.nominalFrequencyMHz ?? 0) - 401.6776) < 0.0005, String(q.nominalFrequencyMHz));
}

console.log('\n== PLAN ==');
const base: RadioPlanInput = {
  lat: 28.0306, lon: -80.5458, searchRadiusM: 500, frequencyMHz: 401.6776,
  repetition: { periodS: 60, jitterS: 1, silenceThresholdS: 180 } as never,
  manufacturer: 'wildlife_computers', phase: 'likely_recovered', covered: true, inhabited: true,
  drifting: false, newestMessage: new Date('2026-10-16T11:27Z'), now: new Date('2026-10-16T14:00Z'),
};
const p = planRadio(base)!;
chk('33938: in someone\'s hands, radio before the door', p.scenario === 'in_hand' && /door/.test(p.headline), p.scenario);
chk('frequency is the measured one', p.frequencyMHz === 401.6776 && /401\.678 MHz/.test(p.steps.join(' ')));
chk('listen at least two bursts (>= 2 min)', p.dwellS >= 120, `${p.dwellS} s`);
chk('WC tag: ask about a pinger, first step', p.askAboutPinger && /pinger/.test(p.steps[0]));
chk('four spots, one per side', p.stations.length === 4 && new Set(p.stations.map((s) => s.side)).size === 4);
const worst = Math.max(...p.stations.map((s) => {
  const b = bearing(s.lat, s.lon, base.lat, base.lon);
  return Math.min(Math.abs(b - s.bearingDeg), 360 - Math.abs(b - s.bearingDeg));
}));
chk('each spot\'s bearing points at the position', worst < 0.5, `${worst.toFixed(2)}°`);
chk('spots 300–1200 m out', p.stations.every((s) => s.distanceM >= 300 && s.distanceM <= 1200), `${p.stations[0].distanceM} m`);
const buried = planRadio({ ...base, phase: 'buried', inhabited: false })!;
chk('285927-style buried: covered ground, probe where loudest', buried.scenario === 'covered_ground' && /probe/i.test(buried.headline));
chk('Lotek tag: no pinger question', planRadio({ ...base, manufacturer: 'lotek' })!.askAboutPinger === false);
chk('drifting tag: no plan', planRadio({ ...base, drifting: true }) === null);
const old = planRadio({ ...base, newestMessage: new Date('2026-10-01T00:00Z') })!;
chk('two-week-old file: pull a fresh export first', /fresh export/.test(old.steps[0]));
const noFreq = planRadio({ ...base, frequencyMHz: null, repetition: null })!;
chk('no measured frequency or interval: scan the band, listen 3 min', /401\.620–401\.680/.test(noFreq.steps.join(' ')) && noFreq.dwellS === 180);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
