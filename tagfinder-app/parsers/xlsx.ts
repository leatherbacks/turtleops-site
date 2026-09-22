/**
 * Minimal .xlsx reader — just enough to get cell text out of a workbook.
 *
 * Exists because Lotek's portal ships its decoded logs as one Excel workbook,
 * and telling the user "save each sheet as CSV first" turned out to be both
 * unhelpful and wrong: the sheets do not share headers with the CSV exports the
 * site already reads, so the CSV would have been refused too.
 *
 * Deliberately not a spreadsheet library. It handles what a data export needs
 * — sheet names, shared and inline strings, numbers — and nothing that a data
 * export never contains: no styles, no dates-as-serials, no formulas evaluated,
 * no merged ranges, no ZIP64. A cell's text is returned as written; the caller
 * decides what it means.
 *
 * Runs in the browser and in Node without a dependency. Inflation is done by
 * the platform's DecompressionStream ('deflate-raw'), which every current
 * browser and Node 21+ provide.
 */

export interface XlsxSheet {
  name: string;
  /** Dense rows of cell text, row-major, '' for absent cells. */
  rows: string[][];
}

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;

/** True for a PKZIP container, which is what .xlsx / .ods are. */
export function isZipMagic(magic: Uint8Array): boolean {
  return magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04;
}

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  localHeaderOffset: number;
}

/**
 * Read the central directory. The local headers are not trusted for sizes —
 * a writer using data descriptors leaves them zero — but the central
 * directory is always complete, which is why the ZIP format puts it last.
 */
function readCentralDirectory(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // EOCD is at the very end, preceded only by an optional comment (<= 64 KiB).
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= floor; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a ZIP archive: no end-of-central-directory record.');

  const count = view.getUint16(eocd + 10, true);
  const dirOffset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let p = dirOffset;
  const decoder = new TextDecoder();
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== SIG_CENTRAL) throw new Error('Corrupt ZIP central directory.');
    const method = view.getUint16(p + 10, true);
    const compressedSize = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localHeaderOffset = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.push({ name, method, compressedSize, localHeaderOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(
    new DecompressionStream('deflate-raw')
  );
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function extract(bytes: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const h = entry.localHeaderOffset;
  if (view.getUint32(h, true) !== SIG_LOCAL) throw new Error(`Corrupt ZIP local header for ${entry.name}.`);
  const nameLen = view.getUint16(h + 26, true);
  const extraLen = view.getUint16(h + 28, true);
  const start = h + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + entry.compressedSize);
  if (entry.method === METHOD_STORED) return data;
  if (entry.method === METHOD_DEFLATE) return inflateRaw(data);
  throw new Error(`Unsupported ZIP compression method ${entry.method} for ${entry.name}.`);
}

// ─── XML helpers (regex over well-formed OOXML — not a general XML parser) ───

function unescapeXml(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(amp|lt|gt|quot|apos|#x[0-9a-fA-F]+|#\d+);/g, (_, e: string) => {
    switch (e) {
      case 'amp': return '&';
      case 'lt': return '<';
      case 'gt': return '>';
      case 'quot': return '"';
      case 'apos': return "'";
    }
    const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : '';
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag);
  return m ? unescapeXml(m[1]) : null;
}

/** Concatenate every <t> run inside a string item — rich text is several runs. */
function textRuns(inner: string): string {
  let out = '';
  const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(inner)) !== null) out += unescapeXml(m[1]);
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(textRuns(m[1]));
  return out;
}

/** "A" -> 0, "Z" -> 25, "AA" -> 26. */
function columnIndex(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function parseSheet(xml: string, shared: string[]): string[][] {
  const rows: string[][] = [];
  // Cells are either self-closing (<c r="A1" s="2"/>, an empty styled cell) or
  // <c ...>...</c>. The alternation keeps a self-closing cell from swallowing
  // everything up to the next cell's close tag.
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let m: RegExpExecArray | null;
  let rowIdx = -1;
  let colIdx = -1;
  while ((m = cellRe.exec(xml)) !== null) {
    const tag = m[1];
    const inner = m[2] ?? '';
    const ref = attr(tag, 'r');
    if (ref) {
      const rm = /^([A-Z]+)(\d+)$/.exec(ref);
      if (rm) {
        colIdx = columnIndex(rm[1]);
        rowIdx = parseInt(rm[2], 10) - 1;
      } else {
        colIdx++;
      }
    } else {
      // Cells without an address are laid out consecutively.
      colIdx++;
    }
    if (rowIdx < 0) continue;

    let text = '';
    const type = attr(tag, 't');
    if (type === 's') {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      const idx = v ? parseInt(v[1], 10) : NaN;
      text = Number.isFinite(idx) ? shared[idx] ?? '' : '';
    } else if (type === 'inlineStr') {
      text = textRuns(inner);
    } else {
      const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
      text = v ? unescapeXml(v[1]) : '';
      if (type === 'b') text = text === '1' ? 'TRUE' : 'FALSE';
    }

    while (rows.length <= rowIdx) rows.push([]);
    const row = rows[rowIdx];
    while (row.length <= colIdx) row.push('');
    row[colIdx] = text;
  }
  return rows;
}

/** Resolve a workbook relationship target to a ZIP entry name. */
function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  return 'xl/' + target;
}

/**
 * Read every worksheet in a .xlsx, in workbook order.
 *
 * Throws on anything that is not a readable workbook; callers that are only
 * asking "is this one of ours?" should catch and treat the throw as "no".
 */
export async function readXlsx(bytes: Uint8Array): Promise<XlsxSheet[]> {
  const entries = readCentralDirectory(bytes);
  const byName = new Map(entries.map((e) => [e.name, e]));
  const text = async (name: string): Promise<string | null> => {
    const e = byName.get(name);
    if (!e) return null;
    return new TextDecoder().decode(await extract(bytes, e));
  };

  const workbook = await text('xl/workbook.xml');
  if (!workbook) throw new Error('Not a workbook: xl/workbook.xml is missing.');
  const rels = (await text('xl/_rels/workbook.xml.rels')) ?? '';

  const relTargets = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*>/g;
  let m: RegExpExecArray | null;
  while ((m = relRe.exec(rels)) !== null) {
    const id = attr(m[0], 'Id');
    const target = attr(m[0], 'Target');
    if (id && target) relTargets.set(id, resolveTarget(target));
  }

  const sharedXml = await text('xl/sharedStrings.xml');
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const sheets: XlsxSheet[] = [];
  const sheetRe = /<sheet\b[^>]*>/g;
  let n = 0;
  while ((m = sheetRe.exec(workbook)) !== null) {
    n++;
    const name = attr(m[0], 'name') ?? `Sheet${n}`;
    const rid = attr(m[0], 'r:id') ?? attr(m[0], 'id');
    const entryName =
      (rid && relTargets.get(rid)) ?? `xl/worksheets/sheet${n}.xml`;
    const xml = await text(entryName);
    if (xml === null) continue;
    sheets.push({ name, rows: parseSheet(xml, shared) });
  }
  return sheets;
}
