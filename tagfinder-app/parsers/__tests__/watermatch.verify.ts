import { solarElevationDeg, dayPhase } from '@/analysis/solar';
import { analyzeWaterMatch, matchToWater } from '@/analysis/waterMatch';
import type { WaterTempSample, TagTempReading } from '@/analysis/waterMatch';

let pass = 0, fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(58)} got=${JSON.stringify(got)}` +
      (ok ? '' : ` want=${JSON.stringify(want)}`)
  );
};

// A subtropical western-boundary-current coast, matching the deployment this
// analysis was built for. Kept as coordinates rather than a place name.
const LAT = 25.8998, LON = -80.1367;
const DAY0 = Date.UTC(2026, 7, 7, 0, 0);
const at = (hoursFromStart: number) => new Date(DAY0 + hoursFromStart * 3_600_000);

/**
 * Water at 30-minute cadence: a slow diurnal ripple on a warming trend. The
 * trend is the point — it is what a single snapshot cannot represent, and it is
 * sized to match the real one (about 0.3 C per day).
 */
function buildWater(days: number): WaterTempSample[] {
  const out: WaterTempSample[] = [];
  for (let i = 0; i * 0.5 < days * 24; i++) {
    const h = i * 0.5;
    out.push({
      date: at(h),
      temperatureC: 30 + 0.3 * (h / 24) + 0.7 * Math.sin(((h - 4) / 24) * 2 * Math.PI),
    });
  }
  return out;
}

/** Deterministic small wobble — no Math.random, so failures reproduce. */
const wobble = (i: number, amp: number) => amp * Math.sin(i * 2.399963);

function waterAtHour(water: WaterTempSample[], h: number): number {
  const t = at(h).getTime();
  let best = water[0], gap = Infinity;
  for (const w of water) {
    const g = Math.abs(w.date.getTime() - t);
    if (g < gap) { gap = g; best = w; }
  }
  return best.temperatureC;
}

const WATER = buildWater(7);

/** A tag in the water: tracks it, with only sensor-level scatter. */
function immersed(hours: number[], amp = 0.4): TagTempReading[] {
  return hours.map((h, i) => ({
    date: at(h),
    temperatureC: waterAtHour(WATER, h) + wobble(i, amp) - 0.2,
  }));
}

/** A tag in air: follows the sun, warm by day and cold before dawn. */
function exposed(hours: number[]): TagTempReading[] {
  return hours.map((h, i) => {
    const elev = solarElevationDeg(at(h), LAT, LON);
    const solar = Math.max(-1, Math.min(1, elev / 40));
    return {
      date: at(h),
      temperatureC: waterAtHour(WATER, h) + 3.2 * solar - 0.8 + wobble(i, 0.3),
    };
  });
}

// A spread of hours that samples both day and night on each date.
const HRS = (day: number) => [day * 24 + 5, day * 24 + 11, day * 24 + 15, day * 24 + 22];

console.log('\n== SOLAR GEOMETRY ==');
{
  // Checked against closed-form culmination rather than a loose band, since
  // both are exactly computable: at upper culmination the elevation is
  // 90 - |lat - declination|, at lower culmination |lat + declination| - 90.
  // The sun's declination on 7 August is +16.3 degrees.
  const DEC = 16.3;
  const noon = solarElevationDeg(new Date(Date.UTC(2026, 7, 7, 17, 25)), LAT, LON);
  const midnight = solarElevationDeg(new Date(Date.UTC(2026, 7, 7, 5, 25)), LAT, LON);
  chk('upper culmination matches geometry',
    Math.abs(noon - (90 - Math.abs(LAT - DEC))) < 0.5, true);
  chk('lower culmination matches geometry',
    Math.abs(midnight - (Math.abs(LAT + DEC) - 90)) < 0.5, true);
  chk('...which is night by any definition', dayPhase(midnight), 'night');

  // Southern hemisphere, opposite season — catches a sign error that a
  // single-site test would sail straight past.
  const sydneyJan = solarElevationDeg(new Date(Date.UTC(2026, 0, 15, 2, 0)), -33.87, 151.21);
  chk('Sydney at local noon in January is high', sydneyJan > 70, true);

  chk('phase: day', dayPhase(35), 'day');
  chk('phase: night', dayPhase(-20), 'night');
  chk('phase: twilight is neither', dayPhase(-3), 'twilight');
  chk('phase: NaN degrades to twilight, not day', dayPhase(NaN), 'twilight');
}

console.log('\n== MATCHING ==');
{
  const { matched, unmatched } = matchToWater(immersed([10, 20, 30]), WATER, LAT, LON);
  chk('every reading matched', matched.length, 3);
  chk('none dropped', unmatched, 0);
  chk('delta is tag minus water', Math.abs(matched[0].deltaC) < 1, true);

  // A reading outside the water record must not silently borrow the nearest
  // sample from days away.
  const far = matchToWater(
    [{ date: new Date(Date.UTC(2026, 8, 1)), temperatureC: 30 }], WATER, LAT, LON
  );
  chk('a reading days from any sample is not matched', far.matched.length, 0);
  chk('...and is counted', far.unmatched, 1);

  const bad = matchToWater(
    [{ date: new Date(NaN), temperatureC: 30 },
     { date: at(10), temperatureC: NaN }], WATER, LAT, LON
  );
  chk('undated and unreadable readings are excluded', bad.matched.length, 0);
  chk('...and both counted', bad.unmatched, 2);
}

console.log('\n== A TAG THAT STAYS IN THE WATER ==');
{
  const hrs = [0, 1, 2, 3, 4, 5].flatMap((d) => HRS(d));
  const a = analyzeWaterMatch(immersed(hrs), WATER, LAT, LON);
  chk('verdict', a.verdict, 'immersed');
  chk('no transition is invented', a.transition, null);
  chk('reported as a single regime', a.segments.length, 1);
  chk('spread stays inside the immersed band', a.segments[0].spreadC < 2.5, true);
  chk('never reads colder than the water can explain', a.coldestDeltaC! > -3, true);
  chk('reasoning says so', /in the water/.test(a.reasoning), true);
}

console.log('\n== A TAG THAT IS ASHORE THE WHOLE TIME ==');
{
  const hrs = [0, 1, 2, 3, 4, 5].flatMap((d) => HRS(d));
  const a = analyzeWaterMatch(exposed(hrs), WATER, LAT, LON);
  chk('verdict', a.verdict, 'exposed');
  chk('no transition, because nothing changed', a.transition, null);
  chk('one regime', a.segments.length, 1);
  chk('the sun signature is found', (a.diurnal?.separationC ?? 0) >= 2, true);
  chk('...warmer by day than by night', a.diurnal!.dayMedianC! > a.diurnal!.nightMedianC!, true);
}

console.log('\n== A TAG THAT COMES ASHORE PART WAY THROUGH ==');
{
  const wetH = [0, 1, 2].flatMap((d) => HRS(d));
  const dryH = [3, 4, 5].flatMap((d) => HRS(d));
  const a = analyzeWaterMatch(
    [...immersed(wetH), ...exposed(dryH)], WATER, LAT, LON
  );
  chk('verdict', a.verdict, 'exposed');
  chk('a transition is found', a.transition !== null, true);
  chk('the immersed half is called immersed', a.segments[0].verdict, 'immersed');
  chk('the exposed half is called exposed', a.segments[1].verdict, 'exposed');
  // The boundary must land in the gap between the last wet and first dry
  // reading, not merely somewhere in the record.
  const lastWet = at(wetH[wetH.length - 1]).getTime();
  const firstDry = at(dryH[0]).getTime();
  chk('boundary brackets the real changeover',
    a.transition!.lastImmersed.getTime() <= lastWet &&
    a.transition!.firstExposed.getTime() >= firstDry, true);
  chk('reasoning gives the bracket', /left the water between/.test(a.reasoning), true);
}

console.log('\n== THE BOUNDARY IS NOT DRAGGED TO THE QUIETEST RUN ==');
{
  // Regression. Choosing the split that maximises the spread RATIO is biased
  // toward early cuts: an early segment is naturally tighter, which shrinks the
  // denominator, so the winning split sits at the end of the quietest stretch
  // rather than at the regime change. Here the first four readings are almost
  // perfectly flat and the tag stays in the water for two more days after them.
  // The old rule cut at reading 4; on real data it put a tag ashore two days
  // early and discarded two days of drift track.
  const flat: TagTempReading[] = [0, 6, 12, 18].map((h) => ({
    date: at(h), temperatureC: waterAtHour(WATER, h) - 0.2,
  }));
  const stillWet = immersed([24 + 5, 24 + 11, 24 + 15, 24 + 22, 48 + 5, 48 + 11, 48 + 15, 48 + 22], 0.9);
  const ashore = exposed([3, 4, 5].flatMap((d) => HRS(d)));
  const a = analyzeWaterMatch([...flat, ...stillWet, ...ashore], WATER, LAT, LON);

  chk('a transition is still found', a.transition !== null, true);
  chk('it is NOT at the end of the flat run',
    a.transition!.firstExposed.getTime() > at(48 + 22).getTime(), true);
  chk('it is at the real changeover',
    a.transition!.firstExposed.getTime() >= at(3 * 24 + 5).getTime(), true);
  chk('the whole wet stretch is kept on the immersed side', a.segments[0].n, 12);
}

console.log('\n== A SINGLE READING BELOW THE WATER IS DECISIVE ==');
{
  // Nothing immersed has a mechanism to be colder than the water around it,
  // so this outranks the spread test rather than being averaged with it.
  const hrs = [0, 1, 2, 3].flatMap((d) => HRS(d));
  const rows = immersed(hrs);
  rows[rows.length - 1] = {
    date: rows[rows.length - 1].date,
    temperatureC: waterAtHour(WATER, hrs[hrs.length - 1]) - 5.4,
  };
  const a = analyzeWaterMatch(rows, WATER, LAT, LON);
  chk('verdict flips to exposed', a.verdict, 'exposed');
  chk('the excursion is reported', a.coldestDeltaC! <= -5, true);
  chk('reasoning explains why it is decisive',
    /colder than the water around it/.test(a.reasoning), true);

  // The mirror case must NOT flip: a floating tag can bake in the sun.
  const warm = immersed(hrs);
  warm[warm.length - 1] = {
    date: warm[warm.length - 1].date,
    temperatureC: waterAtHour(WATER, hrs[hrs.length - 1]) + 2.6,
  };
  const b = analyzeWaterMatch(warm, WATER, LAT, LON);
  chk('one warm reading alone does not prove exposure', b.verdict === 'exposed', false);
}

console.log('\n== REFUSES TO ANSWER WITHOUT ENOUGH TO GO ON ==');
{
  const a = analyzeWaterMatch(immersed([10, 20]), WATER, LAT, LON);
  chk('two readings is not an analysis', a.available, false);
  chk('verdict is withheld', a.verdict, 'unclear');
  chk('and it says why', /too few/.test(a.reasoning), true);

  const none = analyzeWaterMatch([], WATER, LAT, LON);
  chk('no readings at all', none.available, false);
  chk('...explained rather than blank', /no comparison is possible/i.test(none.reasoning), true);

  const noWater = analyzeWaterMatch(immersed([10, 20, 30, 40]), [], LAT, LON);
  chk('no water series to compare against', noWater.available, false);
  chk('...counted as unmatched', noWater.unmatchedReadings, 4);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
