/** End-to-end intake: can we identify tag type from content alone? */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { detectFile, detectTextFile, detectSpreadsheet } from '@/parsers/detect';
import { parseArgosDS } from '@/parsers/argos/ds';
import { parseLotekDayLog } from '@/parsers/lotek/dayLog';
import { parseLotekDiveLog } from '@/parsers/lotek/diveLog';
import { detectTagCategory } from '@/analysis/tagCategory';
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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
