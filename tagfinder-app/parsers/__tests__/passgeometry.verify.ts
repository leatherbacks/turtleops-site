import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { analyzePassGeometry, tleEpoch } from '@/analysis/passGeometry';
import { normalizeSatName } from '@/analysis/satCoverage';
import { parseArgosMessages } from '@/parsers/argos/messages';
import type { TLEEntry } from '@/analysis/satPrediction';
import { requireFixture, MESSAGES_CSV } from './fixtures';

let pass = 0,
  fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(58)} got=${got}${ok ? '' : ` want=${want}`}`);
};

// Real CelesTrak elements for the two satellites that produced the Aug 11
// fixes, epoch 2026-08-12. Frozen here so the test does not depend on the
// network or drift as elements are refreshed.
//
// These must be genuine. An earlier version of this test used plausible-looking
// but invented TLE lines; the geometry then placed both satellites below the
// horizon (elevation -8.5 and -54.7 degrees) while every other assertion still
// passed. Fabricated fixtures for orbital code produce confidently wrong
// numbers, and only the physical-range check caught it.
const TLES: TLEEntry[] = [
  {
    name: 'KINEIS-2B',
    line1: '1 62934U 25028G   26224.16511047  .00000524  00000+0  88184-4 0  9995',
    line2: '2 62934  97.9631 276.0042 0002915 359.3756   0.7448 14.73507521 80902',
  },
  {
    name: 'KINEIS-2E',
    line1: '1 62931U 25028D   26224.11216944  .00000606  00000+0  92745-4 0  9994',
    line2: '2 62931  97.8919 274.5482 0001535  77.2068 282.9313 14.77148403 81031',
  },
];

console.log('\n== SATELLITE NAME NORMALISATION (the CLS export writes KIN2B) ==');
// 21 of the 25 satellites in a CLS message export use this spelling. Before the
// fix none of them matched a TLE and every Kinéis pass silently fell out of
// coverage analysis.
for (const [input, want] of [
  ['KIN2B', 'KINEIS-2B'],
  ['KIN1A', 'KINEIS-1A'],
  ['KIN5E', 'KINEIS-5E'],
  ['2B', 'KINEIS-2B'],
  ['KINEIS-2B', 'KINEIS-2B'],
  ['KINEIS 2B', 'KINEIS-2B'],
  ['MC', 'METOP-C'],
  ['O3', 'OCEANSAT-3'],
] as const) {
  chk(`normalize ${input}`, normalizeSatName(input), want);
}

console.log('\n== MIRROR GEOMETRY IS SELF-CONSISTENT ==');
const rows = Papa.parse<Record<string, string>>(
  readFileSync(requireFixture(MESSAGES_CSV), 'utf8'),
  { header: true, skipEmptyLines: true }
).data;
const m = parseArgosMessages(rows);
const aug11 = m.passes.filter(
  (p) => p.latitude !== null && p.date >= new Date('2026-08-11T00:00:00Z')
);
const g = analyzePassGeometry(aug11, TLES);
chk('analysis produced', g !== null, true);

if (g) {
  for (const f of g.fixes) {
    console.log(
      `        ${f.date.toISOString()} ${f.satellite}  elev ${f.elevationDeg.toFixed(1)}°  ` +
        `cross-track ${f.crossTrackKm.toFixed(0)} km  mirror ${f.mirrorLat.toFixed(3)},` +
        `${f.mirrorLon.toFixed(3)} (${f.mirrorSeparationKm.toFixed(0)} km away)`
    );
  }
  // Reflection is symmetric about the plane, so cross-track is exactly half the
  // separation. This catches any sign or frame error in the reflection.
  chk('cross-track is exactly half the mirror separation',
    g.fixes.every((f) => Math.abs(f.crossTrackKm * 2 - f.mirrorSeparationKm) < 0.001), true);
  chk('all mirrors land on Earth',
    g.fixes.every((f) => Math.abs(f.mirrorLat) <= 90 && Math.abs(f.mirrorLon) <= 180), true);
  chk('elevations are physical (0-90 deg)',
    g.fixes.every((f) => f.elevationDeg > 0 && f.elevationDeg < 90), true);
  // Cross-checked against an independent SGP4 implementation (python sgp4) run
  // over the same elements: elevations 25.1 and 31.0 deg, cross-track 969 and
  // 271 km. Agreement across two implementations is what makes this trustworthy.
  const byName = Object.fromEntries(g.fixes.map((f) => [f.satellite, f]));
  chk('KIN2B elevation ~25 deg (python: 25.1)',
    Math.abs(byName['KIN2B'].elevationDeg - 25.1) < 2.0, true);
  chk('KIN2E elevation ~31 deg (python: 31.0)',
    Math.abs(byName['KIN2E'].elevationDeg - 31.0) < 2.0, true);
  chk('KIN2B cross-track ~969 km (python)',
    Math.abs(byName['KIN2B'].crossTrackKm - 969) < 60, true);
  chk('KIN2E cross-track ~271 km (python)',
    Math.abs(byName['KIN2E'].crossTrackKm - 271) < 60, true);

  console.log('\n== THE REFERENCE-DEPLOYMENT VERDICT: MIRRORS ARE FAR, SO NOT AN EXPLANATION ==');
  // Computed independently in Python from CelesTrak elements: the two Aug 11
  // mirrors landed 541 km and 1943 km away, out in the Atlantic. The point of
  // the analyzer is to refuse the tempting "it's probably a mirror" story.
  chk('no fix is flagged ambiguous', g.ambiguousCount, 0);
  chk('no fix is flagged suspect', g.suspectCount, 0);
  chk('every mirror is hundreds of km off',
    g.fixes.every((f) => f.mirrorSeparationKm > 100), true);
  chk('reasoning says mirror ambiguity is not plausible',
    /not a plausible explanation/.test(g.reasoning), true);
  console.log(`\n        ${g.reasoning}\n`);
}

console.log('== STALE ORBITAL ELEMENTS MUST BE REFUSED, NOT EXTRAPOLATED ==');
// There is no free source of historical TLEs — CelesTrak's archive stops in 2004
// by law and Space-Track needs credentials — so an old dataset gets analysed
// against today's elements or not at all. SGP4 degrades roughly 1-3 km/day
// along-track, which at three weeks is several degrees of elevation error: the
// very quantity being reported. Bins are 15 degrees wide, so that would start
// moving fixes between categories.
{
  chk('epoch parses out of TLE line 1',
    tleEpoch(TLES[0].line1)?.toISOString().slice(0, 10), '2026-08-12');
  chk('a malformed line yields null', tleEpoch('not a tle'), null);

  // Same fixes, but dated a year before the elements.
  const old = aug11.map((p) => ({
    ...p,
    date: new Date(p.date.getTime() - 365 * 86400_000),
  }));
  const g2 = analyzePassGeometry(old, TLES);
  chk('year-old fixes produce no geometry at all', g2, null);

  // A month back: still refused, and the refusal is explained.
  const month = aug11.map((p) => ({
    ...p,
    date: new Date(p.date.getTime() - 30 * 86400_000),
  }));
  const g3 = analyzePassGeometry(month, TLES);
  chk('month-old fixes refused too', g3, null);

  // Well inside the window: unaffected.
  const fresh = analyzePassGeometry(aug11, TLES)!;
  chk('current fixes still analysed', fresh.fixes.length > 0, true);
  chk('...with no stale skips', fresh.tlesTooStale, 0);
  chk('...and no staleness warning', fresh.tleAgeWarning, false);
  chk('...reporting the epoch age it actually used', fresh.maxTleAgeDays < 5, true);
}

console.log('== GUARDS ==');
chk('no TLEs -> null', analyzePassGeometry(aug11, []), null);
chk('no located passes -> null', analyzePassGeometry([], TLES), null);
const unknownSat = aug11.map((p) => ({ ...p, satellite: 'NOPE' }));
const gu = analyzePassGeometry(unknownSat, TLES);
chk('unmatched satellite -> null rather than a wrong answer', gu, null);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
