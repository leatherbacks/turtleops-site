import { readFileSync } from 'fs';
import Papa from 'papaparse';
import { requireFixture, MESSAGES_CSV } from './fixtures';
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

console.log('\n== REJECTS WHAT IT SHOULD ==');
chk('non-health payload returns null',
  decodeHealthMessage(Uint8Array.from([0xa0, 0x31, ...Array(29).fill(0)]), new Date()), null);
chk('wrong length returns null',
  decodeHealthMessage(Uint8Array.from([0xed, 0x32, 0, 0]), new Date()), null);
chk('corrupt payloads were screened out', h.corrupt > 0, true);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
