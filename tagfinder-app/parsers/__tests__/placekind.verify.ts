/**
 * What the search circle is centred on, and what it changes.
 *
 *   npx tsx parsers/__tests__/placekind.verify.ts
 */
import { classifyPlace, placeAdvice, INHABITED_KINDS } from '@/lib/placeKind';
import { analyzeTagState } from '@/analysis/tagState';
import type { ArgosFix } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(62)} got=${JSON.stringify(got)}${ok ? '' : `  want=${JSON.stringify(want)}`}`);
};

console.log('\n== CLASSIFY ==');
chk('OSM camp_site is a campground', classifyPlace('tourism', 'camp_site'), 'campground');
chk('caravan_site too', classifyPlace('tourism', 'caravan_site'), 'campground');
chk('hotel is lodging', classifyPlace('tourism', 'hotel'), 'lodging');
chk('house is a residence', classifyPlace('building', 'house'), 'residence');
chk('marina', classifyPlace('leisure', 'marina'), 'marina');
chk('parking', classifyPlace('amenity', 'parking'), 'parking');
chk('pier', classifyPlace('man_made', 'pier'), 'pier');
chk('beach', classifyPlace('natural', 'beach'), 'beach');
chk('a road', classifyPlace('highway', 'residential'), 'road');
chk('open water', classifyPlace('natural', 'water'), 'water');
chk('unknown tags are other', classifyPlace('', ''), 'other');
chk('inhabited kinds exclude the beach', INHABITED_KINDS.has('beach'), false);
chk('campground advice says ask at the office', /office/.test(placeAdvice({ name: 'Ocean Waves Campground', kind: 'campground', category: 'tourism', type: 'camp_site' }) ?? ''), true);
chk('beach has no advice', placeAdvice({ name: null, kind: 'beach', category: 'natural', type: 'beach' }), null);

console.log('\n== TAG STATE ==');
const T0 = Date.UTC(2026, 9, 1, 12), H = 3600_000;
const fix = (h: number, lat: number, lon: number) => ({ date: new Date(T0 + h * H), quality: '3', latitude: lat, longitude: lon, errorRadius: 200, semiMajor: 0, semiMinor: 0, orientation: 0, effectiveError: 200, isOutlier: false }) as unknown as ArgosFix;
const st = (h: number, temp: number) => ({ date: new Date(T0 + h * H), temperature: temp, depth: 0 }) as never;
const summary = { releaseDate: new Date(T0 - 24 * H) } as never;
// 40996 on the morning of 2 Oct: fixes over ~1 km on a campground, sunlit heat only, 22 °C nights.
const fixes = [fix(0, 35.5734, -75.4693), fix(2, 35.5721, -75.4656), fix(13, 35.5708, -75.4645), fix(17, 35.5715, -75.4624), fix(22, 35.5722, -75.4584)];
const temps = [st(1.9, 36.7), st(2.25, 40.9), st(11.4, 21.6), st(13.2, 22.3)];
const camp = { elevation: { meters: 2.4, source: 'usgs', classification: 'land' }, location: { name: 'Dare County, NC', county: 'Dare', state: 'NC', source: 'census', place: { name: 'Ocean Waves Campground', kind: 'campground', category: 'tourism', type: 'camp_site' } } } as never;
const r = analyzeTagState(temps, summary, camp, [], null, fixes, null, null, null, null);
chk('campground alone: still stranded on land (a beach tag in front of it reads the same)', r.phase, 'stranded_on_land');
chk('...but the reasoning says to ask at the office', /Ocean Waves Campground.*office/.test(r.reasoning), true);
const tight = [fix(0, 35.5713, -75.4634), fix(2, 35.5713, -75.4635), fix(13, 35.5714, -75.4634)];
chk('campground plus a tight cluster: likely recovered', analyzeTagState(temps, summary, camp, [], null, tight, null, null, null, null).phase, 'likely_recovered');
const beach = { ...(camp as object), location: { name: 'Dare County, NC', county: 'Dare', state: 'NC', source: 'census', place: { name: null, kind: 'beach', category: 'natural', type: 'beach' } } } as never;
chk('a beach place adds nothing', /office|desk|Knock/.test(analyzeTagState(temps, summary, beach, [], null, fixes, null, null, null, null).reasoning), false);
chk('no place at all still works', analyzeTagState(temps, summary, { elevation: { meters: 2.4, source: 'usgs', classification: 'land' } } as never, [], null, fixes, null, null, null, null).phase, 'stranded_on_land');

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
