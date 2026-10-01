/**
 * The 2026 CLS/Kinéis downloader exports — devices, positions and two
 * overlapping messages windows, all programme-wide — against the real files
 * pulled on 1 Oct 2026, with counts computed independently in Python.
 *
 *   npx tsx parsers/__tests__/clsexport.verify.ts
 */
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { detectFile } from '@/parsers/detect';
import { parseArgosMessages } from '@/parsers/argos/messages';
import { parseArgosPositions } from '@/parsers/argos/positions';
import { classifyDrift } from '@/analysis/drift';
import { fixture, requireFixture, CLS_MESSAGES_2026, CLS_POSITIONS_2026, CLS_DEVICES_2026 } from './fixtures';
import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true });
const mk = (n: string) => new File(['x'], n);

const positionsPath = requireFixture(CLS_POSITIONS_2026);
const dir = positionsPath.slice(0, positionsPath.lastIndexOf('/'));
const messagePaths = existsSync(dir) ? readdirSync(dir).filter((f) => CLS_MESSAGES_2026.test(f)).sort().map((f) => resolve(dir, f)) : [];
const devicesPath = fixture(CLS_DEVICES_2026);

console.log('\n== DETECTION (2026 downloader shapes) ==');
const pos = csv(positionsPath);
chk('positions export -> argos_positions', detectFile(mk('x.csv'), pos.meta.fields!).fileType, 'argos_positions');
chk('positions export source', detectFile(mk('x.csv'), pos.meta.fields!).source, 'argos_cls');
if (devicesPath) {
  chk('devices export -> unknown (nothing to analyse)', detectFile(mk('x.csv'), csv(devicesPath).meta.fields!).fileType, 'unknown');
}
chk('messages windows found', messagePaths.length >= 1, true);
for (const p of messagePaths) {
  chk(`messages export detected by headers, not name (${p.slice(-12)})`, detectFile(mk('x.csv'), csv(p).meta.fields!).fileType, 'argos_messages');
}
chk('old ArgosWeb header set still detected',
  detectFile(mk('x.csv'), ['Device ID', 'Message date (UTC)', 'Doppler Position ID', 'Doppler Error radius', 'Doppler Class', 'Signal Level', 'Raw data']).fileType, 'argos_messages');
chk('WC Locations not confused with CLS positions',
  detectFile(mk('x.csv'), ['DeployID', 'Ptt', 'Date', 'Quality', 'Latitude', 'Longitude', 'Error radius']).fileType, 'locations');

console.log('\n== POSITIONS EXPORT (programme-wide, 8 devices) ==');
const P = parseArgosPositions(pos.data);
chk('dominant device', P.ptt, 47128);
chk('other devices counted', P.otherDevices, 7);
chk('rows from other devices dropped', P.droppedRows, 111);
chk('fixes for 47128', P.fixes.length, 574);
chk('class histogram', P.fixes.reduce((a: Record<string, number>, f) => ((a[f.quality] = (a[f.quality] || 0) + 1), a), {}), { '2': 262, B: 157, A: 86, '3': 68, '1': 1 });
chk('first fix ISO', P.fixes[0].date.toISOString(), '2026-09-24T14:43:44.000Z');
chk('last fix ISO', P.fixes.at(-1)!.date.toISOString(), '2026-10-01T14:29:25.000Z');
chk('per-fix error radius carried', P.fixes.at(-1)!.errorRadius, 284);
chk('effective error uses the radius', P.fixes.at(-1)!.effectiveError, 284);
chk('nothing from the Massachusetts tag', P.fixes.every((f) => f.latitude < 32), true);

console.log('\n== MESSAGES EXPORT (no Position ID, no Signal Level) ==');
const rowsAll = messagePaths.flatMap((p) => csv(p).data);
const M = parseArgosMessages(rowsAll);
chk('dominant device', M.ptt, 47128);
chk('messages deduplicated across overlapping windows', M.messageTimes.length, 2043);
chk('fixes keyed on Doppler date + coordinates', M.fixes.length > 500, true);
chk('fix count agrees with the positions export within a few', Math.abs(M.fixes.length - P.fixes.length) <= 5, true);
chk('fixes carry the reported radius', M.fixes.at(-1)!.errorRadius > 0, true);
chk('passes rebuilt without a satellite column', M.passes.length > 100, true);
chk('passes not inflated beyond messages', M.passes.reduce((s, p) => s + p.msgCount, 0), 2043);
chk('no signal column -> no power', M.passes.every((p) => p.powerDbm === null), true);
chk('no fix from the other devices', M.fixes.every((f) => f.latitude < 32), true);

console.log('\n== THROUGH THE ANALYSERS ==');
chk('positions export classifies as drifting', classifyDrift(P.fixes).allTime, 'drifting');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
