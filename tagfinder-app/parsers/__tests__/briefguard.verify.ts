/**
 * The brief guard: the verdicts block says what the panels say, and a brief
 * whose opening contradicts the tag state is caught.
 *
 *   npx tsx parsers/__tests__/briefguard.verify.ts
 */
import { verdictsBlock, findContradiction, contradictionNotice } from '@/lib/briefGuard';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(60)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};

// PTT 40996 on 1 Oct 2026, as the panels had it.
const stranded = {
  tagState: { phase: 'stranded_on_land', reasoning: 'Position is on land (elevation 1.8m) — depth reading (1.0m) may indicate partial burial' },
  tempComparison: { environment: 'anomalously_hot', reasoning: 'Tag mean temperature is 38.8°C — unusually warm.' },
  bathymetry: { seabedDepthM: null },
  driftState: { recent: 'insufficient', medium: 'insufficient', allTime: 'insufficient' },
  releaseInterpretation: { label: 'Scheduled release' },
};
const env = { elevation: { meters: 1.8, classification: 'land' }, location: { name: 'Dare County, NC' }, tides: { station: 'Rodanthe, Pamlico Sound', stationDistanceKm: 2.5 } };
const briefAsWritten = `**Headline:** The tag is afloat at the surface near 35.5735 N, 75.4650 W, over about 18 m of water, released normally on schedule — search by boat within a 500 m circle.

The position is fresh: both fixes came in within the last two hours.`;

console.log('\n== VERDICTS BLOCK ==');
const block = verdictsBlock(stranded, env);
chk('states the tag state first', /Tag state: STRANDED_ON_LAND/.test(block), true);
chk('states on land per GEBCO', /on land per GEBCO/.test(block), true);
chk('carries the place name', /Dare County, NC/.test(block), true);
chk('carries the tide station distance', /Rodanthe.*2\.5 km/.test(block), true);
chk('forbids a boat for a tag ashore', /do not recommend a boat/i.test(block), true);
chk('warns off the dive profile as seabed', /dive profile.*pre-release/i.test(block), true);
chk('in-water phase gets the opposite rule', /IN THE WATER/.test(verdictsBlock({ tagState: { phase: 'surface' } }, {})), true);
chk('unknown phase asks for honesty', /undetermined/.test(verdictsBlock({ tagState: { phase: 'unknown' } }, {})), true);
chk('survives an empty analysis', typeof verdictsBlock(null, null), 'string');

console.log('\n== CONTRADICTION CHECK ==');
chk('40996 brief is caught', findContradiction(briefAsWritten, stranded) !== null, true);
chk('...naming the offending words', /afloat/.test(findContradiction(briefAsWritten, stranded) ?? ''), true);
chk('a consistent brief passes', findContradiction('**Headline:** The tag is on land at a house in Waves, NC — walk to it.\n\nDetails.', stranded), null);
chk('"search by boat" alone is caught for a tag ashore', findContradiction('Go search by boat now.\n\nMore.', stranded) !== null, true);
chk('in-water tag called beached is caught', findContradiction('The tag is beached near the inlet.\n\nMore.', { tagState: { phase: 'surface' } }) !== null, true);
chk('in-water tag called afloat passes', findContradiction('The tag is afloat and drifting.\n\nMore.', { tagState: { phase: 'surface' } }), null);
chk('only the opening is judged', findContradiction('The tag is on land.\n\nSecond paragraph.\n\nA boat would have been needed had it been at sea.', stranded), null);
chk('unknown phase never contradicts', findContradiction(briefAsWritten, { tagState: { phase: 'unknown' } }), null);
chk('missing tag state never contradicts', findContradiction(briefAsWritten, {}), null);
chk('notice names the panels as authoritative', /authoritative/.test(contradictionNotice('x')), true);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
