import { analyzeReceptionQuality } from '@/analysis/receptionQuality';
import { analyzeTagState } from '@/analysis/tagState';
import { parseSummary } from '@/parsers/wc/summary';
import { screenIsolatedDepths } from '@/analysis/depthScreen';
import { analyzeAntennaExposure } from '@/analysis/antennaExposure';
import type { ArgosPass } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(58)} got=${JSON.stringify(got)}` +
      (ok ? '' : ` want=${JSON.stringify(want)}`)
  );
};

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 3, 11);
const mk = (i: number, msgs: number): ArgosPass =>
  ({
    date: new Date(T0 + i * DAY * 0.5),
    satellite: 'O3',
    msgCount: msgs,
    corrupt: 0,
    duplicates: 0,
    powerDbm: -135,
    frequencyHz: null,
    quality: null,
    latitude: null,
    longitude: null,
  }) as unknown as ArgosPass;

console.log('\n== MESSAGES PER PASS IS THE MEASUREMENT ==');
{
  // Argos needs four messages for a class 1-3 fix. That is the anchor: it comes
  // from the system's own definition, not from fitting a threshold to examples.
  const clear = [12, 14, 9, 11, 13, 10, 15, 12].map((m, i) => mk(i, m));
  const c = analyzeReceptionQuality(clear, 8, ['3', '3', '2', '3', '3', '2', '3', '3']);
  chk('a tag with an open sky reads clear', c.verdict, 'clear');
  chk('...and says nothing is blocking it', /Nothing is meaningfully blocking/.test(c.reasoning), true);

  // The real recovered-buried deployment: 37 messages over 16 passes.
  const buried = [1, 3, 1, 2, 2, 1, 3, 2, 2, 1, 3, 2, 2, 1, 4, 7].map((m, i) => mk(i, m));
  const b = analyzeReceptionQuality(buried, 5, ['A', 'A', '3', '2', 'A']);
  chk('the recovered-buried tag reads obstructed', b.verdict, 'obstructed');
  chk('...at 2.3 messages per pass', b.messagesPerPass, 2.31);
  chk('...and blames cover over the tag, not beside it',
    /over the tag rather than beside it/.test(b.reasoning), true);

  const middling = [5, 4, 3, 5, 4, 6, 4, 5].map((m, i) => mk(i, m));
  chk('in between reads degraded', analyzeReceptionQuality(middling).verdict, 'degraded');
}

console.log('\n== IT REFUSES ON TOO LITTLE ==');
{
  const few = [2, 1, 3].map((m, i) => mk(i, m));
  const r = analyzeReceptionQuality(few);
  chk('three passes is not a verdict', r.verdict, 'insufficient');
  chk('...and it says so', /too few to judge/.test(r.reasoning), true);
  chk('no passes at all', analyzeReceptionQuality([]).verdict, 'insufficient');
}

console.log('\n== A BLANK ReleaseDate IS NOT PROOF THE TAG IS STILL ATTACHED ==');
{
  // A pop-up tag only transmits once it has let go, so reception postdating the
  // last archived sample is itself the release evidence. Reading a blank field
  // as "still on the animal" sent a tag that had been transmitting for twelve
  // days down the pre-popoff path, where every post-release check is skipped.
  const row = (o: Record<string, string>) => [{ Instr: 'MiniPAT', Ptt: '0', ...o }];

  const inferred = parseSummary(row({
    EarliestXmitTime: '19:23:56 11-Apr-2026',
    LatestDataTime: '01:20:00 01-Apr-2026',
  }))!;
  chk('release is recovered from the record', inferred.inferredReleaseDate !== null, true);
  chk('...as the end of the archive',
    inferred.inferredReleaseDate!.toISOString(), '2026-04-01T01:20:00.000Z');
  chk('...and the manufacturer field is left blank, not overwritten',
    inferred.releaseDate, null);

  // When the manufacturer gave one, nothing is inferred.
  const given = parseSummary(row({
    ReleaseDate: '20:00:00 27-Mar-2026',
    EarliestXmitTime: '11:38:27 30-Mar-2026',
    LatestDataTime: '12:00:00 26-Mar-2026',
  }))!;
  chk('a stated ReleaseDate is not second-guessed', given.inferredReleaseDate, null);
  chk('...and is still read', given.releaseDate !== null, true);

  // Transmission during the archive means the tag was still recording: no
  // release can be concluded.
  const overlapping = parseSummary(row({
    EarliestXmitTime: '10:00:00 01-Mar-2026',
    LatestDataTime: '12:00:00 26-Mar-2026',
  }))!;
  chk('reception inside the archive infers nothing', overlapping.inferredReleaseDate, null);
}

console.log('\n== BURIAL DOES NOT REQUIRE A DEPTH READING ==');
{
  // Dry sand arches; grain-to-grain contact carries the load to the sides
  // rather than onto the pressure port. A tag under 10-20 cm is hidden,
  // attenuated, and reads zero. Requiring a non-zero depth made exactly that
  // case undetectable — and it is the case that matters for recovery.
  const summary = parseSummary([{
    Instr: 'MiniPAT', Ptt: '0',
    EarliestXmitTime: '19:23:56 11-Apr-2026',
    LatestDataTime: '01:20:00 01-Apr-2026',
  }])!;
  const onLand = { elevation: { meters: 2.0, source: 'open-elevation' } } as never;

  const obstructed = analyzeReceptionQuality(
    [1, 3, 1, 2, 2, 1, 3, 2, 2, 1, 3, 2, 2, 1, 4, 7].map((m, i) => mk(i, m)),
    5, ['A', 'A', '3', '2', 'A']
  );
  const st = analyzeTagState([], summary, onLand, [], null, null, obstructed);
  chk('a buried tag with no depth reading is found', st.phase, 'buried');
  chk('...and zero depth is explained rather than held against it',
    /does not argue against burial/.test(st.reasoning), true);

  // The same position with a healthy antenna is not burial.
  const clear = analyzeReceptionQuality(
    [12, 14, 9, 11, 13, 10, 15, 12].map((m, i) => mk(i, m)), 8,
    ['3', '3', '2', '3', '3', '2', '3', '3']
  );
  const st2 = analyzeTagState([], summary, onLand, [], null, null, clear);
  chk('good reception on land is not called burial', st2.phase === 'buried', false);
}

console.log('\n== CALIBRATED AGAINST TWO RECOVERED TAGS ==');
{
  // The threshold is not tuned to taste. Two deployments were physically
  // recovered and their condition recorded, one either side of the boundary, so
  // the detector's job is to keep them apart. If anyone retunes the constants,
  // this is what should stop them putting the line in the wrong place.
  //
  //   recovered BURIED in beach sand      2.3 msgs/pass, 13% reaching 4
  //   recovered LYING EXPOSED on an       5.1 msgs/pass, 56% reaching 4
  //     organic bank at the waterline
  //
  // The exposed tag is the important one. It was not clear-skied — it sat in wet
  // wrack and was intermittently washed — so it is the hardest available test of
  // whether the detector cries burial at a tag that is merely in poor shape.

  // Real per-pass message counts, as a [messages, howManyPasses] histogram.
  const expand = (hist: [number, number][]) =>
    hist.flatMap(([msgs, n]) => Array.from({ length: n }, () => msgs));

  const buriedCounts = [1, 3, 1, 2, 2, 1, 3, 2, 2, 1, 3, 2, 2, 1, 4, 7];
  const buried = analyzeReceptionQuality(
    buriedCounts.map((m, i) => mk(i, m)), 5, ['A', 'A', '3', '2', 'A']
  );
  chk('recovered buried -> obstructed', buried.verdict, 'obstructed');
  chk('...at the measured 2.3 messages per pass', buried.messagesPerPass, 2.31);
  chk('...with 13% of passes reaching the four-message floor',
    Math.round(buried.resolvingFraction! * 100), 13);

  const exposedCounts = expand([
    [0, 1], [1, 47], [2, 43], [3, 26], [4, 24], [5, 20], [6, 26], [7, 16],
    [8, 16], [9, 11], [10, 7], [11, 4], [12, 3], [13, 4], [15, 1], [16, 14],
  ]);
  const exposed = analyzeReceptionQuality(exposedCounts.map((m, i) => mk(i, m)));
  chk('recovered lying exposed -> NOT obstructed', exposed.verdict === 'obstructed', false);
  chk('...it reads degraded, which is what wet wrack should look like',
    exposed.verdict, 'degraded');
  chk('...at the measured 5.1 messages per pass',
    Math.abs(exposed.messagesPerPass - 5.11) < 0.05, true);
  chk('...with 56% of passes reaching the floor',
    Math.round(exposed.resolvingFraction! * 100), 56);

  // The whole point: the boundary sits between two field-verified outcomes,
  // with room on each side rather than grazing either.
  chk('the two recovered tags land on opposite sides',
    buried.verdict !== exposed.verdict, true);
  chk('...and the gap between them is real, not marginal',
    exposed.messagesPerPass - buried.messagesPerPass > 2, true);
}

console.log('\n== ISOLATED DEEP READINGS ARE NOT DIVES ==');
{
  // Two corrupt records out of twenty-two claimed 21 m and 32 m on a tag that
  // was lying dry on a wrack bank. Unscreened they produced a dive profile with
  // a 32 m maximum and a "tidally flooded, wet 10% of the time" verdict — the
  // 10% being exactly those two readings — on the same page as a tag-state
  // panel correctly reporting the tag at the surface.
  const H = 3_600_000;
  const pt = (h: number, d: number) => ({ t: Date.UTC(2026, 7, 7) + h * H, d });

  const surfaceRecord = [
    pt(0, 0), pt(6, 0), pt(12, 0), pt(18, 0), pt(26, 21), pt(32, 0),
    pt(40, 32), pt(46, 0), pt(52, 0), pt(58, 0), pt(64, 0), pt(70, 0),
  ];
  const s1 = screenIsolatedDepths(surfaceRecord, (p) => p.d, (p) => p.t);
  chk('both isolated deep readings are rejected', s1.rejected.length, 2);
  chk('...and the surface readings are all kept', s1.kept.length, 10);
  chk('...with the reason naming them', /21, 32 m/.test(s1.reason ?? ''), true);

  // A dive to tens of metres and back takes minutes. Two of them thirteen hours
  // apart are two claims, not one event sampled twice — an earlier version
  // scaled the corroboration window to the sampling interval and let exactly
  // that pair vouch for each other.
  chk('a far-apart pair does not corroborate itself',
    screenIsolatedDepths([pt(0, 0), pt(6, 0), pt(12, 30), pt(18, 0), pt(25, 30),
      pt(31, 0), pt(37, 0), pt(43, 0), pt(49, 0), pt(55, 0)],
      (p) => p.d, (p) => p.t).rejected.length, 2);
  // ...but two within the window do.
  chk('a genuine submersion with a neighbour is kept',
    screenIsolatedDepths([pt(0, 0), pt(6, 0), pt(12, 30), pt(13, 28), pt(18, 0),
      pt(24, 0), pt(30, 0), pt(36, 0), pt(42, 0), pt(48, 0)],
      (p) => p.d, (p) => p.t).rejected.length, 0);

  // A real dive record must be untouched: deep readings are the majority there,
  // so the screen never engages.
  const diving = [0, 5, 18, 42, 60, 35, 12, 0, 8, 30, 55, 71, 40, 15, 2, 0]
    .map((d, i) => pt(i * 0.33, d));
  chk('a diving animal is left alone', screenIsolatedDepths(diving, (p) => p.d, (p) => p.t).rejected.length, 0);

  // Shallow readings are never screened, or the tidal detector this guard
  // protects would lose the very signal it looks for.
  const tidal = [pt(0, 0), pt(6, 1.4), pt(12, 0), pt(18, 1.6), pt(24, 0),
    pt(30, 1.5), pt(36, 0), pt(42, 1.3), pt(48, 0), pt(54, 0)];
  chk('metre-scale tidal flooding survives',
    screenIsolatedDepths(tidal, (p) => p.d, (p) => p.t).rejected.length, 0);

  chk('too short a record is not screened',
    screenIsolatedDepths([pt(0, 0), pt(6, 32), pt(12, 0)], (p) => p.d, (p) => p.t).rejected.length, 0);
}

console.log('\n== A BLOCKED HORIZON IS NOT AN INDOOR WINDOW ==');
{
  // The elevation tests keyed off the LOWEST elevation at which anything was
  // received. That is an extreme-value statistic: across hundreds of passes one
  // low reception always gets through, the minimum collapses, and the test never
  // fires. A tag lying in wrack — horizon blocked all round, misses at the rim —
  // fell through to the directional branch and was reported as being indoors
  // beside a south-facing window, with a "biased toward the S" verdict printed
  // next to a mean received azimuth of 61 degrees, which is ENE.
  const mk = (el: number, az: number, received: boolean) =>
    ({ maxElevation: el, peakAzimuth: az, received }) as never;

  const wrack: never[] = [];
  for (let i = 0; i < 60; i++) wrack.push(mk(5 + (i % 10), (i * 37) % 360, i % 9 === 0));
  for (let i = 0; i < 50; i++) wrack.push(mk(18 + (i % 11), (i * 53) % 360, i % 3 === 0));
  for (let i = 0; i < 40; i++) wrack.push(mk(32 + (i % 17), (i * 71) % 360, i % 2 === 0));
  for (let i = 0; i < 30; i++) wrack.push(mk(55 + (i % 30), (i * 97) % 360, i % 4 !== 0));
  const r = analyzeAntennaExposure(wrack);
  chk('an all-round blocked horizon is recognised', r.pattern, 'horizon_obstructed');
  chk('...even though low passes were sometimes heard',
    wrack.filter((p: never) => (p as { maxElevation: number; received: boolean }).maxElevation < 15
      && (p as { received: boolean }).received).length > 0, true);
  chk('...and it cites the rate profile, not a single minimum',
    /improves steadily with elevation/.test(r.reasoning), true);

  // A genuinely one-sided block must still be caught.
  const wall: never[] = [];
  for (let i = 0; i < 40; i++) wall.push(mk(20 + (i % 50), 10 + (i % 70), true));
  for (let i = 0; i < 40; i++) wall.push(mk(20 + (i % 50), 190 + (i % 30), i % 9 === 0));
  for (let i = 0; i < 20; i++) wall.push(mk(20 + (i % 50), 90 + (i % 30), i % 2 === 0));
  for (let i = 0; i < 20; i++) wall.push(mk(20 + (i % 50), 260 + (i % 30), i % 2 === 0));
  const w = analyzeAntennaExposure(wall);
  chk('a one-sided obstruction is still directional', w.pattern, 'directional');
  chk('...and quotes the quadrant rates the verdict came from',
    /% of passes from the [NESW] are heard against/.test(w.reasoning), true);

  // Neither may speculate about indoor storage for a tag in the sea.
  chk('no indoor/window guessing anywhere',
    /indoor|window/i.test(r.reasoning + w.reasoning), false);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
