import { isZipMagic, readZipEntries } from '@/parsers/xlsx';

/**
 * Expand dropped .zip files into the files they hold.
 *
 * The Wildlife Computers portal hands out a deployment as one zip, and the
 * first outside user to try the site from a phone could not open it — the
 * phone had no unzip, the site refused the zip, and the analysis waited for a
 * laptop. The zip reader already existed for the Lotek workbook; this uses it
 * for any zip.
 *
 * A zip that is a workbook (holds xl/workbook.xml) is left whole for the
 * spreadsheet path. Everything else is expanded one level: entries become
 * File objects named by their basename, macOS resource forks and dotfiles are
 * dropped, and a zip with nothing usable is passed through so the file list
 * can say so. Nested zips are expanded too, once.
 */

export interface ExpandedArchives {
  /** The files to run through the intake, zips replaced by their contents. */
  files: File[];
  /** Each zip that was expanded, with how many files it yielded. */
  archives: { file: File; count: number }[];
}

const JUNK = /(^|\/)(__MACOSX|\.[^/]*)(\/|$)/;

function basename(path: string): string {
  const i = path.lastIndexOf('/');
  return i >= 0 ? path.slice(i + 1) : path;
}

async function isZip(file: File): Promise<boolean> {
  if (file.size < 4) return false;
  return isZipMagic(new Uint8Array(await file.slice(0, 4).arrayBuffer()));
}

async function expandOne(file: File, depth: number): Promise<{ files: File[]; count: number } | null> {
  let entries: { name: string; data: Uint8Array }[];
  try {
    entries = await readZipEntries(new Uint8Array(await file.arrayBuffer()));
  } catch {
    return null;
  }
  if (entries.some((e) => e.name === 'xl/workbook.xml')) return null; // a workbook, not an archive
  const out: File[] = [];
  for (const e of entries) {
    if (JUNK.test(e.name) || e.data.length === 0) continue;
    const inner = new File([e.data as BlobPart], basename(e.name), { lastModified: file.lastModified });
    if (depth < 1 && (await isZip(inner))) {
      const nested = await expandOne(inner, depth + 1);
      if (nested) {
        out.push(...nested.files);
        continue;
      }
    }
    out.push(inner);
  }
  return { files: out, count: out.length };
}

export async function expandArchives(files: File[]): Promise<ExpandedArchives> {
  const out: File[] = [];
  const archives: { file: File; count: number }[] = [];
  for (const file of files) {
    if (!(await isZip(file))) {
      out.push(file);
      continue;
    }
    const expanded = await expandOne(file, 0);
    if (!expanded) {
      out.push(file); // workbook or unreadable: let the intake decide
      continue;
    }
    archives.push({ file, count: expanded.count });
    if (expanded.count === 0) continue;
    out.push(...expanded.files);
  }
  return { files: out, archives };
}
