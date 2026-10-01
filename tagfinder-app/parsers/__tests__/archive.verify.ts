/**
 * Zip expansion at intake: a built zip with the usual junk inside, a workbook
 * zip left whole, non-zips passed through, and the real Wildlife Computers
 * portal zip when the fixture is present.
 *
 *   npx tsx parsers/__tests__/archive.verify.ts
 */
import { readFileSync } from 'fs';
import { deflateRawSync } from 'zlib';
import Papa from 'papaparse';
import { expandArchives } from '@/parsers/archive';
import { detectFile } from '@/parsers/detect';
import { fixture } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(56)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};

function zip(files: { name: string; data: Uint8Array | string; store?: boolean }[]): Uint8Array {
  const parts: Buffer[] = []; const central: Buffer[] = []; let offset = 0;
  for (const f of files) {
    const raw = typeof f.data === 'string' ? Buffer.from(f.data, 'utf8') : Buffer.from(f.data);
    const comp = f.store ? raw : deflateRawSync(raw); const method = f.store ? 0 : 8; const name = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, comp);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(cd, name); offset += local.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central); const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10); eocd.writeUInt32LE(cdBuf.length, 12); eocd.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...parts, cdBuf, eocd]); return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}
const LOC = 'DeployID,Ptt,Instr,Date,Type,Quality,Latitude,Longitude,Error radius,Error Semi-major axis,Error Semi-minor axis,Error Ellipse orientation\n1,1,MiniPAT,13:52:55 01-Oct-2026,Argos,1,35.57,-75.47,518,1410,190,88\n';
const STATUS = 'DeployID,Ptt,DepthSensor,Instr,SW,RTC,Received,Time Offset,LocationQuality,Latitude,Longitude,Type\n1,1,0.5,MiniPAT,2.05h,13:50:50 01-Oct-2026,13:51:26 01-Oct-2026,36,1,35.57,-75.47,CRC\n';

(async () => {
  console.log('\n== BUILT ZIP ==');
  const inner = zip([{ name: '1-Status.csv', data: STATUS }]);
  const z = zip([
    { name: '40996/', data: '', store: true },
    { name: '40996/1-Locations.csv', data: LOC },
    { name: '__MACOSX/40996/._1-Locations.csv', data: 'junk' },
    { name: '40996/.DS_Store', data: 'junk', store: true },
    { name: '40996/empty.txt', data: '' },
    { name: '40996/nested.zip', data: inner, store: true },
  ]);
  const r = await expandArchives([new File([z as BlobPart], 'export.zip'), new File(['TimeS,ExtTemp,Pressure\n'], 'plain.csv')]);
  chk('zip expanded, plain file passed through', r.files.map((f) => f.name), ['1-Locations.csv', '1-Status.csv', 'plain.csv']);
  chk('junk, dotfiles, directories and empties dropped', r.files.some((f) => /MACOSX|DS_Store|empty/.test(f.name)), false);
  chk('archive recorded with its count', r.archives.map((a) => [a.file.name, a.count]), [['export.zip', 2]]);
  const loc = r.files[0];
  const parsed = Papa.parse<Record<string, string>>(await loc.text(), { header: true, skipEmptyLines: true });
  chk('an expanded file detects as it would loose', detectFile(loc, parsed.meta.fields!).fileType, 'locations');

  console.log('\n== LEFT ALONE ==');
  const wb = zip([{ name: 'xl/workbook.xml', data: '<workbook/>' }, { name: 'xl/worksheets/sheet1.xml', data: '<worksheet/>' }]);
  const w = await expandArchives([new File([wb as BlobPart], 'book.xlsx')]);
  chk('a workbook zip is not expanded', w.files.map((f) => f.name), ['book.xlsx']);
  chk('...and not counted as an archive', w.archives.length, 0);
  const empty = await expandArchives([new File([zip([{ name: '__MACOSX/x', data: 'j' }]) as BlobPart], 'nothing.zip')]);
  chk('a zip with nothing usable yields no files', empty.files.length, 0);
  chk('...but is reported with count 0', empty.archives[0].count, 0);
  const notZip = await expandArchives([new File([new Uint8Array([1, 2, 3, 4, 5]) as BlobPart], 'x.bin')]);
  chk('a non-zip passes through untouched', notZip.files[0].name, 'x.bin');

  const real = fixture(/^\d{5}\.zip$/);
  if (real) {
    console.log('\n== REAL PORTAL ZIP ==');
    const buf = readFileSync(real);
    const rr = await expandArchives([new File([new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength) as BlobPart], real.split('/').pop()!)]);
    console.log(`        ${rr.archives[0]?.count ?? 0} files: ${rr.files.map((f) => f.name).join(', ')}`);
    chk('the portal zip is recognised as an archive', rr.archives.length, 1);
    // 41008-All.csv is stored with zero bytes in this zip; it is skipped, not fatal.
    chk('a broken entry does not take the others down', rr.files.length >= 10, true);
    chk('yields the portal CSVs', rr.files.some((f) => /-Locations\.csv$/.test(f.name)) && rr.files.some((f) => /-Status\.csv$/.test(f.name)), true);
    chk('nothing from resource forks', rr.files.every((f) => !f.name.startsWith('._')), true);
  } else {
    console.log('  (no portal zip fixture — real-file check skipped)');
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
