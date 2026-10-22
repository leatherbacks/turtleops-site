/**
 * "Since your last analysis": what the next upload of a tag says changed.
 *
 * MiniPAT 33938's exports of 15–21 Oct 2026, each analysed as the site does
 * (position and radius), each compared with the one before through the row
 * tag_last_seen keeps. See analysis/sinceLast.ts.
 *
 *   npx tsx parsers/__tests__/sincelast.verify.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { classifyDrift } from '@/analysis/drift';
import { markOutliers } from '@/analysis/outliers';
import { computePosition } from '@/analysis/position';
import { computeSearchRadius } from '@/analysis/searchRadius';
import { stoppedSince } from '@/analysis/restingPeriod';
import { sinceLast, type LastSeen, type SinceLastInput } from '@/analysis/sinceLast';
import { parseLocations } from '@/parsers/wc/locations';
import { parseArgos } from '@/parsers/wc/argos';
import { parseSummary } from '@/parsers/wc/summary';
import type { ArgosFix } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;
function dataDir(name: string): string | null {
  for (const root of [process.env.TAGFINDER_FIXTURES, process.env.HOME && resolve(process.env.HOME, 'Documents/Apps/tagfinder/data')]) {
    if (root && existsSync(resolve(root, name))) return resolve(root, name);
  }
  return null;
}

/** Position and radius as the page computes them for a drifting-then-stopped tag. */
function analyse(fixes: ArgosFix[]) {
  const prelim = classifyDrift(fixes);
  markOutliers(fixes, prelim.recent !== 'insufficient' ? prelim.recent : prelim.allTime === 'insufficient' ? 'stuck' : prelim.allTime);
  const drift = classifyDrift(fixes);
  let label = drift.recent !== 'insufficient' ? drift.recent : drift.allTime;
  if (label === 'drifting' && stoppedSince(fixes)) label = 'stuck';
  const pos = computePosition(fixes, label === 'insufficient' ? 'stuck' : label);
  const radius = computeSearchRadius(label === 'drifting' ? fixes : pos.basis, { driftLabel: label });
  return { lat: pos.lat, lon: pos.lon, radiusM: radius.primaryM };
}

interface Export { name: string; input: SinceLastInput; row: LastSeen }
function load(name: string, cut?: Date): Export | null {
  const dir = dataDir(name);
  if (!dir) return null;
  let fixes = parseLocations(csv(resolve(dir, '33938-Locations.csv')));
  let passes = parseArgos(csv(resolve(dir, '33938-Argos.csv')));
  if (cut) {
    fixes = fixes.filter((f) => f.date <= cut);
    passes = passes.filter((p) => p.date <= cut);
  }
  const summary = parseSummary(csv(resolve(dir, '33938-Summary.csv')));
  const a = analyse(fixes);
  const times = fixes.map((f) => f.date.getTime());
  const newest = passes.reduce<Date | null>((m, p) => (!m || p.date > m ? p.date : m), null);
  const iso = (t: number) => new Date(t).toISOString();
  return {
    name,
    input: { releaseAt: summary?.releaseDate ?? null, fixes, newestMessage: newest, bestLat: a.lat, bestLon: a.lon },
    row: {
      ptt: 33938,
      releaseAt: summary?.releaseDate?.toISOString() ?? null,
      firstDataAt: iso(Math.min(...times)),
      lastFixAt: iso(Math.max(...times)),
      lastMessageAt: newest?.toISOString() ?? null,
      fixCount: fixes.length,
      bestLat: a.lat,
      bestLon: a.lon,
      radiusM: a.radiusM,
      analyzedAt: '2026-10-21T00:00:00Z',
    },
  };
}
const kinds = (s: ReturnType<typeof sinceLast>) => s?.items.map((i) => i.kind).join(',') ?? 'null';
const text = (s: ReturnType<typeof sinceLast>) => s?.items.map((i) => i.text).join(' | ') ?? '';

console.log('== 33938, export by export ==');
const names = ['wc-33938-2026-10-16', 'wc-33938-2026-10-19', 'wc-33938-2026-10-20', 'wc-33938-2026-10-21', 'wc-33938-2026-10-21b', 'wc-33938-2026-10-21c'];
const exports = names.map((n) => load(n)).filter((e): e is Export => e !== null);
if (exports.length < 2) {
  console.log('  (33938 exports absent)');
} else {
  chk('first analysis of a tag: no banner', sinceLast(null, exports[0].input) === null);
  for (let i = 1; i < exports.length; i++) {
    const s = sinceLast(exports[i - 1].row, exports[i].input);
    console.log(`  ${exports[i - 1].name.slice(-10)} -> ${exports[i].name.slice(-10)}: ${text(s)}`);
    chk(`${exports[i].name.slice(-6)}: new data, not moved (the lockup all week)`, !!s && s.items.some((x) => x.kind === 'new_data') && !s.items.some((x) => x.kind === 'moved'), kinds(s));
  }
  const last = exports[exports.length - 1];
  const same = sinceLast(last.row, last.input);
  chk('same export twice: nothing new', kinds(same) === 'nothing_new', kinds(same));
  const back = sinceLast(last.row, exports[0].input);
  chk('an older export after a newer one: says so', !!back?.items.some((x) => x.kind === 'older_file'), kinds(back));
  chk('...and does not claim nothing new', !back?.items.some((x) => x.kind === 'nothing_new'));

  // Afloat on 13 Oct, then the 15 Oct export: drifted ashore.
  const afloat = load('wc-33938-2026-10-21c', new Date('2026-10-13T12:00:00Z'));
  if (afloat) {
    const s = sinceLast(afloat.row, last.input);
    console.log(`  afloat 13 Oct -> 21 Oct: ${text(s)}`);
    chk('afloat 13 Oct -> ashore: moved, kilometres, toward the SW', !!s && /moved [\d.]+ km (SW|S|W)/.test(s.items[0]?.text ?? ''), s?.items[0]?.text);
  }

  // A windowed download (as Lotek and CLS give): fixes from 18 Oct only.
  const windowed = { ...last.input, fixes: last.input.fixes.filter((f) => f.date >= new Date('2026-10-18T00:00:00Z')) };
  const w = sinceLast(exports[0].row, windowed);
  chk('a file that starts later than the record seen: add earlier downloads', !!w?.items.some((x) => x.kind === 'partial_file'), kinds(w));

  // The PTT refurbished and redeployed: a different release, no comparison.
  const redeployed = { ...last.input, releaseAt: new Date('2027-05-01T00:00:00Z') };
  chk('a new deployment of the same PTT: no banner', sinceLast(last.row, redeployed) === null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
