/**
 * Lotek downloader container ("PIDnnnnnn_TagIDnnnnn_PsatPlus_LVS.bin") against
 * a real file, with expected counts computed independently in Python by
 * walking the same sections, and the day-log longitude decode checked against
 * the manufacturer's own CSV export of a second deployment.
 *
 *   npx tsx parsers/__tests__/lotekargos.verify.ts
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { isLotekArgosContainer, parseLotekArgosContainer } from '@/parsers/lotek/argosContainer';
import { longitudeFromNoonMinute, equationOfTimeMinutes } from '@/parsers/lotek/solarNoon';
import { detectOffloadKind } from '@/parsers/lotek/offload';
import { classifyDrift } from '@/analysis/drift';
import { predictDrift } from '@/analysis/driftPredict';
import { interpretLotekReleaseStatus } from '@/analysis/releaseType';
import { analyzeDataQuality } from '@/analysis/dataQuality';
import { analyzeReceptionQuality } from '@/analysis/receptionQuality';
import { requireFixture, fixture, LOTEK_ARGOS_BIN, LOTEK_DAY_LOG } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const near = (label: string, got: number | null, want: number, tol: number) => {
  const ok = got !== null && Math.abs(got - want) <= tol;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(54)} got=${got}${ok ? '' : `  want=${want}±${tol}`}`);
};

const path = requireFixture(LOTEK_ARGOS_BIN);
const buf = readFileSync(path);
const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

console.log('\n== DETECTION ==');
chk('magic recognised', isLotekArgosContainer(bytes.subarray(0, 16)), true);
chk('not mistaken for a recovered-tag offload', detectOffloadKind(bytes.subarray(0, 16)), null);
chk('plain text is not a container', isLotekArgosContainer(new TextEncoder().encode('TimeS,MaxPress,')), false);

console.log('\n== CONTAINER ==');
const c = parseLotekArgosContainer(bytes);
chk('PTT from header', c.ptt, Number(/PID0*(\d+)_/.exec(path.split('/').pop()!)![1]));
chk('serial from header', c.serial, Number(/TagID(\d+)_/.exec(path.split('/').pop()!)![1]));
chk('sections in file order', c.sections.map((s) => `${s.type}:${s.count}`), ['3:57', '0:18036', '1:55', '2:36', '5:57', '10:465', '13:2343', '11:69']);
chk('walk reached the end without a warning', c.warning, null);
chk('reception span starts 17 Sep (a day-log block)', c.from?.toISOString(), '2026-09-17T00:20:04.000Z');
chk('reception span ends 24 Sep', c.to?.toISOString(), '2026-09-24T17:25:19.000Z');
chk('types 1 and 2 counted as skipped', c.skippedRecords, 55 + 36);

console.log('\n-- Argos fixes (type 10) --');
chk('fixes', c.fixes.length, 465);
chk('class histogram', c.fixes.reduce((a: Record<string, number>, f) => ((a[f.quality] = (a[f.quality] || 0) + 1), a), {}), { B: 81, '2': 231, A: 55, '3': 96, '1': 2 });
chk('first fix ISO', c.fixes[0].date.toISOString(), '2026-09-17T00:20:37.000Z');
chk('first fix position', [c.fixes[0].latitude, c.fixes[0].longitude], [31.53, -80.394]);
chk('last fix ISO', c.fixes.at(-1)!.date.toISOString(), '2026-09-24T16:49:40.000Z');
near('last fix latitude', c.fixes.at(-1)!.latitude, 30.787, 0.0005);
near('last fix longitude', c.fixes.at(-1)!.longitude, -80.996, 0.0005);
chk('longitude folded from 0–360', c.fixes.every((f) => f.longitude < 0 && f.longitude > -82), true);
chk('empirical error for class 3', c.fixes.find((f) => f.quality === '3')!.effectiveError, 514);
chk('no error ellipses carried', c.fixes.every((f) => f.semiMajor === 0 && f.errorRadius === 0), true);
chk('sorted ascending', c.fixes.every((f, i) => i === 0 || f.date >= c.fixes[i - 1].date), true);

console.log('\n-- receptions and passes (type 13) --');
chk('message times', c.messageTimes.length, 2343);
chk('one located pass per fix', c.passes.filter((p) => p.latitude !== null).length, 465);
const msgSum = c.passes.reduce((s, p) => s + p.msgCount, 0);
chk('every reception counted once, plus class floors only', msgSum >= 2343 && msgSum - 2343 <= 4 * 465, true);
chk('unlocated passes counted', c.unlocatedPasses, c.passes.filter((p) => p.latitude === null).length);
chk('located passes never outnumber passes', c.passes.length >= 465, true);
chk('passes carry the fix class', c.passes.find((p) => p.latitude !== null)!.locationQuality !== '', true);
chk('passes sorted', c.passes.every((p, i) => i === 0 || p.date >= c.passes[i - 1].date), true);
chk('a located pass never has fewer messages than its class implies',
  c.passes.filter((p) => p.latitude !== null).every((p) => p.msgCount >= (p.locationQuality === 'B' ? 2 : p.locationQuality === 'A' ? 3 : 4)), true);
chk('every pass counts at least one message', c.passes.every((p) => p.msgCount > 0), true);
const dbm = c.passes.map((p) => p.powerDbm).filter((v): v is number => v !== null);
near('signal in the CLS-reported range (inferred scale)', dbm.reduce((a, b) => a + b, 0) / dbm.length, -129, 2);
chk('corrupt counted per pass', c.passes.reduce((s, p) => s + (p.corrupt ?? 0), 0), 903);

console.log('\n-- health (type 5, 57 records, 27 with both blocks OK) --');
chk('records', c.health.records.length, 27);
chk('corrupt', c.health.corrupt, 57 - 27);
chk('first ISO', c.health.records[0].date.toISOString(), '2026-09-17T06:13:45.000Z');
chk('last ISO', c.health.records.at(-1)!.date.toISOString(), '2026-09-24T12:29:09.000Z');
chk('one serial, matches header', new Set(c.health.records.map((r) => r.serial)).size === 1 && c.health.records[0].serial === c.serial, true);
chk('scheduled-release status byte', c.health.records[0].statusByte, 0x80);
chk('latched corrosion', [c.health.records[0].corrosionTimeS, c.health.records[0].corrosionStartV, c.health.records[0].corrosionEndV], [180, 5.17, 3.65]);
chk('message counter joined from type 11', c.health.records.every((r) => r.messageCounter > 0), true);
chk('counter advances with time', c.health.records.every((r, i) => i === 0 || r.messageCounter > c.health.records[i - 1].messageCounter), true);
const ht = c.health.records.map((r) => r.temperatureC);
near('temperatures sit at sea temperature', Math.min(...ht), 26.4, 0.3);
chk('status never changed', c.health.statusChanged, false);

console.log('\n-- dive (type 0, 18036 records, 8949 CRC OK, 5208 distinct) --');
chk('readings', c.dive.readings.length, 5208);
chk('rejected', c.dive.rejected, 18036 - 8949);
chk('first ISO', c.dive.readings[0].date.toISOString(), '2026-08-21T18:15:00.000Z');
chk('last ISO', c.dive.readings.at(-1)!.date.toISOString(), '2026-09-15T13:05:00.000Z');
chk('max depth (raw units, as the CSV parser)', Math.max(...c.dive.readings.map((r) => r.depth!)), 261);
chk('first reading is on deck before deployment (depth 0)', c.dive.readings[0].depth, 0);
near('first reading temperature', c.dive.readings[0].temperature, 27.5, 0.1);

console.log('\n-- day log (type 3, 57 records, 21 days with block 1) --');
chk('day records', c.day.dayRecords.length, 21);
chk('daily dives (block 2)', c.day.dailyDives.length, 16);
chk('first day', c.day.dayRecords[0].date.toISOString().slice(0, 10), '2026-08-22');
chk('last day', c.day.dayRecords.at(-1)!.date.toISOString().slice(0, 10), '2026-09-13');
const d0823 = c.day.dayRecords.find((d) => d.date.toISOString().startsWith('2026-08-23'))!;
chk('08-23 sunrise/sunset minutes', [d0823.sunriseMinutesUtc, d0823.sunsetMinutesUtc], [640, 2]);
near('08-23 latitude vs manufacturer 27.4', d0823.latitudeNorth, 27.4, 0.05);
near('08-23 longitude vs manufacturer -80.6', d0823.longitudeNorth, -80.6, 0.16);
near('08-23 SST vs manufacturer 30.2', d0823.sstC, 30.2, 0.05);
const d0908 = c.day.dayRecords.find((d) => d.date.toISOString().startsWith('2026-09-08'))!;
near('09-08 longitude vs manufacturer -79.1', d0908.longitudeNorth, -79.1, 0.16);
near('09-02 longitude vs manufacturer -82.6', c.day.dayRecords.find((d) => d.date.toISOString().startsWith('2026-09-02'))!.longitudeNorth, -82.6, 0.16);
chk('08-22 sentinels -> null', [c.day.dayRecords[0].latitudeNorth, c.day.dayRecords[0].sunriseMinutesUtc], [null, null]);
chk('09-06 min depth from the block-2-OK copy', c.day.dailyDives.find((d) => d.date.toISOString().startsWith('2026-09-06'))!.minDepth, 216);

console.log('\n== SOLAR NOON ==');
near('equation of time, 24 Sep', equationOfTimeMinutes(new Date('2026-09-24T00:00:00Z')), 7.7, 1.2);
near('equation of time, 3 Nov (max)', equationOfTimeMinutes(new Date('2026-11-03T00:00:00Z')), 16.4, 1.0);
chk('sentinel 0 -> null', longitudeFromNoonMinute(0, new Date('2026-09-01T00:00:00Z')), null);
chk('sentinel 0xFFFF -> null', longitudeFromNoonMinute(0xffff, new Date('2026-09-01T00:00:00Z')), null);
const csv = fixture(LOTEK_DAY_LOG);
if (csv) {
  // The manufacturer's CSV carries both the noon time and the longitude, so
  // the formula can be checked on a second deployment with no bin at all.
  const rows = Papa.parse(readFileSync(csv, 'utf8'), { header: true, skipEmptyLines: true }).data as Record<string, string>[];
  let n = 0, worst = 0;
  for (const r of rows) {
    const m = /(\d{1,2})\/(\d{1,2})\/(\d{2})/.exec(r.TimeS ?? '');
    const t = /(\d{1,2}):(\d{2})/.exec(r.TFNoonN ?? '');
    const lon = parseFloat(r.TFLonN ?? '');
    if (!m || !t || !Number.isFinite(lon) || lon <= -179) continue;
    const date = new Date(Date.UTC(2000 + +m[3], +m[2] - 1, +m[1]));
    const noon = +t[1] * 60 + +t[2];
    if (noon === 0) continue;
    const got = longitudeFromNoonMinute(noon, date);
    if (got === null) continue;
    n++;
    worst = Math.max(worst, Math.abs(got - lon));
  }
  chk('second deployment: days checked', n >= 15, true);
  near('second deployment: worst residual vs TFLonN', worst, 0.1, 0.1);
} else {
  console.log('  (Lotek Day Log CSV fixture not present — cross-deployment longitude check skipped)');
}

console.log('\n== THROUGH THE ANALYSERS ==');
const drift = classifyDrift(c.fixes);
chk('all-time label', drift.allTime, 'drifting');
chk('recent label no longer stuck on insufficient for 34 km/day', drift.recent, 'drifting');
chk('release cause from the status byte', interpretLotekReleaseStatus(c.health.records[0].statusByte).category, 'scheduled');
chk('unknown status byte stays unknown', interpretLotekReleaseStatus(0x7e).category, 'unknown');
chk('data quality and reception quality count the same passes',
  analyzeDataQuality(c.passes).totalPasses, analyzeReceptionQuality(c.passes)!.passes);
const pred = predictDrift(c.fixes);
chk('drift vector resolves', pred !== null, true);
if (pred) {
  near('speed km/h', pred.speedKmH, 1.67, 0.05);
  near('heading deg', pred.headingDeg, 205, 2);
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
