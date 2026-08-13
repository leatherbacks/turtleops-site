import { parseClsDate } from '@/lib/clsDate';
import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { requireFixture, MESSAGES_CSV } from './fixtures';
import { analyzeTagState } from '@/analysis/tagState';
import { compareTemperatures } from '@/analysis/tempComparison';
import {
  parseLotekHealthMessages,
  decodeHealthMessage,
  isPlausibleHealthRecord,
} from '@/parsers/lotek/healthMessage';

let pass = 0, fail = 0;
const chk = (l: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${l.padEnd(58)} got=${got}${ok ? '' : ` want=${want}`}`);
};

const rows = Papa.parse<Record<string, string>>(
  readFileSync(requireFixture(MESSAGES_CSV), 'utf8'),
  { header: true, skipEmptyLines: true }
).data;
const h = parseLotekHealthMessages(rows);

console.log('\n== DECODES POST-RELEASE SENSOR DATA FROM RAW PAYLOADS ==');
console.log(`        ${h.records.length} records recovered, ${h.corrupt} failed physics, ` +
  `${h.inconsistent} rejected by the latched-field check`);
chk('recovers records the manufacturer export omitted', h.records.length >= 15, true);
chk('every record has a valid date', h.records.every((r) => !isNaN(r.date.getTime())), true);
chk('records are in time order',
  h.records.every((r, i) => i === 0 || r.date >= h.records[i - 1].date), true);
chk('one serial across all records',
  new Set(h.records.map((r) => r.serial)).size, 1);

console.log('\n== FIELD VALUES MATCH THE MANUFACTURER DECODER ==');
// Cross-checked against Lotek's own exported health log, matched on reception
// time: temperature raw/50-20, light raw counts, corrosion voltages raw/100.
const temps = h.records.map((r) => r.temperatureC);
chk('temperatures are physical', temps.every((t) => t > 20 && t < 40), true);
chk('temperature range matches the export (28.5-32.7 C)',
  Math.min(...temps).toFixed(1) + '-' + Math.max(...temps).toFixed(1), '28.5-32.7');
const lights = h.records.map((r) => r.light);
chk('light spans a full diurnal cycle', Math.min(...lights) < 50 && Math.max(...lights) > 1500, true);
// The latched-field check is the CRC substitute: corrosion voltage, corrosion
// time and serial are fixed at release, so a record whose copy disagrees with
// the majority was corrupted in transit.
chk('surviving records agree on every latched field',
  new Set(h.records.map((r) => `${r.corrosionStartV}|${r.corrosionEndV}|${r.corrosionTimeS}`)).size, 1);
chk('...and the check rejected some', h.inconsistent > 0, true);

console.log('\n== THE LATCHED FIELDS ARE FLAGGED, NOT TRUSTED ==');
// Corrosion voltage and the status byte never vary, so neither can describe the
// tag's current state. Reading them as live telemetry is the mistake this data
// invites: a constant reads exactly like a stable measurement.
chk('status byte never varied on this dataset', h.statusChanged, false);
chk('...and only one value was ever seen', h.statusValues.length, 1);
chk('...which is 0x80', h.statusValues[0], 0x80);

console.log('\n== DEDUPLICATION ==');
// The same record is retransmitted and heard by several satellites. Counting it
// twice would imply sensor readings the tag never took.
chk('deduplicated on the tag clock',
  new Set(h.records.map((r) => r.tagSeconds)).size, h.records.length);

console.log('\n== SCREENS ON PHYSICS, NOT ON THE STATUS BYTE ==');
// Filtering on the status byte would discard the one record worth watching for:
// the first message where the tag stops reporting wet.
{
  const real = rows.find((r) => (r['Raw data'] ?? '').trim().toLowerCase().startsWith('ed32'))!;
  const bytes = Uint8Array.from(
    (real['Raw data'].trim().match(/../g) ?? []).map((x) => parseInt(x, 16))
  );
  const dry = Uint8Array.from(bytes);
  dry[6] = 0x00;                                    // simulate a DRY reading
  const rec = decodeHealthMessage(dry, new Date('2026-01-01T00:00:00Z'))!;
  chk('a dry record still decodes', rec !== null, true);
  chk('...reports wetFlag false', rec.wetFlag, false);
  chk('...and is NOT discarded as corrupt', isPlausibleHealthRecord(rec), true);
}

console.log('\n== THE TYPE MARKER IS ONE BYTE, NOT TWO ==');
// Byte 1 is constant within a deployment but differs between them (0x32 on one
// tag, 0x31 on others). Requiring a fixed two-byte prefix rejected entire tags
// outright — they decoded zero records. It is a format/config version, so it is
// checked as a latched field instead of used as a filter.
chk('all records share one format byte',
  new Set(h.records.map((r) => r.formatByte)).size, 1);
{
  const real = rows.find((r) => (r['Raw data'] ?? '').trim().toLowerCase().startsWith('ed'))!;
  const bytes = Uint8Array.from(
    (real['Raw data'].trim().match(/../g) ?? []).map((x) => parseInt(x, 16))
  );
  const other = Uint8Array.from(bytes);
  other[1] = bytes[1] === 0x32 ? 0x31 : 0x32;      // a different deployment's version
  chk('a different format byte still decodes',
    decodeHealthMessage(other, new Date()) !== null, true);
  const notHealth = Uint8Array.from(bytes);
  notHealth[0] = 0xa0;
  chk('a different message type does not',
    decodeHealthMessage(notHealth, new Date()), null);
}

console.log('\n== REJECTS WHAT IT SHOULD ==');
chk('non-health payload returns null',
  decodeHealthMessage(Uint8Array.from([0xa0, 0x31, ...Array(29).fill(0)]), new Date()), null);
chk('wrong length returns null',
  decodeHealthMessage(Uint8Array.from([0xed, 0x32, 0, 0]), new Date()), null);
chk('corrupt payloads were screened out', h.corrupt > 0, true);

console.log('\n== A COUPLE OF BAD READINGS MUST NOT OUTVOTE MANY GOOD ONES ==');
// The Lotek health message carries occasional impossible depths. On this data 18
// of 20 readings are 0 m and two are 21 m and 32 m. Aggregating with max (or a
// standard deviation) turned a tag lying flat at the surface into one
// "consistently submerged", then into one "bobbing in surf" — the opposite of
// what every other channel said.
{
  const series = h.records.map((r) => ({
    date: r.date, depth: r.depthM, depthRange: null,
    temperature: r.temperatureC, temperatureRange: null,
  }));
  const summary: any = {
    deployId: '', ptt: 0, instrument: '', software: '', percentDecoded: 0,
    passes: 0, releaseDate: h.records[0].date, releaseType: '', deployDate: null,
  };
  const depths = h.records.map((r) => r.depthM);
  const zeros = depths.filter((d) => d === 0).length;
  console.log(`        ${zeros}/${depths.length} depths are 0 m; max is ${Math.max(...depths)} m`);
  chk('the outliers really are a small minority', zeros / depths.length > 0.8, true);

  const ts: any = analyzeTagState([], summary, null, series as any, null, null);
  chk('tag reads as at the surface, not submerged', ts.phase, 'surface');
  chk('...and not as bobbing in surf either', /oscillating/.test(String(ts.reasoning)), false);

  // Temperature must lead with the diurnal swing. Comparing a mean against a
  // single SST snapshot said "in water" for a tag swinging 7 C, because on a
  // summer coast air and sea sit within a couple of degrees of each other.
  const tc = compareTemperatures(series as any, [], summary, {
    airTempC: 30.1, sstTempC: 31.8,
  } as any);
  const swing = Math.max(...h.records.map((r) => r.temperatureC)) -
                Math.min(...h.records.map((r) => r.temperatureC));
  console.log(`        temperature swing ${swing.toFixed(1)} C`);
  chk('swing is too large for an immersed tag', swing > 4, true);
  chk('classified out of the water', tc.environment, 'in_air_exposed');
  chk('...and the reasoning cites the swing', /swing of/.test(tc.reasoning), true);
  chk('...with the mean sitting near air, which alone would not settle it',
    Math.abs((tc.tagMinusAir ?? 99)) < 1 && Math.abs((tc.tagMinusSST ?? 0)) < 2, true);
}

console.log('\n== CLS TIMESTAMPS ARE NOT WRITTEN CONSISTENTLY ==');
{
  // The failure that motivated this: one export wrote the hour without a
  // leading zero. `new Date('2026-07-23T8:35Z')` is Invalid Date, and because
  // nothing screened for it, 36% of that deployment's health records carried a
  // NaN date -- sorted to the epoch, silently, with no warning anywhere.
  const iso = (v: string) => {
    const d = parseClsDate(v);
    return isNaN(d.getTime()) ? 'INVALID' : d.toISOString();
  };
  chk('seconds present, hour padded', iso('2026-08-11 14:20:54'), '2026-08-11T14:20:54.000Z');
  chk('no seconds', iso('2026-07-31 17:29'), '2026-07-31T17:29:00.000Z');
  chk('UNPADDED HOUR -- the regression', iso('2026-07-23 8:35'), '2026-07-23T08:35:00.000Z');
  chk('unpadded month and day too', iso('2026-7-3 8:05'), '2026-07-03T08:05:00.000Z');
  chk('ISO separator also accepted', iso('2026-07-23T08:35:00'), '2026-07-23T08:35:00.000Z');
  chk('trailing content is ignored, not fatal', iso('2026-07-23 08:35:00.500'), '2026-07-23T08:35:00.000Z');

  // Unparseable input must stay Invalid rather than becoming a plausible wrong
  // time -- a silently wrong timestamp is worse than an absent one.
  chk('empty stays invalid', iso(''), 'INVALID');
  chk('undefined stays invalid', iso(undefined as any), 'INVALID');
  chk('non-date text stays invalid', iso('rubbish'), 'INVALID');
  chk('date with no time stays invalid', iso('2026-07-23'), 'INVALID');

  // And the parser must not emit a record carrying one.
  const bad = parseLotekHealthMessages([
    { 'Message date (UTC)': 'rubbish',
      'Raw data': rows.find((r) =>
        (r['Raw data'] ?? '').trim().toLowerCase().startsWith('ed'))!['Raw data'] },
  ]);
  chk('a record with an unparseable date is not returned as valid',
    bad.records.every((r) => !isNaN(r.date.getTime())), true);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
