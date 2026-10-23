/**
 * The export's own timestamp (version.txt) — parsers/wc/version.ts — and the
 * sky window ending there rather than at the moment the page is opened.
 *
 *   npx tsx parsers/__tests__/exporttime.verify.ts
 */
import { existsSync, readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { parseWCVersion } from '@/parsers/wc/version';
import { skyWindowEnd } from '@/analysis/restingPeriod';
import type { ArgosPass } from '@/lib/types';

let pass = 0, fail = 0;
const chk = (label: string, ok: boolean, detail = '') => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(64)} ${detail}`);
};

const sample = 'This data was decoded with version 3.0.640 of DAP.\r\nThis data was last updated on: 2026-10-02 15:42:26 (UTC).\r\n';
const v = parseWCVersion(sample);
chk('export time read as UTC', v?.exportedAt?.toISOString() === '2026-10-02T15:42:26.000Z', v?.exportedAt?.toISOString());
chk('decoder version read', v?.dapVersion === '3.0.640', `${v?.dapVersion}`);
chk('an Argos message file is not a version file', parseWCVersion('PTT,Satellite,MsgDate,MsgTime\n33938,MC,21-Oct-2026,10:27:36') === null);

// Sky window: last pass 10:27, export built 12:00, page opened 18:00 the same day.
const passes = [{ date: new Date('2026-10-21T10:27:00Z') }] as unknown as ArgosPass[];
const opened = new Date('2026-10-21T18:00:00Z');
const exported = new Date('2026-10-21T12:00:00Z');
chk('without the export time the window runs to the page opening', skyWindowEnd(passes, opened)?.toISOString() === opened.toISOString());
chk('with it, the window ends when the export was built', skyWindowEnd(passes, exported)?.toISOString() === exported.toISOString());
chk('an old export still ends at its last pass', skyWindowEnd(passes, new Date('2026-10-25T12:00:00Z'))?.toISOString() === '2026-10-21T10:27:00.000Z');

const root = process.env.TAGFINDER_FIXTURES ?? resolve(process.env.HOME ?? '', 'Documents/Apps/tagfinder/data');
let n = 0;
if (existsSync(root)) for (const d of readdirSync(root)) {
  const f = resolve(root, d, 'version.txt');
  if (!existsSync(f)) continue;
  const r = parseWCVersion(readFileSync(f, 'utf8'));
  if (r?.exportedAt) n++; else chk(`${d}: version.txt read`, false);
}
chk('every saved version.txt yields an export time', n > 0, `${n} files`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
