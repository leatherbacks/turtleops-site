/**
 * Lotek portal workbook ("Day, Dive, and Health Log_ID NNNNN_YYYY-MM-DD.xlsx")
 * against a real export, with expected counts computed independently in Python
 * from the same workbook (openpyxl, splitting each row's single cell on commas
 * and filtering on the CRC columns).
 *
 *   npx tsx parsers/__tests__/lotekportal.verify.ts
 */
import { readFileSync } from 'fs';
import { readXlsx } from '@/parsers/xlsx';
import { parseLotekPortalWorkbook } from '@/parsers/lotek/portalLog';
import { detectSpreadsheet, pttFromFilename } from '@/parsers/detect';
import { requireFixture, LOTEK_PORTAL_XLSX } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} got=${got}${ok ? '' : `  want=${want}`}`);
};

(async () => {
  const path = requireFixture(LOTEK_PORTAL_XLSX);
  const name = path.split('/').pop()!;
  const buf = readFileSync(path);
  const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);

  console.log('\n== CONTAINER ==');
  const sniff = detectSpreadsheet(new File([buf], name), bytes.subarray(0, 8));
  chk('magic bytes say spreadsheet', sniff?.fileType, 'unknown');
  chk('PTT from the portal filename', pttFromFilename(name), Number(/ID (\d+)/.exec(name)![1]));

  console.log('\n== WORKBOOK ==');
  const sheets = await readXlsx(bytes);
  chk('three sheets', sheets.length, 3);
  chk('sheet names, workbook order', sheets.map((s) => s.name), ['Day Log', 'Health Log', 'Dive Log']);
  chk('day sheet rows (title + header + 51)', sheets[0].rows.length, 53);
  chk('dive sheet rows (title + header + 16859 + trailing)', sheets[2].rows.length >= 16861, true);
  chk('title sits alone in its row', sheets[0].rows[0].filter(Boolean).length, 1);
  chk('header row is one comma-joined cell', sheets[0].rows[1].filter(Boolean).length, 1);

  console.log('\n== PORTAL LOGS ==');
  const portal = parseLotekPortalWorkbook(sheets)!;
  chk('recognised', Boolean(portal), true);
  chk('all three logs found', portal.sheets.sort(), ['Day Log', 'Dive Log', 'Health Log']);

  console.log('\n-- dive log (16859 rows, 8520 CRC OK, 5149 distinct timestamps) --');
  const dive = portal.diveLog!;
  chk('readings', dive.readings.length, 5149);
  chk('rejected (CRC fail)', dive.rejected, 16859 - 8520);
  chk('near-duplicates dropped', dive.duplicatesDropped, 0);
  chk('first ISO', dive.readings[0].date.toISOString(), '2026-08-21T18:15:00.000Z');
  chk('last ISO', dive.readings.at(-1)!.date.toISOString(), '2026-09-15T13:05:00.000Z');
  const dep = dive.readings.map((r) => r.depth!).filter(Number.isFinite);
  chk('max depth (raw units, same as CSV parser)', Math.max(...dep), 1707);
  const tp = dive.readings.map((r) => r.temperature!).filter(Number.isFinite);
  chk('min temp', Math.min(...tp), 14.7);
  chk('max temp', Math.max(...tp), 38.9);
  chk('sorted ascending',
    dive.readings.every((r, i) => i === 0 || r.date.getTime() > dive.readings[i - 1].date.getTime()), true);

  console.log('\n-- health log (52 rows, 36 block-1 OK, 26 both OK) --');
  const health = portal.healthLog!;
  chk('records (both blocks OK, deduplicated)', health.records.length, 26);
  chk('corrupt', health.corrupt, 52 - 26);
  chk('undated', health.undated, 0);
  chk('first reception ISO', health.records[0].date.toISOString(), '2026-09-15T23:10:56.000Z');
  chk('last reception ISO', health.records.at(-1)!.date.toISOString(), '2026-09-22T12:58:59.000Z');
  chk('one serial', new Set(health.records.map((r) => r.serial)).size, 1);
  chk('release cause carried', health.records[0].releaseCause, 'Wet Schedule');
  chk('...mapped to the scheduled-release byte', health.records[0].statusByte, 0x80);
  chk('status never changed', health.statusChanged, false);
  chk('corrosion time latched', new Set(health.records.map((r) => r.corrosionTimeS)).size, 1);
  const ht = health.records.map((r) => r.temperatureC);
  chk('temps within 26.4-28.3', [Math.min(...ht), Math.max(...ht)], [26.4, 28.3]);
  chk('block-1-only rows excluded (would carry 80.0 C, -13.3 C)',
    health.records.some((r) => r.temperatureC > 40 || r.temperatureC < 0), false);

  console.log('\n-- day log (51 rows; 16 dates with block 1 OK, 12 with block 2 OK) --');
  const day = portal.dayLog!;
  chk('positions (one per block-1 date)', day.positions.length, 16);
  chk('day records', day.dayRecords.length, 16);
  chk('daily dive rows (block 2)', day.dailyDives.length, 12);
  chk('sst rows (block 1, -20 sentinel excluded)', day.sst.length, 15);
  chk('records', day.records, 16);
  const d0823 = day.positions.find((p) => p.date.toISOString().startsWith('2026-08-23'))!;
  chk('08-23 LatN', d0823.latNorth, 27.4);
  chk('08-23 LonN', d0823.lonNorth, -80.6);
  chk('08-23 LatS', d0823.latSouth, 25.8);
  chk('08-23 LatErrN', d0823.latErrNorth, 9.3);
  chk('08-23 LonErrN', d0823.lonErrNorth, 2.4);
  const first = day.positions[0];
  chk('08-22 lat sentinel (100) -> null', first.latNorth, null);
  chk('08-22 lon sentinel (-179.2) -> null', first.lonNorth, null);
  chk('08-22 has no block 2 -> errors null', first.latErrNorth, null);
  const r0823 = day.dayRecords.find((d) => d.date.toISOString().startsWith('2026-08-23'))!;
  chk('08-23 sunrise 10:40 -> 640', r0823.sunriseMinutesUtc, 640);
  chk('08-23 sunset 0:02 -> 2', r0823.sunsetMinutesUtc, 2);
  chk('08-22 sunrise 68:15 -> null', day.dayRecords[0].sunriseMinutesUtc, null);
  const s0823 = day.sst.find((s) => s.date.toISOString().startsWith('2026-08-23'))!;
  chk('08-23 SST 30.2 at 05:58 UTC', [s0823.temperature, s0823.date.toISOString()],
    [30.2, '2026-08-23T05:58:00.000Z']);
  chk('08-23 max depth', day.dailyDives.find((d) => d.date.getTime() === d0823.date.getTime())!.maxDepth, 45);
  // A block-2 failure must not leak corrupted depths: 09-06 has a copy with
  // MinDepth 2264 whose second block failed, and a good copy with 216.
  chk('09-06 min depth from the block-2-OK copy',
    day.dailyDives.find((d) => d.date.toISOString().startsWith('2026-09-06'))!.minDepth, 216);

  console.log('\n== NOT A PORTAL WORKBOOK ==');
  chk('unrelated sheets -> null',
    parseLotekPortalWorkbook([{ name: 'Sheet1', rows: [['a', 'b'], ['1', '2']] }]), null);
  chk('CSV-split cells still parse',
    parseLotekPortalWorkbook([{
      name: 'Dive Log',
      rows: [
        ['Activity Dive Log:2 records'],
        ['Date/Time', 'Temperature', 'Depth', 'crcStatus', 'Rx Date/Time'],
        ['2026-09-01 00:00:00', '28.1', '120', 'OK', '2026-09-20 00:00:00'],
        ['2026-09-01 00:05:00', '28.2', '121', 'Fail', '2026-09-20 00:00:00'],
      ],
    }])!.diveLog!.readings.length, 1);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
