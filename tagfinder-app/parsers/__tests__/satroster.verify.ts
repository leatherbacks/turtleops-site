import { analyzeSatCoverage } from '@/analysis/satCoverage';
import type { SatellitePass } from '@/analysis/satPrediction';
import type { ArgosPass } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(56)} got=${got}${ok ? '' : ` want=${want}`}`);
};

const mkPred = (sat: string, i: number): SatellitePass => ({
  satelliteName: sat,
  riseTime: new Date(Date.UTC(2026, 7, 7) + i * 3600_000),
  setTime: new Date(Date.UTC(2026, 7, 7) + i * 3600_000 + 600_000),
  maxElevation: 40, duration: 600,
  direction: i % 2 ? 'ascending' : 'descending',
  peakAzimuth: 90, riseAzimuth: 0, setAzimuth: 180, trackPoints: [],
});
const mkRecv = (sat: string, i: number): ArgosPass => ({
  date: new Date(Date.UTC(2026, 7, 7) + i * 3600_000 + 300_000),
  satellite: sat, msgCount: 5, duplicates: 0, corrupt: null, avgInterval: 60,
  locationQuality: '2', latitude: 25, longitude: -80,
  latitude2: null, longitude2: null, frequencyHz: null, powerDbm: -130,
});

/** Deterministic pseudo-random so the suite never flakes. */
function seeded(seed: number) {
  let s = seed;
  return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

console.log('\n== SILENT SATELLITES ARE NOT OBSTRUCTION ==');
// Three satellites hear the tag about half the time; two never do. The two are
// not carrying it — counting them as "missed" halves the apparent rate and
// invents a directional finding.
{
  const predicted: SatellitePass[] = [];
  const received: ArgosPass[] = [];
  let t = 0;
  for (let i = 0; i < 18; i++) {
    for (const s of ['KINEIS-1A', 'KINEIS-1B', 'KINEIS-1C']) {
      predicted.push(mkPred(s, t)); if (i % 2 === 0) received.push(mkRecv(s, t)); t++;
    }
    for (const s of ['KINEIS-1D', 'NOAA 20']) { predicted.push(mkPred(s, t)); t++; }
  }
  const c = analyzeSatCoverage(predicted, received);
  chk('silent satellites excluded', c.nonServing.map((s) => s.name), ['KINEIS-1D', 'NOAA 20']);
  chk('they leave the per-satellite table', c.perSat.length, 3);
  chk('they leave the denominator', c.totalPredicted, 54);
  chk('rate reflects serving satellites only', Math.round(c.receptionRate * 100), 50);
  chk('health is healthy, not dragged down', c.health, 'healthy');
  chk('exclusion is disclosed, not silent', /never heard this tag/.test(c.diagnosis), true);
  chk('their arcs leave the sky chart',
    c.passes.some((p) => p.satelliteName === 'KINEIS-1D'), false);
}

console.log('\n== TOO FEW PASSES TO CONCLUDE ANYTHING ==');
{
  const predicted = [mkPred('KINEIS-2A', 0), mkPred('KINEIS-2A', 1), mkPred('KINEIS-1A', 2)];
  const received = [mkRecv('KINEIS-1A', 2)];
  const c = analyzeSatCoverage(predicted, received);
  // 0/2 is not evidence a satellite is not carrying the tag.
  chk('a 0/2 satellite is NOT written off', c.nonServing.length, 0);
}

console.log('\n== NORMAL SAMPLING SPREAD IS NOT OBSTRUCTION ==');
// Every satellite has the SAME true reception probability. With ~17 passes each
// the observed rates still scatter widely — a max-minus-min range test fires on
// this, which is how a healthy tag got reported as directionally obstructed.
{
  const rnd = seeded(7);
  const predicted: SatellitePass[] = [];
  const received: ArgosPass[] = [];
  let t = 0;
  const sats = Array.from({ length: 20 }, (_, i) => `KINEIS-${i}`);
  for (const s of sats) {
    for (let i = 0; i < 17; i++) {
      predicted.push(mkPred(s, t));
      if (rnd() < 0.47) received.push(mkRecv(s, t));   // identical true rate
      t++;
    }
  }
  const c = analyzeSatCoverage(predicted, received);
  const spread = Math.max(...c.perSat.map((s) => s.rate)) - Math.min(...c.perSat.map((s) => s.rate));
  console.log(`        observed spread across identical satellites: ${(spread * 100).toFixed(0)} points`);
  chk('spread alone would have tripped the old range test', spread > 0.3, true);
  chk('...but no obstruction is claimed', /favours one part of the sky/.test(c.diagnosis), false);
}

console.log('\n== A GENUINE OUTLIER IS STILL CAUGHT ==');
{
  const predicted: SatellitePass[] = [];
  const received: ArgosPass[] = [];
  let t = 0;
  for (const s of ['KINEIS-1A', 'KINEIS-1B', 'KINEIS-1C', 'KINEIS-1E']) {
    for (let i = 0; i < 20; i++) {
      predicted.push(mkPred(s, t));
      // one satellite hears nearly everything, the rest about half
      const p = s === 'KINEIS-1E' ? 1.0 : 0.5;
      if (i / 20 < p) received.push(mkRecv(s, t));
      t++;
    }
  }
  const c = analyzeSatCoverage(predicted, received);
  chk('outlier well beyond noise is reported',
    /favours one part of the sky/.test(c.diagnosis), true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
