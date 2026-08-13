import { analyzeReceptionQuality } from '@/analysis/receptionQuality';
import { analyzeTagState } from '@/analysis/tagState';
import { parseSummary } from '@/parsers/wc/summary';
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
  const row = (o: Record<string, string>) => [{ Instr: 'MiniPAT', Ptt: '285927', ...o }];

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
    Instr: 'MiniPAT', Ptt: '285927',
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

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
