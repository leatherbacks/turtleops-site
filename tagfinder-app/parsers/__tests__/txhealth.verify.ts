import { analyzeTransmissionHealth } from '@/analysis/transmissionHealth';
import type { ArgosPass, DeploySummary } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(
    `  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(58)} got=${JSON.stringify(got)}` +
      (ok ? '' : ` want=${JSON.stringify(want)}`)
  );
};

const FILL = 401_650_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 3, 11, 0, 0);

function mkPass(
  dayOffset: number,
  o: { msgs?: number; corrupt?: number; power?: number; freq?: number | null } = {}
): ArgosPass {
  return {
    date: new Date(T0 + dayOffset * DAY),
    satellite: 'O3',
    msgCount: o.msgs ?? 3,
    corrupt: o.corrupt ?? 0,
    duplicates: 0,
    powerDbm: o.power ?? -135,
    frequencyHz: o.freq === undefined ? null : o.freq,
    quality: null,
    latitude: null,
    longitude: null,
  } as unknown as ArgosPass;
}

const summary = { releaseDate: null } as unknown as DeploySummary;

console.log('\n== THE MANUFACTURER FILL VALUE IS NOT A MEASUREMENT ==');
{
  // Reproduces a real MiniPAT export: the tag sits on Argos channel
  // 401.67765 MHz and is rock stable, but 11 of 16 passes carry the 401.650000
  // fill because those passes yielded no frequency fit. Averaging the fill in
  // with the real readings invented a +907 Hz/day climb, which the brief
  // reported as the tag heating up in a car or attic. It was lying on a beach.
  const REST = 401_677_650;
  const passes: ArgosPass[] = [
    mkPass(0, { freq: FILL }),
    mkPass(8, { freq: REST + 8 }),
    mkPass(8.1, { freq: FILL }),
    mkPass(8.3, { freq: FILL }),
    mkPass(9, { freq: FILL }),
    mkPass(10, { freq: FILL }),
    mkPass(10.2, { freq: REST + 18 }),
    mkPass(10.9, { freq: FILL }),
    mkPass(11.5, { freq: FILL }),
    mkPass(12, { freq: FILL }),
    mkPass(12.3, { freq: REST - 6 }),
    mkPass(12.5, { freq: FILL }),
    mkPass(12.6, { freq: FILL }),
    mkPass(12.7, { freq: FILL }),
    mkPass(12.8, { freq: REST - 4 }),
    mkPass(13, { freq: REST - 15 }),
  ];
  const h = analyzeTransmissionHealth(passes, summary)!;
  chk('drift is measured, not skipped', h.frequencySlopePerDayHz !== null, true);
  chk('drift is small', Math.abs(h.frequencySlopePerDayHz!) < 50, true);
  chk('...specifically, not the fill-poisoned +900 Hz/day',
    Math.abs(h.frequencySlopePerDayHz!) < 200, true);
  chk('no thermal claim is made', /rising tag temperature/.test(h.reasoning), false);
}

console.log('\n== A CHANNEL ASSIGNMENT IS NOT THERMAL DRIFT ==');
{
  // Argos assigns PTT channels across roughly 401.620-401.680 MHz. Measuring
  // drift against a hardcoded 401.650 made every tag off that channel look
  // wildly off-spec: this one reads 27 kHz out, three times the largest Doppler
  // shift physically available, so it cannot be a shift at all.
  const REST = 401_677_650;
  const passes = [0, 1, 2, 3, 4, 5].map((d) =>
    mkPass(d, { freq: REST + (d % 2 === 0 ? 6 : -6) })
  );
  const h = analyzeTransmissionHealth(passes, summary)!;
  chk('a tag on another channel is not called drifting',
    Math.abs(h.frequencySlopePerDayHz ?? 0) < 20, true);
  chk('and not called failing', h.trend === 'failing', false);
}

console.log('\n== REAL THERMAL DRIFT IS STILL CAUGHT ==');
{
  // The guard must not blind the detector to the signal it exists for.
  const REST = 401_632_000;
  const passes = [0, 1, 2, 3, 4, 5].map((d) => mkPass(d, { freq: REST + d * 400 }));
  const h = analyzeTransmissionHealth(passes, summary)!;
  chk('a genuine climb is measured', h.frequencySlopePerDayHz! > 300, true);
  chk('...and reported as temperature', /rising tag temperature/.test(h.reasoning), true);
}

console.log('\n== FREQUENCIES THAT CANNOT COME FROM ONE TAG ARE REFUSED ==');
{
  // Wider than two Doppler shifts apart, so at least one is not a measurement
  // of this transmitter. Reporting a slope through them would be inventing a
  // number; the honest answer is that drift is unavailable.
  const passes = [
    mkPass(0, { freq: 401_620_000 }),
    mkPass(1, { freq: 401_680_000 }),
    mkPass(2, { freq: 401_625_000 }),
    mkPass(3, { freq: 401_675_000 }),
  ];
  const h = analyzeTransmissionHealth(passes, summary)!;
  chk('drift is withheld', h.frequencySlopePerDayHz, null);
  chk('no thermal claim', /rising tag temperature/.test(h.reasoning), false);
  chk('...and the refusal is explained',
    /spread too far apart to have come from one transmitter/.test(h.reasoning), true);
}

console.log('\n== NO FREQUENCY AT ALL ==');
{
  const passes = [0, 1, 2, 3].map((d) => mkPass(d));
  const h = analyzeTransmissionHealth(passes, summary)!;
  chk('drift is null rather than zero', h.frequencySlopePerDayHz, null);
  chk('...and the gap is stated', /not assessed because frequency is not reported/.test(h.reasoning), true);

  const fillOnly = [0, 1, 2, 3].map((d) => mkPass(d, { freq: FILL }));
  const g = analyzeTransmissionHealth(fillOnly, summary)!;
  chk('all-fill is distinguished from no-data', /placeholder transmit frequency/.test(g.reasoning), true);
}

console.log('\n== CORRUPTION IS STILL MEASURED ALONGSIDE ==');
{
  // The fill guard touches frequency only; the other two signals must be
  // unaffected. 57% corruption at flat power is the real signature of the
  // deployment this came from.
  const passes = [0, 2, 4, 6, 8, 10].map((d) =>
    mkPass(d, { msgs: 4, corrupt: 2, power: -136, freq: FILL })
  );
  const h = analyzeTransmissionHealth(passes, summary)!;
  chk('corruption is reported', /CRC 50%|CRC 5[0-9]%/.test(h.reasoning), true);
  chk('power was assessed', h.powerSlopePerDayDbm !== null, true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
