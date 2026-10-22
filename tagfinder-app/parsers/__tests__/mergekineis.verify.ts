/**
 * A Wildlife Computers export and a CLS (Argos-Kinéis portal) message export
 * of the same tag, combined. See analysis/mergeSources.ts.
 *
 * No real Kinéis export of 33938 exists yet, so the CLS file is built from
 * its own RawArgos (legacy satellites, every row a duplicate of what WC holds)
 * plus three Kinéis messages after its last WC fix, written with the column
 * labels of Wildlife Computers' Kinéis guide ("Loc. class", "Doppler Date of
 * position (UTC)").
 *
 *   npx tsx parsers/__tests__/mergekineis.verify.ts
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import Papa from 'papaparse';
import { parseArgosMessages } from '@/parsers/argos/messages';
import { detectFile } from '@/parsers/detect';
import { parseLocations } from '@/parsers/wc/locations';
import { parseArgos } from '@/parsers/wc/argos';
import { parseWCRawArgosTimes } from '@/parsers/wc/rawArgos';
import { mergeFixes, mergePasses, mergeMessageTimes } from '@/analysis/mergeSources';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(64)} ${detail}`);
};
const csv = (p: string) => Papa.parse<Record<string, string>>(readFileSync(p, 'utf8'), { header: true, skipEmptyLines: true }).data;
const MON: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
const cls = (d: string, t: string) => { const [dd, mm, yy] = d.split('-'); return `${yy}-${MON[mm]}-${dd.padStart(2, '0')} ${t}`; };

const GUIDE_HEADER = ['Device ID', 'Program Ref', 'Message date (UTC)', 'Raw data', 'Size (bits)', 'Doppler Position ID', 'Doppler Date of position (UTC)',
  'Doppler Longitude', 'Doppler Latitude', 'Doppler Error radius', 'Loc. class', 'Number of messages', 'Satellite', 'Signal Level', 'Message UID'];
const f = new File([GUIDE_HEADER.join(',') + '\n'], '33938-messages.csv');
chk('a guide-format CLS export is recognised as a message export', detectFile(f, GUIDE_HEADER).fileType === 'argos_messages', detectFile(f, GUIDE_HEADER).fileType);

const dir = resolve(process.env.TAGFINDER_FIXTURES ?? resolve(process.env.HOME ?? '', 'Documents/Apps/tagfinder/data'), 'wc-33938-2026-10-21c');
if (!existsSync(dir)) {
  console.log('  (33938 export absent)');
} else {
  const raw = csv(resolve(dir, '33938-RawArgos.csv'));
  const rows: Record<string, string>[] = raw.map((r, i) => ({
    'Device ID': '33938', 'Program Ref': '30748',
    'Message date (UTC)': cls(r.MsgDate, r.MsgTime), 'Raw data': `msg${i}`,
    'Doppler Position ID': r.Latitude ? `${r.PassDate} ${r.PassTime}` : '',
    'Doppler Date of position (UTC)': r.Latitude ? cls(r.PassDate, r.PassTime) : '',
    'Doppler Longitude': r.Longitude, 'Doppler Latitude': r.Latitude, 'Doppler Error radius': r['Error radius'],
    'Loc. class': r.Class, Satellite: r.Satellite, 'Signal Level': r.Power,
  }));
  // Kinéis 3B overhead at 13:14 EDT on collection day, after WC's last fix (12:10:34 UTC).
  for (const [t, i] of [['2026-10-21 17:15:10', 1], ['2026-10-21 17:16:10', 2], ['2026-10-21 17:17:10', 3]] as const)
    rows.push({ 'Device ID': '33938', 'Program Ref': '30748', 'Message date (UTC)': t, 'Raw data': `kin${i}`,
      'Doppler Position ID': 'K1', 'Doppler Date of position (UTC)': '2026-10-21 17:16:10', 'Doppler Longitude': '-80.6702',
      'Doppler Latitude': '28.1712', 'Doppler Error radius': '310', 'Loc. class': '2', Satellite: 'KIN3B', 'Signal Level': '-131' });

  const m = parseArgosMessages(rows);
  chk('guide-format rows parse: PTT, fixes, Kinéis pass', m.ptt === 33938 && m.fixes.length > 50 && m.passes.some((p) => p.satellite === 'KIN3B'), `${m.fixes.length} fixes, ${m.passes.length} passes`);
  chk('"Loc. class" is read as the class', m.fixes.some((x) => x.quality === '3') && m.fixes.find((x) => x.date.toISOString() === '2026-10-21T17:16:10.000Z')?.quality === '2');

  const wcFixes = parseLocations(csv(resolve(dir, '33938-Locations.csv')));
  const wcPasses = parseArgos(csv(resolve(dir, '33938-Argos.csv')));
  const fx = mergeFixes(wcFixes, m.fixes);
  chk('legacy fixes the WC export already has are not added again', fx.added === 1, `added ${fx.added}`);
  chk('the Kinéis fix is added, and is now the newest', fx.fixes[fx.fixes.length - 1].date.toISOString() === '2026-10-21T17:16:10.000Z');
  const ps = mergePasses(wcPasses, m.passes);
  chk('passes: only the Kinéis one is new', ps.added === 1, `added ${ps.added}`);
  const mt = mergeMessageTimes(parseWCRawArgosTimes(raw), m.messageTimes);
  chk('message times: only the three Kinéis messages are new', mt.added === 3, `added ${mt.added}`);
  chk('merged lists stay in time order', fx.fixes.every((x, i) => i === 0 || x.date >= fx.fixes[i - 1].date));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
