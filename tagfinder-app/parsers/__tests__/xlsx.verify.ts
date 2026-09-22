/**
 * The minimal .xlsx reader, against a workbook built here from scratch — so
 * every case (shared strings, inline strings, rich-text runs, entities, numbers,
 * booleans, sparse columns, styled empty cells, a stored entry beside deflated
 * ones) is known exactly — and against the real Lotek portal workbook when the
 * fixture is present.
 *
 *   npx tsx parsers/__tests__/xlsx.verify.ts
 */
import { readFileSync } from 'fs';
import { deflateRawSync } from 'zlib';
import { readXlsx, isZipMagic } from '@/parsers/xlsx';
import { fixture, LOTEK_PORTAL_XLSX } from './fixtures';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(52)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};

// ─── A tiny ZIP writer: local headers, central directory, EOCD. No CRC check
//     is performed by the reader, so the CRC field is left zero. ───
function zip(files: { name: string; data: string; store?: boolean }[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const raw = Buffer.from(f.data, 'utf8');
    const comp = f.store ? raw : deflateRawSync(raw);
    const method = f.store ? 0 : 8;
    const name = Buffer.from(f.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, name, comp);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(method, 10);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(raw.length, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, name);
    offset += local.length + name.length + comp.length;
  }
  const cdBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const out = Buffer.concat([...parts, cdBuf, eocd]);
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

const WORKBOOK = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Second &amp; Last" sheetId="7" r:id="rId9"/><sheet name="First" sheetId="1" r:id="rId3"/></sheets></workbook>`;
const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId3" Type="x/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId9" Type="x/worksheet" Target="/xl/worksheets/sheet2.xml"/>
<Relationship Id="rId1" Type="x/sharedStrings" Target="sharedStrings.xml"/></Relationships>`;
const SST = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="3" uniqueCount="3">
<si><t>plain</t></si>
<si><r><t>rich </t></r><r><rPr><b/></rPr><t xml:space="preserve">text &amp; runs</t></r></si>
<si><t>a, b, c</t></si></sst>`;
const SHEET1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" s="1"/><c r="B2"><v>42.5</v></c><c r="C2" t="inlineStr"><is><t>in&lt;line&gt;</t></is></c></row>
<row r="4"><c r="AA4" t="b"><v>1</v></c><c r="AB4" t="str"><f>A1</f><v>formula&#39;s text</v></c></row>
</sheetData></worksheet>`;
const SHEET2 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="B1" t="s"><v>2</v></c></row>
</sheetData></worksheet>`;

(async () => {
  console.log('\n== SYNTHETIC WORKBOOK ==');
  const bytes = zip([
    { name: '[Content_Types].xml', data: '<Types/>', store: true },
    { name: 'xl/workbook.xml', data: WORKBOOK },
    { name: 'xl/_rels/workbook.xml.rels', data: RELS, store: true },
    { name: 'xl/sharedStrings.xml', data: SST },
    { name: 'xl/worksheets/sheet1.xml', data: SHEET1 },
    { name: 'xl/worksheets/sheet2.xml', data: SHEET2 },
  ]);
  chk('zip magic', isZipMagic(bytes.subarray(0, 4)), true);
  const sheets = await readXlsx(bytes);
  chk('two sheets, workbook order not file order', sheets.map((s) => s.name), ['Second & Last', 'First']);
  const first = sheets[1];
  chk('shared string', first.rows[0][0], 'plain');
  chk('sparse row pads B1', first.rows[0][1], '');
  chk('rich text runs concatenated + entity', first.rows[0][2], 'rich text & runs');
  chk('styled empty cell is empty, not swallowed', first.rows[1][0], '');
  chk('number as written', first.rows[1][1], '42.5');
  chk('inline string with entities', first.rows[1][2], 'in<line>');
  chk('absent row 3 is present and empty', first.rows[2], []);
  chk('column AA -> index 26', first.rows[3][26], 'TRUE');
  chk('formula string value, numeric entity', first.rows[3][27], "formula's text");
  chk('rooted rel target resolves', sheets[0].rows[0][1], 'a, b, c');
  chk('sheet2 A1 absent', sheets[0].rows[0][0], '');

  console.log('\n== REJECTS ==');
  let threw = false;
  try { await readXlsx(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0, 0, 0])); } catch { threw = true; }
  chk('truncated zip throws', threw, true);
  threw = false;
  try { await readXlsx(zip([{ name: 'hello.txt', data: 'hi' }])); } catch { threw = true; }
  chk('zip without workbook.xml throws', threw, true);

  const real = fixture(LOTEK_PORTAL_XLSX);
  if (real) {
    console.log('\n== REAL PORTAL WORKBOOK ==');
    const buf = readFileSync(real);
    const t0 = Date.now();
    const rs = await readXlsx(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
    const ms = Date.now() - t0;
    chk('sheets', rs.map((s) => s.name), ['Day Log', 'Health Log', 'Dive Log']);
    chk('dive log title cell', rs[2].rows[0][0].startsWith('Activity Dive Log:'), true);
    chk('day log title is in column B', rs[0].rows[0][1].startsWith('Day Log:'), true);
    chk('header cell is comma-joined', rs[2].rows[1][0].split(',').length, 5);
    console.log(`        read 2.8 MB of XML in ${ms} ms`);
    chk('reads in under 5 s', ms < 5000, true);
  } else {
    console.log('\n  (portal workbook fixture not present — real-file checks skipped)');
  }

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
