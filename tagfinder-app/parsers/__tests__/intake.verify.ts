/** End-to-end intake: can we identify tag type from content alone? */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { detectFile, detectTextFile, detectSpreadsheet } from '@/parsers/detect';
import { parseArgosDS } from '@/parsers/argos/ds';
import { parseLotekDayLog } from '@/parsers/lotek/dayLog';
import { parseLotekDiveLog } from '@/parsers/lotek/diveLog';
import { detectTagCategory } from '@/analysis/tagCategory';
import {
  detectOffloadKind,
  parseLotekOffload,
  anchorActivityEpoch,
  offloadSeries,
} from '@/parsers/lotek/offload';
import { requireFixture, RAW_DS_TXT, LOTEK_DAY_LOG, LOTEK_DIVE_LOG } from './fixtures';

const FILES: [RegExp, string][] = [
  // deliberately misleading names — routing must come from content
  [RAW_DS_TXT, 'mystery1.dat'],
  [LOTEK_DAY_LOG, 'mystery2.bin'],
  [LOTEK_DIVE_LOG, 'mystery3'],
];

let pass = 0, fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(52)} got=${got}${ok ? '' : ` want=${want}`}`);
};

// Replicate the useAnalysis intake loop
const detected: any[] = [];
const parsedData: Record<string, any[]> = {};
let ds: ReturnType<typeof parseArgosDS> | null = null;

for (const [real, fakeName] of FILES) {
  const buf = readFileSync(requireFixture(real));
  const file = new File([buf], fakeName);
  const magic = new Uint8Array(buf.subarray(0, 8));

  const sheet = detectSpreadsheet(file, magic);
  if (sheet) { detected.push(sheet); continue; }

  const head = buf.subarray(0, 65536).toString('utf8');
  const asText = detectTextFile(file, head);
  if (asText) { ds = parseArgosDS(buf.toString('utf8')); detected.push(asText); continue; }

  const p = Papa.parse(buf.toString('utf8'), { header: true, skipEmptyLines: true });
  const det = detectFile(file, p.meta.fields || []);
  detected.push(det);
  if (det.fileType !== 'unknown') parsedData[det.fileType] = p.data as any[];
}

console.log('\n== CONTENT-BASED ROUTING (all filenames disguised) ==');
chk('mystery1.dat  -> argos_ds', detected[0].fileType, 'argos_ds');
chk('mystery1.dat  -> source argos_cls', detected[0].source, 'argos_cls');
chk('mystery2.bin  -> lotek_daylog', detected[1].fileType, 'lotek_daylog');
chk('mystery3      -> lotek_divelog', detected[2].fileType, 'lotek_divelog');
chk('nothing unrecognised', detected.filter(d => d.fileType === 'unknown').length, 0);

console.log('\n== MANUFACTURER RESOLUTION ==');
const mfr = detected.find(d => d.manufacturer !== 'unknown')?.manufacturer ?? 'unknown';
chk('dataset manufacturer inferred', mfr, 'lotek');
chk('argos file itself stays manufacturer-agnostic', detected[0].manufacturer, 'unknown');

console.log('\n== TAG CATEGORY (no Summary file exists for Lotek) ==');
chk('WC + no summary -> tracker', detectTagCategory(null, 'wildlife_computers').category, 'tracker');
chk('Lotek + no summary -> psat', detectTagCategory(null, 'lotek').category, 'psat');
chk('unknown + no summary -> tracker', detectTagCategory(null).category, 'tracker');

// A named pop-up tag whose export omits ReleaseDate is still a pop-up tag.
// Requiring both sent a real MiniPAT down the live-tracker path, where its
// post-release fixes were read as animal movement.
const sum = (instrument: string, releaseDate: Date | null) =>
  ({ instrument, releaseDate }) as unknown as Parameters<typeof detectTagCategory>[0];
chk('MiniPAT without ReleaseDate -> psat',
  detectTagCategory(sum('MiniPAT', null), 'wildlife_computers').category, 'psat');
chk('...and says the release moment is unavailable',
  /no ReleaseDate/.test(detectTagCategory(sum('MiniPAT', null), 'wildlife_computers').reasoning), true);
chk('MiniPAT with ReleaseDate -> psat',
  detectTagCategory(sum('MiniPAT', new Date()), 'wildlife_computers').category, 'psat');
// SPLASH is normally carried by the animal, so the name alone must not promote it.
chk('SPLASH without ReleaseDate stays tracker',
  detectTagCategory(sum('SPLASH', null), 'wildlife_computers').category, 'tracker');
chk('SPLASH with ReleaseDate -> psat',
  detectTagCategory(sum('SPLASH', new Date()), 'wildlife_computers').category, 'psat');
chk('SPOT stays a tracker',
  detectTagCategory(sum('SPOT-300', null), 'wildlife_computers').category, 'tracker');

console.log('\n== DATA REACHED THE ANALYZERS ==');
const dive = parseLotekDiveLog(parsedData.lotek_divelog);
const day = parseLotekDayLog(parsedData.lotek_daylog);
chk('argos fixes', ds!.fixes.length, 110);
chk('argos passes', ds!.passes.length, 212);
chk('dive readings', dive.readings.length, 3222);
chk('daily dive rows', day.dailyDives.length, 20);
chk('sst rows', day.sst.length, 20);

console.log('\n== SPREADSHEET GUIDANCE ==');
const xlsx = new File([Buffer.from([0x50,0x4b,0x03,0x04,0,0,0,0])], 'Doppler-Sharks.xlsx');
const sd = detectSpreadsheet(xlsx, new Uint8Array([0x50,0x4b,0x03,0x04,0,0,0,0]))!;
chk('xlsx recognised', sd.fileType, 'unknown');
chk('xlsx explains itself', Boolean(sd.warning), true);
const xls = new Uint8Array([0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
chk('legacy .xls recognised', Boolean(detectSpreadsheet(new File([''],'a.xls'), xls)), true);
chk('plain text is not a spreadsheet',
  detectSpreadsheet(new File([''],'a.csv'), new Uint8Array([0x54,0x69,0x6d,0x65,0x53,0x2c,0,0])), null);


console.log('\n== LOTEK OFFLOAD (.bin) INTAKE ==');
{
  const enc = (t: string) => Array.from(new TextEncoder().encode(t));
  // Minimal synthetic logs, built to each format's verified layout.
  const alogEntry = (base: number) => {
    const b = new Array(40).fill(0);
    b[0] = 0xa0; b[1] = base & 0xff; b[2] = (base >> 8) & 0xff; b[3] = (base >> 16) & 0xff; b[4] = 0x31;
    for (let i = 0; i < 8; i++) {
      const t = Math.round((30 + i * 0.01 + 20) * 50);
      b[5 + 2 * i] = t & 0xff; b[6 + 2 * i] = t >> 8;
      const pr = 40 + i;
      b[21 + 2 * i] = pr & 0xff; b[22 + 2 * i] = pr >> 8;
    }
    b[37] = 0x6a; b[38] = 0x7b; b[39] = 0xde;
    return b;
  };
  const dayRec = (dayNo: number) => {
    const b = new Array(40).fill(0);
    const put = (slot: number, v: number) => { b[slot * 2] = v & 0xff; b[slot * 2 + 1] = v >> 8; };
    put(0, dayNo); put(1, 630); put(2, 20); put(3, 588); put(4, 588); put(11, 2510);
    return b;
  };
  const basicMin = () => {
    const out: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t = Math.round((30.1 + 20) * 50);
      out.push(0xa2, t & 0xff, ((5 & 0x0f) << 4) | ((t >> 8) & 0x0f), 5 >> 4);
    }
    out.push(0xe2, 73, 1, 2, 3, 4, 5);
    return out;
  };
  const BASE = 14154716;
  const alog = [...enc('[PSAT3_ALOG]TagParams....'),
    ...alogEntry(BASE), ...alogEntry(BASE + 2400), ...alogEntry(BASE + 4800),
    ...alogEntry(BASE + 7200), ...alogEntry(BASE + 9600), ...alogEntry(BASE + 12000),
    ...alogEntry(BASE + 14400), ...alogEntry(BASE + 16800)];
  const dlog = [...enc('[PSAT3_DLOG]TagParams....'),
    ...dayRec(9678), ...dayRec(9679), ...dayRec(9680), ...dayRec(9681)];
  const blog = [...enc('[PSAT3_BLOG]TagParams....'),
    ...basicMin(), ...basicMin(), ...basicMin()];

  chk('an activity file is recognised', detectOffloadKind(Uint8Array.from(alog)), 'alog');
  chk('a day file is recognised', detectOffloadKind(Uint8Array.from(dlog)), 'dlog');
  chk('a basic file is recognised', detectOffloadKind(Uint8Array.from(blog)), 'blog');
  chk('a CSV is not', detectOffloadKind(new TextEncoder().encode('DeployID,Ptt,Instr')), null);

  const single = parseLotekOffload(Uint8Array.from(alog))!;
  chk('single file parses to its own log', single.activity!.records.length, 64);

  // The container: one header, three bodies, NO internal markers — the layout
  // that makes header-splitting impossible and stream-location necessary.
  const lvs = Uint8Array.from([...enc('[PSAT3_LLOG]TagParams....'),
    ...blog.slice(25), ...alog.slice(25), ...dlog.slice(25)]);
  const c = parseLotekOffload(lvs)!;
  chk('container: basic region found', c.basic!.samples.length, 15);
  chk('container: activity region found', c.activity!.records.length, 64);
  chk('container: day region found', c.day!.records.length, 4);

  // Anchoring. The archive clock is relative; the exact method must find the
  // epoch that makes pressures agree with a manufacturer decode, and refuse
  // when agreement is poor rather than return its best guess.
  const EPOCH = Date.UTC(2026, 0, 18, 20, 33, 4);
  const csvSeries = c.activity!.records.map((r) => ({
    date: new Date(EPOCH + r.tagSeconds * 1000),
    depth: r.pressureDbar, depthRange: null,
    temperature: r.temperatureC, temperatureRange: null,
  }));
  const exact = anchorActivityEpoch(c.activity!, csvSeries, c.day)!;
  chk('exact anchor recovers the epoch', exact.epoch.getTime(), EPOCH);
  chk('...by the exact method', exact.method, 'exact');
  chk('...at full agreement', exact.rate, 1);

  const wrong = csvSeries.map((r) => ({ ...r, depth: (r.depth ?? 0) + 7 }));
  const refused = anchorActivityEpoch(c.activity!, wrong, null);
  chk('disagreeing pressures are refused, not best-guessed', refused, null);

  const approx = anchorActivityEpoch(c.activity!, null, c.day)!;
  chk('day fallback anchors approximately', approx.method, 'day');
  chk('...within half a day of the archive start',
    Math.abs(approx.epoch.getTime() + c.activity!.records[0].tagSeconds * 1000 -
      Date.UTC(2026, 6, 1, 12)) <= 12 * 3600 * 1000, true);

  const series = offloadSeries(c.activity!, exact);
  chk('anchored series is pipeline-shaped',
    series.length === 64 && series[0].depth === 40 && series[0].temperature !== null, true);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);