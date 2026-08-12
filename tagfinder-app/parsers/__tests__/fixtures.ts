import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';

/**
 * Locations of the real tag exports these verification scripts run against.
 *
 * The datasets are collaborators' unpublished field data and are deliberately
 * not committed, so paths are resolved at run time and a missing file skips the
 * affected checks rather than failing them. Point TAGFINDER_FIXTURES at a
 * directory holding the exports, or drop them in ./fixtures next to this file.
 *
 *   TAGFINDER_FIXTURES=~/Downloads npx tsx parsers/__tests__/lotek.verify.ts
 */

const ROOTS = [
  process.env.TAGFINDER_FIXTURES,
  resolve(__dirname, 'fixtures'),
  // Convenience for the machine this was developed on; harmless elsewhere.
  process.env.HOME ? resolve(process.env.HOME, 'Downloads') : undefined,
  process.env.HOME
    ? resolve(process.env.HOME, 'Documents/Apps/tagfinder/data/lotek')
    : undefined,
  process.env.HOME
    ? resolve(process.env.HOME, 'Documents/Apps/tagfinder/data/wc-41008')
    : undefined,
].filter((r): r is string => typeof r === 'string' && r.length > 0);

/** Absolute path to a fixture, or null when it is not present on this machine. */
export function fixture(name: string | RegExp): string | null {
  for (const root of ROOTS) {
    if (typeof name === 'string') {
      const p = resolve(root, name);
      if (existsSync(p)) return p;
      continue;
    }
    if (!existsSync(root)) continue;
    const hit = readdirSync(root).find((f) => name.test(f));
    if (hit) return resolve(root, hit);
  }
  return null;
}

/**
 * Resolve a fixture or exit cleanly with a skip notice.
 *
 * Exits 0, not 1: a fresh clone without the field data has not failed, it just
 * cannot run this particular check.
 */
export function requireFixture(name: string | RegExp): string {
  const p = fixture(name);
  if (p) return p;
  console.log(
    `\n  SKIP — fixture not found: ${name}\n` +
      `  Set TAGFINDER_FIXTURES to a directory containing it, or place it in\n` +
      `  parsers/__tests__/fixtures/. Searched:\n` +
      ROOTS.map((r) => `    ${r}`).join('\n') +
      '\n'
  );
  process.exit(0);
}

// Matched as patterns rather than literal names: the exports are named after
// the PTT, which differs per deployment and is not ours to publish.
export const MESSAGES_CSV = /_messages\.csv$/i;
export const RAW_DS_TXT = /^RAW_ID_.*\.txt$/i;
export const LOTEK_DAY_LOG = /Day Log\.csv$/i;
export const LOTEK_DIVE_LOG = /Dive Log\.csv$/i;

/**
 * PTT of whatever reference dataset is present, read from the fixture filename.
 *
 * Lets the checks assert on a real PTT without committing a collaborator's tag
 * ID to the repository.
 */
export function fixturePtt(): number {
  const p = requireFixture(MESSAGES_CSV);
  const m = p.split('/').pop()?.match(/(\d{4,7})/);
  if (!m) {
    console.log('\n  SKIP — could not read a PTT from the fixture filename\n');
    process.exit(0);
  }
  return Number(m[1]);
}
