import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { requireFixture, MESSAGES_CSV, RAW_DS_TXT } from './fixtures';
import { estimateRepetitionRate } from '@/analysis/repetitionRate';
import { parseArgosMessages } from '@/parsers/argos/messages';
import { parseArgosDS } from '@/parsers/argos/ds';
import type { TransmissionTime } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(58)} got=${got}${ok ? '' : ` want=${want}`}`);
};

/** Deterministic pseudo-random so the suite never flakes. */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/** Build a synthetic transmission history with a known period. */
function synth(opts: {
  periodS: number; jitterS: number; missRate: number;
  duplicateRate: number; count: number; seed: number;
}): TransmissionTime[] {
  const rnd = seeded(opts.seed);
  const out: TransmissionTime[] = [];
  let t = Date.UTC(2026, 0, 1);
  for (let i = 0; i < opts.count; i++) {
    t += (opts.periodS + (rnd() - 0.5) * 2 * opts.jitterS) * 1000;
    if (rnd() < opts.missRate) continue;              // transmission lost
    out.push({ date: new Date(t), satellite: 'SAT-A' });
    if (rnd() < opts.duplicateRate) {                 // same one logged twice
      out.push({ date: new Date(t + 2000), satellite: 'SAT-A' });
    }
  }
  return out;
}

console.log('\n== RECOVERS A KNOWN PERIOD ==');
for (const p of [45, 60, 90]) {
  const r = estimateRepetitionRate(
    synth({ periodS: p, jitterS: 8, missRate: 0.25, duplicateRate: 0.3, count: 600, seed: p })
  )!;
  chk(`${p} s period recovered within 3 s`, Math.abs(r.periodS - p) <= 3, true);
}

console.log('\n== DUPLICATE RECEPTIONS MUST NOT DRAG THE ESTIMATE DOWN ==');
// The same transmission logged twice, seconds apart, is not a second
// transmission. On real data these were a third of all gaps; averaging them in
// pulls a 61 s period down toward 40 s.
{
  const heavy = synth({ periodS: 60, jitterS: 8, missRate: 0.2, duplicateRate: 0.9, count: 600, seed: 3 });
  const r = estimateRepetitionRate(heavy)!;
  chk('period survives 90% duplication', Math.abs(r.periodS - 60) <= 3, true);
  chk('...and the duplicates are counted, not silently dropped', r.duplicatesDiscarded > 200, true);
}

console.log('\n== MISSED TRANSMISSIONS APPEAR AS HARMONICS, NOT AS THE PERIOD ==');
{
  const lossy = synth({ periodS: 60, jitterS: 6, missRate: 0.5, duplicateRate: 0, count: 800, seed: 11 });
  const r = estimateRepetitionRate(lossy)!;
  chk('heavy loss does not inflate the period', Math.abs(r.periodS - 60) <= 4, true);
  chk('harmonics detected', r.harmonics.length >= 2, true);
  chk('2x is the largest harmonic', r.harmonics[0].multiple, 2);
}

console.log('\n== REFUSES WHEN THERE IS NOT ENOUGH TO SAY ==');
chk('empty input -> null', estimateRepetitionRate([]), null);
chk('a handful of messages -> null',
  estimateRepetitionRate(synth({ periodS: 60, jitterS: 5, missRate: 0, duplicateRate: 0, count: 8, seed: 1 })), null);

console.log('\n== REAL DATA, BOTH EXPORT FORMATS ==');
const rows = Papa.parse<Record<string, string>>(
  readFileSync(requireFixture(MESSAGES_CSV), 'utf8'),
  { header: true, skipEmptyLines: true }
).data;
const fromMessages = estimateRepetitionRate(parseArgosMessages(rows).messageTimes)!;
const fromDs = estimateRepetitionRate(
  parseArgosDS(readFileSync(requireFixture(RAW_DS_TXT), 'utf8')).messageTimes
)!;
console.log(`        CLS message export: ${fromMessages.periodS} s  (${fromMessages.sampleCount} intervals)`);
console.log(`        Argos DS dump     : ${fromDs.periodS} s  (${fromDs.sampleCount} intervals)`);
// Two independently-parsed formats of the same deployment must agree.
chk('both formats agree within 2 s', Math.abs(fromMessages.periodS - fromDs.periodS) <= 2, true);
chk('confidence is high on real data', fromMessages.confidence, 'high');
chk('nearly all gaps are explained', fromMessages.fractionExplained > 0.9, true);
chk('silence threshold is a few periods',
  fromMessages.silenceThresholdS === fromMessages.periodS * 3, true);
console.log(`\n        ${fromMessages.reasoning}\n`);

console.log('\n== A SCHEDULE STEP IS AN END-OF-LIFE WARNING ==');
// These transmitters buffer each burst in a capacitor, so received power stays
// flat whatever the cell is doing — reading "no power fade" as "battery healthy"
// is backwards. What shows is the schedule: a low-voltage threshold steps the
// interval down by an order of magnitude. Detecting that turns a descriptive
// number into a countdown.
{
  // Fast throughout, then a hard step to a slow beacon — a dying tag.
  const fast = synth({ periodS: 60, jitterS: 6, missRate: 0.2, duplicateRate: 0.2, count: 900, seed: 21 });
  const lastFast = fast[fast.length - 1].date.getTime();
  const slow: TransmissionTime[] = [];
  for (let i = 1; i <= 60; i++) {
    slow.push({ date: new Date(lastFast + i * 1200_000), satellite: `S${i % 7}` });
  }
  const dying = estimateRepetitionRate([...fast, ...slow])!;
  chk('step detected', dying.slowedDown, true);
  chk('...ratio is large', (dying.rateStepRatio ?? 0) >= 3, true);
  chk('...and the reasoning warns explicitly',
    /END OF LIFE/.test(dying.reasoning), true);
  chk('...naming the schedule, not the power, as the signal',
    /transmit power stays flat/.test(dying.reasoning), true);

  // Steady throughout — must NOT cry wolf.
  const steady = estimateRepetitionRate(
    synth({ periodS: 60, jitterS: 6, missRate: 0.25, duplicateRate: 0.3, count: 1200, seed: 22 })
  )!;
  chk('a steady tag is not flagged', steady.slowedDown, false);

  // The slow slice must be measurable at all. A count-based split would bury a
  // 20x-slowed tail inside the early slice, because slowing down is exactly what
  // makes the tail sparse — so the split is by time.
  chk('slow tail is measured, not swallowed', (dying.latePeriodS ?? 0) > 600, true);
}

console.log(`${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
