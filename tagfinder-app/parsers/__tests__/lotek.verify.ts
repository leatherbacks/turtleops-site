import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { parseArgosDS, looksLikeArgosDS } from '@/parsers/argos/ds';
import { parseLotekDiveLog } from '@/parsers/lotek/diveLog';
import { parseLotekDayLog } from '@/parsers/lotek/dayLog';
import { detectFile, detectTextFile, pttFromFilename } from '@/parsers/detect';
import { resolveDateOrder, parseLotekDate } from '@/parsers/lotek/dates';
import { requireFixture , fixturePtt, RAW_DS_TXT, LOTEK_DIVE_LOG, LOTEK_DAY_LOG } from './fixtures';

const REF_PTT = fixturePtt();


const RAW = requireFixture(RAW_DS_TXT);
const DIVE = requireFixture(LOTEK_DIVE_LOG);
const DAY = requireFixture(LOTEK_DAY_LOG);
const rd = (p: string) => readFileSync(p, 'utf8');
const csv = (p: string) => Papa.parse(rd(p), { header: true, skipEmptyLines: true });

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} got=${got}${ok ? '' : `  want=${want}`}`);
};

console.log('\n== DETECTION ==');
const dayP = csv(DAY), diveP = csv(DIVE);
const mk = (n: string) => new File(['x'], n);
const dDay = detectFile(mk('PSAT+-NNNNN_Day Log.csv'), dayP.meta.fields!);
const dDive = detectFile(mk('PSAT+-NNNNN_Dive Log.csv'), diveP.meta.fields!);
chk('Day Log  -> type', dDay.fileType, 'lotek_daylog');
chk('Day Log  -> manufacturer', dDay.manufacturer, 'lotek');
chk('Dive Log -> type', dDive.fileType, 'lotek_divelog');
const rawText = rd(RAW);
chk('raw .txt sniffed as Argos DS', looksLikeArgosDS(rawText), true);
const dRaw = detectTextFile(mk('RAW_ID_0NNNNN_x.txt'), rawText)!;
chk('raw .txt -> source', dRaw.source, 'argos_cls');
chk('raw .txt -> manufacturer stays unknown', dRaw.manufacturer, 'unknown');
chk('PTT from filename', pttFromFilename(`RAW_ID_0${REF_PTT}_2026.txt`), REF_PTT);
chk('PTT from Lotek CSV name', pttFromFilename(`PSAT+-${REF_PTT}_Day Log.csv`), REF_PTT);
// WC regression
chk('WC Locations still detected',
  detectFile(mk('123456-Locations.csv'),
    ['DeployID','Ptt','Date','Quality','Latitude','Longitude','Error radius']).fileType, 'locations');
chk('WC Series still detected',
  detectFile(mk('123456-Series.csv'),
    ['DeployID','Day','Time','Depth','DRange']).fileType, 'series');

console.log('\n== DATE ORDER ==');
const ord = resolveDateOrder((diveP.data as any[]).map(r => r.TimeS));
chk('dive log order resolved', ord.order, 'dmy');
console.log(`        reason: ${ord.reason}`);
chk('ambiguous file refuses', resolveDateOrder(['01/02/26','03/04/26']).order, null);
chk('contradictory file refuses', resolveDateOrder(['25/01/26','01/25/26']).order, null);
chk('mdy detected', resolveDateOrder(['01/25/26']).order, 'mdy');
chk('parse 15:45:00 01/07/26 as dmy',
  parseLotekDate('15:45:00 01/07/26','dmy')!.toISOString(), '2026-07-01T15:45:00.000Z');
chk('same string as mdy differs',
  parseLotekDate('15:45:00 01/07/26','mdy')!.toISOString(), '2026-01-07T15:45:00.000Z');
chk('rollover rejected (31/02)', parseLotekDate('31/02/26','dmy'), null);

console.log('\n== ARGOS DS  (vs independent Python/sgp4 run) ==');
const ds = parseArgosDS(rawText);
chk('located fixes', ds.fixes.length, 110);
chk('total passes', ds.passes.length, 212);
chk('unlocated passes', ds.unlocatedPasses, 102);
chk('PTT', ds.ptt, REF_PTT);
chk('first fix ISO', ds.fixes[0].date.toISOString(), '2026-08-07T03:52:23.000Z');
chk('last fix ISO', ds.fixes.at(-1)!.date.toISOString(), '2026-08-08T15:51:50.000Z');
// Asserted structurally rather than against literal coordinates — the point is
// that the final header line parses into a usable fix, not where that tag was.
const lastFix = ds.fixes.at(-1)!;
chk('last fix has a finite position',
  Number.isFinite(lastFix.latitude) && Number.isFinite(lastFix.longitude), true);
chk('last fix lat is in range', Math.abs(lastFix.latitude) <= 90, true);
chk('last fix lon is in range', Math.abs(lastFix.longitude) <= 180, true);
chk('last fix matches the last located pass',
  lastFix.latitude === ds.passes.filter((p) => p.latitude !== null).at(-1)!.latitude, true);
chk('last fix quality', ds.fixes.at(-1)!.quality, 'A');
const q = ds.fixes.reduce((a: any, f) => (a[f.quality] = (a[f.quality] || 0) + 1, a), {});
chk('quality histogram', JSON.stringify(q), JSON.stringify({'A':10,'3':54,'B':10,'2':36}));
// Unlocated passes now carry real dates and run through 10 Aug, so select the
// last *located* pass — that is the one Julia's Argos screenshot shows.
const lastLocated = ds.passes.filter(p => p.latitude !== null).at(-1)!;
chk('last located pass ISO', lastLocated.date.toISOString(), '2026-08-08T15:51:50.000Z');
chk('last located pass msgCount (image said 3)', lastLocated.msgCount, 3);
chk('passes continue past last fix', ds.passes.at(-1)!.date > lastLocated.date, true);
chk('no mirror solutions', ds.passes.every(p => p.latitude2 === null), true);
chk('no error ellipses', ds.fixes.every(f => f.semiMajor === 0), true);
chk('effectiveError falls back (Q3=514)',
  ds.fixes.find(f => f.quality === '3')!.effectiveError, 514);
const freqs = ds.passes.filter(p => p.frequencyHz).map(p => p.frequencyHz!);
chk('freq spread < 100 Hz (Doppler-corrected)', Math.round(Math.max(...freqs) - Math.min(...freqs)), 51);

console.log('\n== LOTEK DIVE LOG ==');
const dive = parseLotekDiveLog(diveP.data as any[]);
chk('readings (3225 raw - 3 dupes)', dive.readings.length, 3222);
chk('duplicates dropped', dive.duplicatesDropped, 3);
chk('first ISO', dive.readings[0].date.toISOString(), '2026-07-01T15:45:00.000Z');
chk('last ISO', dive.readings.at(-1)!.date.toISOString(), '2026-07-29T00:35:00.000Z');
const dep = dive.readings.map(r => r.depth!).filter(Number.isFinite);
chk('max depth (m)', Math.max(...dep), 126);
chk('min depth (m)', Math.min(...dep), 0);
const tp = dive.readings.map(r => r.temperature!).filter(Number.isFinite);
chk('min temp', Math.min(...tp), 23.8);
chk('max temp', Math.max(...tp), 32.42);

console.log('\n== LOTEK DAY LOG ==');
const day = parseLotekDayLog(dayP.data as any[]);
chk('daily dive rows (22 - 2 sentinel)', day.dailyDives.length, 20);
chk('sst rows', day.sst.length, 20);
chk('positions', day.positions.length, 22);
chk('MinExtTemp sentinel -> all null',
  (dayP.data as any[]).every(r => r.MinExtTemp === '10000.00'), true);
chk('day1 TFLat sentinel(100) -> null', day.positions[0].latNorth, null);
chk('day1 TFLon sentinel(-179) -> null', day.positions[0].lonNorth, null);
// TFLatErr has no sentinel: it reports 33.52 deg ("unbounded") as a plain number,
// unlike TFLonErr which uses 1e6. Position must be the gate, not the error.
chk('day1 TFLatErr is unbounded, not a sentinel', day.positions[0].latErrNorth, 33.52);
chk('day1 TFLonErr sentinel(1e6) -> null', day.positions[0].lonErrNorth, null);
chk('day1 position still null despite finite lat error', day.positions[0].latNorth, null);
chk('day3 TFLat real', day.positions[2].latNorth, 25.9);
chk('day3 threshold lat (noisy TR)', day.positions[2].thresholdLat, 22.3);
chk('SST2 -20 sentinel excluded (day1 absent)',
  day.sst.some(s => s.date.toISOString().startsWith('2026-07-01')), false);
chk('SST2Time 245 -> 04:05 UTC',
  day.sst[0].date.toISOString(), '2026-07-03T04:05:00.000Z');
chk('SST2 temp', day.sst[0].temperature, 31.58);
chk('SST2 depth', day.sst[0].depth, 44);
chk('max daily depth == 362 (15 Jul)',
  Math.max(...day.dailyDives.map(d => d.maxDepth)), 362);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
