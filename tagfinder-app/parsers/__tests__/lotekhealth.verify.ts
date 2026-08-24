import { parseTimestamp } from '@/lib/timestamp';
import { estimateClockEpoch, TAG_CLOCK_WRAP_S } from '@/parsers/lotek/healthMessage';
import { decodeActivityMessage, parseLotekActivityMessages } from '@/parsers/lotek/activityMessage';
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
    const d = parseTimestamp(v);
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

  // new Date() and Date.parse() both accept these and return 2000-01-01, which
  // is finite and sorts and plots. Number.isFinite screens do not catch it.
  chk('text new Date() would call 2000-01-01', iso('GARBAGE'), 'INVALID');
  chk('lone Z, likewise', iso('Z'), 'INVALID');

  // Date.UTC rolls out-of-range fields over rather than rejecting them.
  chk('month 13 does not roll into next year', iso('2026-13-45 99:99'), 'INVALID');
  chk('hour 24 rejected', iso('2026-07-23 24:00'), 'INVALID');
  chk('31 April rejected', iso('2026-04-31 10:00'), 'INVALID');
  chk('29 Feb in a common year rejected', iso('2026-02-29 10:00'), 'INVALID');
  chk('29 Feb in a leap year accepted', iso('2028-02-29 10:00'), '2028-02-29T10:00:00.000Z');

  // And the parser must not emit a record carrying one.
  const bad = parseLotekHealthMessages([
    { 'Message date (UTC)': 'rubbish',
      'Raw data': rows.find((r) =>
        (r['Raw data'] ?? '').trim().toLowerCase().startsWith('ed'))!['Raw data'] },
  ]);
  chk('a record with an unparseable date is not returned as valid',
    bad.records.every((r) => !isNaN(r.date.getTime())), true);
}

console.log('\n== THE TAG CLOCK WRAPS, AND A SMALL VALUE IS NOT A NEW TAG ==');
{
  // This cost a wrong diagnosis. The counter is 32 bits at 256 Hz, so it rolls
  // over every 194.181 days. A tag still transmitting 200 days after activation
  // reported 6.5 days; working back from that put its activation months after
  // its own archive proved it was already running, which reads exactly like a
  // device that rebooted. Two sibling tags showed nothing similar — but they had
  // stopped transmitting days before their own counters would have wrapped, so
  // only the surviving tag ever crossed it.
  chk('wrap period is 194.181 days', Number((TAG_CLOCK_WRAP_S / 86400).toFixed(3)), 194.181);

  const rec = (iso: string, tagSeconds: number) =>
    ({ date: new Date(iso), tagSeconds }) as never;

  // The real readings: a tag heard at 6.5 days, and a sibling at 177.2 days.
  const wrapped = [
    rec('2026-08-07T13:26:00Z', 6.5229 * 86400),
    rec('2026-08-09T13:51:00Z', 8.5401 * 86400),
  ];
  const opts = estimateClockEpoch(wrapped);
  chk('zero wraps gives the misleading answer',
    opts[0].epoch.toISOString().slice(0, 7), '2026-08');
  chk('one wrap lands in January', opts[1].epoch.toISOString().slice(0, 7), '2026-01');
  chk('...on the 18th, with its siblings',
    opts[1].epoch.toISOString().slice(0, 10), '2026-01-18');

  // Both remain arithmetically consistent — the record cannot choose between
  // them, and the function must not pretend otherwise.
  chk('every wrap count is offered', opts.length >= 3, true);
  chk('...each internally consistent', opts.every((o) => o.residualS < 120), true);

  chk('no records, no epochs', estimateClockEpoch([]).length, 0);
}

console.log('\n== ACTIVITY LOG (0xA0) — PARTIAL DECODE ==');
{
  // 0xA0 is the bulk of what these tags transmit and was skipped entirely.
  // Temperature is decoded; pressure is not. The layout was found by pairing
  // raw payloads against the manufacturer's decode of the same deployment.
  const real = rows.find((r) =>
    (r['Raw data'] ?? '').trim().toLowerCase().startsWith('a0'));
  chk('the export contains activity payloads', real !== undefined, true);

  if (real) {
    const bytes = Uint8Array.from(
      (real['Raw data'].trim().match(/../g) ?? []).map((x) => parseInt(x, 16))
    );
    const d = decodeActivityMessage(bytes)!;
    chk('seven records per message', d.temperaturesC.length, 7);
    // Not the same as the health message's on the same tag — 0x31 against 0x32 —
    // so byte 1 varies by message type, not only by deployment.
    chk('the format byte differs from the health message\'s',
      d.formatByte !== h.records[0].formatByte, true);
    // Not constant — corrupt payloads scatter it across many values. What holds
    // is that one value dominates, which is why it is too weak to screen on.
    const fmts = parseLotekActivityMessages(rows).records.map((r) => r.formatByte);
    const counts = new Map<number, number>();
    for (const f of fmts) counts.set(f, (counts.get(f) ?? 0) + 1);
    const modal = Math.max(...Array.from(counts.values()));
    chk('...and one format byte dominates the rest', modal / fmts.length > 0.9, true);
    chk('the clock is on the same 256 Hz scale', d.baseTagSeconds > 0, true);
  }

  const act = parseLotekActivityMessages(rows);
  chk('records are recovered in bulk', act.records.length > 1000, true);
  chk('...ordered by the tag clock',
    act.records.every((r, i) => i === 0 || r.tagSeconds >= act.records[i - 1].tagSeconds), true);
  chk('...spaced 300 s apart within a message',
    act.records.length > 1 &&
      act.records.slice(1, 40).some((r, i) => Math.abs(r.tagSeconds - act.records[i].tagSeconds - 300) < 1),
    true);
  chk('every temperature is physical',
    act.records.every((r) => r.temperatureC > -5 && r.temperatureC < 45), true);

  // Byte 15 is not part of a record. A uniform 3-byte stride decodes the fourth
  // record onward to nothing, which is how the gap was found.
  const b = Uint8Array.from([0xa0, 0x31, 0xe5, 0x21, 0x7c, 0xe5,
    0x9d, 0xe5, 0x06, 0x9d, 0xcd, 0x06, 0x9d, 0xc5, 0x06, 0x60,
    0x9d, 0xc5, 0x06, 0x9d, 0xcd, 0x06, 0x9d, 0xb8, 0x06, 0x9d, 0x06, 0xcd, 0x06, 0x9d, 0xb8]);
  const d2 = decodeActivityMessage(b)!;
  chk('records 3 and 4 decode past the skipped byte',
    d2.temperaturesC[3] !== null && d2.temperaturesC[4] !== null, true);
  chk('...to sane values',
    d2.temperaturesC[3]! > 25 && d2.temperaturesC[3]! < 35, true);

  chk('a non-activity payload is refused',
    decodeActivityMessage(Uint8Array.from(new Array(31).fill(0xed))), null);
  chk('a wrong-length payload is refused',
    decodeActivityMessage(Uint8Array.from(new Array(20).fill(0xa0))), null);
}

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
