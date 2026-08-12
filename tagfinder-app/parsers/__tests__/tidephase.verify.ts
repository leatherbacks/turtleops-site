import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { analyzeTidePhase, tidePhaseAt } from '@/analysis/tidePhase';
import { parseArgosMessages } from '@/parsers/argos/messages';
import type { ArgosPass, TideExtreme } from '@/lib/types';
import { requireFixture, MESSAGES_CSV } from './fixtures';

let pass = 0,
  fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(58)} got=${got}${ok ? '' : ` want=${want}`}`);
};

const D = (s: string) => new Date(s);
/** the nearest NOAA tide gauge, the window a reference PSAT+ deployment was drifting through. */
const EXTREMES: TideExtreme[] = [
  { time: D('2026-08-07T01:48:00Z'), type: 'L', height: 0.129 },
  { time: D('2026-08-07T07:53:00Z'), type: 'H', height: 0.612 },
  { time: D('2026-08-07T14:21:00Z'), type: 'L', height: -0.008 },
  { time: D('2026-08-07T21:02:00Z'), type: 'H', height: 0.628 },
  { time: D('2026-08-08T02:54:00Z'), type: 'L', height: 0.135 },
  { time: D('2026-08-08T09:04:00Z'), type: 'H', height: 0.618 },
  { time: D('2026-08-08T15:28:00Z'), type: 'L', height: -0.017 },
  { time: D('2026-08-08T22:07:00Z'), type: 'H', height: 0.651 },
  { time: D('2026-08-09T04:01:00Z'), type: 'L', height: 0.124 },
  { time: D('2026-08-09T10:12:00Z'), type: 'H', height: 0.642 },
  { time: D('2026-08-09T16:33:00Z'), type: 'L', height: -0.033 },
  { time: D('2026-08-09T23:06:00Z'), type: 'H', height: 0.682 },
  { time: D('2026-08-10T05:03:00Z'), type: 'L', height: 0.097 },
  { time: D('2026-08-10T11:14:00Z'), type: 'H', height: 0.677 },
  { time: D('2026-08-10T17:34:00Z'), type: 'L', height: -0.049 },
  { time: D('2026-08-11T00:01:00Z'), type: 'H', height: 0.713 },
  { time: D('2026-08-11T06:03:00Z'), type: 'L', height: 0.063 },
  { time: D('2026-08-11T12:13:00Z'), type: 'H', height: 0.712 },
  { time: D('2026-08-11T18:32:00Z'), type: 'L', height: -0.06 },
];

const mkPass = (iso: string, msgCount: number): ArgosPass => ({
  date: D(iso), satellite: 'TEST', msgCount, duplicates: 0, corrupt: null,
  avgInterval: 0, locationQuality: '', latitude: null, longitude: null,
  latitude2: null, longitude2: null, frequencyHz: null, powerDbm: null,
});

console.log('\n== PHASE PLACEMENT ==');
// 09:04Z high -> 15:28Z low on Aug 8. Midpoint is mid-ebb, half the range.
const mid = tidePhaseAt(D('2026-08-08T12:16:00Z'), EXTREMES)!;
chk('midway H->L is falling', mid.direction, 'falling');
chk('midway H->L sits at mid range', Math.abs(mid.level - 0.5) < 0.02, true);
const justAfterLow = tidePhaseAt(D('2026-08-08T15:35:00Z'), EXTREMES)!;
chk('just after low water is rising', justAfterLow.direction, 'rising');
chk('just after low water is near the bottom', justAfterLow.level < 0.05, true);
chk('outside the table returns null',
  tidePhaseAt(D('2020-01-01T00:00:00Z'), EXTREMES), null);

console.log('\n== THE TRAP: PASSES CLUSTERED ON ONE PHASE MUST NOT FAKE AN EFFECT ==');
// Every pass lands on a falling tide, and every pass is heard equally well.
// Message counts will be 100% "falling" — but per-pass yield is identical, so
// the honest answer is "no tidal effect".
const clustered: ArgosPass[] = [];
for (const t of ['2026-08-08T10:00:00Z', '2026-08-08T11:00:00Z', '2026-08-08T12:00:00Z',
                 '2026-08-08T13:00:00Z', '2026-08-09T11:00:00Z', '2026-08-09T12:00:00Z',
                 '2026-08-09T13:00:00Z', '2026-08-09T14:00:00Z', '2026-08-10T12:00:00Z',
                 '2026-08-10T13:00:00Z']) clustered.push(mkPass(t, 10));
const biased = analyzeTidePhase(clustered, EXTREMES, D('2026-08-11T15:00:00Z'))!;
chk('all messages landed on the falling tide', biased.risingMessages, 0);
// With zero rising-tide exposure there is no comparison to make. Reporting
// "falling" here would be asserting a tidal effect from a fact about the
// satellite schedule, so the honest answer is that we cannot tell.
chk('refuses to name a dominant phase', biased.dominant, 'neither');
chk('excess ratio is null, not invented', biased.excessRatio, null);
chk('offers no search window', biased.bestWindow, null);

console.log('\n== BALANCED EXPOSURE, EQUAL YIELD -> NO EFFECT ==');
const even: ArgosPass[] = [];
for (let h = 0; h < 72; h += 2) {
  const t = new Date(D('2026-08-08T00:00:00Z').getTime() + h * 3600_000);
  even.push(mkPass(t.toISOString(), 5));
}
const flat = analyzeTidePhase(even, EXTREMES, D('2026-08-11T15:00:00Z'))!;
chk('even yield reports no dominant phase', flat.dominant, 'neither');
chk('strength is none', flat.strength, 'none');
chk('both phases got usable exposure',
  flat.fallingPasses >= 3 && flat.risingPasses >= 3, true);

console.log('\n== A REAL EFFECT IS DETECTED ==');
const real: ArgosPass[] = [];
for (let h = 0; h < 72; h += 2) {
  const t = new Date(D('2026-08-08T00:00:00Z').getTime() + h * 3600_000);
  const ph = tidePhaseAt(t, EXTREMES);
  // Heard 4x better on the falling tide, with balanced pass exposure.
  real.push(mkPass(t.toISOString(), ph?.direction === 'falling' ? 20 : 5));
}
const detected = analyzeTidePhase(real, EXTREMES, D('2026-08-11T15:00:00Z'))!;
chk('falling detected as dominant', detected.dominant, 'falling');
chk('strength is strong', detected.strength, 'strong');
chk('excess ratio near 4x', Math.abs((detected.excessRatio ?? 0) - 4) < 0.4, true);
chk('a best window was produced', detected.bestWindow !== null, true);
chk('window lies in the future', (detected.bestWindow!.legTo.getTime()
  > D('2026-08-11T15:00:00Z').getTime()), true);
chk('peak sub-window sits inside its leg',
  detected.bestWindow!.peakFrom >= detected.bestWindow!.legFrom &&
  detected.bestWindow!.peakTo <= detected.bestWindow!.legTo, true);

console.log('\n== TOO LITTLE DATA MUST REFUSE TO ANSWER ==');
const sparse = [mkPass('2026-08-08T12:00:00Z', 3), mkPass('2026-08-08T18:00:00Z', 1)];
const thin = analyzeTidePhase(sparse, EXTREMES, D('2026-08-11T15:00:00Z'))!;
chk('sparse data -> strength none', thin.strength, 'none');
chk('sparse data -> no window offered', thin.bestWindow, null);
chk('reasoning says so', /too little traffic/.test(thin.reasoning), true);

console.log('\n== GUARDS ==');
chk('no extremes -> null', analyzeTidePhase(even, [], D('2026-08-11T15:00:00Z')), null);
chk('no passes -> null', analyzeTidePhase([], EXTREMES, D('2026-08-11T15:00:00Z')), null);

console.log('\n== REAL DATA: a reference PSAT+ deployment ==');
const rows = Papa.parse<Record<string, string>>(
  readFileSync(requireFixture(MESSAGES_CSV), 'utf8'),
  { header: true, skipEmptyLines: true }
).data;
const m = parseArgosMessages(rows);
const live = analyzeTidePhase(m.passes, EXTREMES, D('2026-08-11T15:00:00Z'))!;
console.log(`        falling ${live.fallingMessages} msgs / ${live.fallingPasses} passes ` +
  `= ${live.messagesPerPassFalling.toFixed(1)} per pass`);
console.log(`        rising  ${live.risingMessages} msgs / ${live.risingPasses} passes ` +
  `= ${live.messagesPerPassRising.toFixed(1)} per pass`);
console.log(`        excess ${live.excessRatio?.toFixed(2)}x  coverage ${(live.coverage*100).toFixed(0)}%`);
// The analyzer windows to the last 3 days of reception on purpose. Over the
// FULL record the corrected effect is 1.09x (no window) because Aug 7-8 the tag
// was drifting freely offshore and heard on any tide. Only the degraded period
// carries the signal, and that is the tag anyone is actually trying to find.
// the reference deployment is the honest hard case. The raw split over Aug 9+ was 3.67x, but 1.69x
// of that was pass clustering, and the corrected effect only appears for cutoffs
// after Aug 8 18:00 — it ranges 0.94x to 2.30x depending on where the window
// starts. The analyzer must therefore NOT report a confident tidal window here.
chk('reference deployment is reported as not robust', live.robust, false);
chk('...so no search window is offered', live.bestWindow, null);
chk('...and strength is none', live.strength, 'none');
chk('the instability is disclosed, not hidden',
  /depends on where the window is drawn|even across the tide/.test(live.reasoning), true);
chk('an excess range is reported as the error bar', live.excessRange !== null, true);
console.log(`\n        ${live.reasoning}\n`);

console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
