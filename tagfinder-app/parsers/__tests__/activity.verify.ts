/**
 * The 0xA0 activity-message decode against two manufacturer decodes of the same
 * payloads: Lotek's Dive Log CSV for one deployment (3,225 samples) and Lotek's
 * downloader container for another (paired on reception time). Counts come
 * from an independent Python pairing of the same files.
 *
 *   npx tsx parsers/__tests__/activity.verify.ts
 */
import { readFileSync, readdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { decodeActivityMessage, parseLotekActivityMessages, crc8 } from '@/parsers/lotek/activityMessage';
import { parseLotekDiveLog } from '@/parsers/lotek/diveLog';
import { parseLotekArgosContainer } from '@/parsers/lotek/argosContainer';
import { fixture, requireFixture, MESSAGES_CSV, LOTEK_DIVE_LOG, LOTEK_ARGOS_BIN, CLS_MESSAGES_2026 } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;

console.log('\n== LAYOUT ==');
// A clean 47128 payload paired against Lotek's decode: 8 records, 2375/237 … 2416/241.
const sample = Uint8Array.from('a032318cc4e4947d0e971e0e96aa0ecb985e0e98910f96ff0e960ef10f973d'.match(/../g)!.map((x) => parseInt(x, 16)));
const d = decodeActivityMessage(sample)!;
chk('record 0 time is absolute seconds since 2000', new Date(Date.UTC(2000, 0, 1) + d.baseTagSeconds * 1000).toISOString(), '2026-09-07T14:55:00.000Z');
chk('block 1 CRC-8 (0x07, init FF) verifies', d.block1Verified, true);
chk('eight records', d.records.length, 8);
chk('temperatures raw', d.records.map((r) => r!.temperatureRaw), [2375, 2417, 2410, 2437, 2441, 2415, 2400, 2416]);
chk('depths', d.records.map((r) => r!.depth), [237, 238, 234, 238, 241, 239, 239, 241]);
chk('a flipped bit fails the CRC', (() => { const b = Uint8Array.from(sample); b[7] ^= 0x01; return decodeActivityMessage(b)!.block1Verified; })(), false);
chk('crc8 of an empty block is the init', crc8(new Uint8Array(0)), 0xff);

console.log('\n== AGAINST LOTEK\'S DIVE LOG CSV (second deployment) ==');
const diveCsv = requireFixture(LOTEK_DIVE_LOG);
const msgCsv = requireFixture(MESSAGES_CSV);
const lotek = parseLotekDiveLog(csv(diveCsv));
const byTime = new Map(lotek.readings.map((r) => [r.date.getTime(), r]));
const act = parseLotekActivityMessages(csv(msgCsv));
chk('records decoded in bulk (CRC-passing messages only)', act.records.length > 3000, true);
let v = 0, vExact = 0, u = 0, uExact = 0;
for (const r of act.records) {
  const l = byTime.get(r.date.getTime());
  if (!l || l.depth === null || l.temperature === null) continue;
  const exact = r.depth === l.depth && Math.abs(r.temperatureC - l.temperature) < 0.011;
  if (r.verified) { v++; if (exact) vExact++; } else { u++; if (exact) uExact++; }
}
chk('verified records with a Lotek counterpart', v > 1200, true);
chk('verified records exact on temperature AND depth', vExact === v, true);
console.log(`        verified ${vExact}/${v}, unverified ${uExact}/${u} (${((100 * uExact) / u).toFixed(1)}%)`);
chk('unverified records mostly exact (block 2 has no usable check)', uExact / u > 0.93, true);
chk('decoded records outnumber what Argos delivered intact to Lotek', act.records.length > lotek.readings.length, true);

console.log('\n== AGAINST LOTEK\'S CONTAINER (paired on reception time) ==');
const bin = fixture(LOTEK_ARGOS_BIN);
const binDir = bin ? bin.slice(0, bin.lastIndexOf('/')) : null;
const clsDir = resolve(process.env.HOME ?? '', 'Downloads');
const clsFiles = existsSync(clsDir) ? readdirSync(clsDir).filter((f) => CLS_MESSAGES_2026.test(f)).map((f) => resolve(clsDir, f)) : [];
if (bin && clsFiles.length) {
  const buf = readFileSync(bin);
  const c = parseLotekArgosContainer(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
  const byTag = new Map(c.dive.readings.map((r) => [r.date.getTime(), r]));
  const rows = clsFiles.flatMap((p) => csv(p)).filter((r) => (r['Device ID'] ?? '').trim() === String(c.ptt));
  const a = parseLotekActivityMessages(rows);
  let n = 0, exact = 0;
  for (const r of a.records) {
    if (!r.verified) continue;
    const l = byTag.get(r.date.getTime());
    if (!l) continue;
    n++;
    if (l.depth === r.depth && Math.abs((l.temperature ?? NaN) - r.temperatureC) < 0.011) exact++;
  }
  chk('verified records with a container counterpart', n > 1000, true);
  // CRC-8 lets one corruption in 256 through on either side; 99.5% is the
  // agreement two independent decodes of the same noisy channel should reach.
  chk('at least 99.5% of them exact', exact / n >= 0.995, true);
  console.log(`        ${exact}/${n} exact; ${a.records.length} records decoded from ${rows.length} rows`);
} else {
  console.log('  (container or 2026 CLS export not present — pairing check skipped)');
}

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
