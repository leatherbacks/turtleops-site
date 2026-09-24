import type {
  ArgosFix,
  ArgosPass,
  ArgosQuality,
  DailyDiveSummary,
  LotekDayRecord,
  LotekHealthRecord,
  SSTReading,
  SeriesReading,
} from '@/lib/types';
import { EMPIRICAL_ERRORS } from '@/lib/constants';
import type { LotekDailyPosition } from './dayLog';
import type { LotekPortalDayLog, LotekPortalDiveLog } from './portalLog';
import { isPlausibleHealthRecord, type LotekHealthResult } from './healthMessage';
import { longitudeFromNoonMinute, equationOfTimeMinutes } from './solarNoon';

/**
 * Lotek's Argos-relayed container: `PIDnnnnnn_TagIDnnnnn_PsatPlus_LVS.bin`,
 * what Lotek's downloader emits for a tag that is still at sea. Not to be
 * confused with the `[PSAT3_LLOG]` container read by offload.ts, which is the
 * flash of a tag physically in hand.
 *
 * This is the file that matters for a recovery, because alongside the decoded
 * logs it carries the Argos Doppler fixes — the one thing the site otherwise
 * sends users to CLS for. Nobody said so; the section was found by reading the
 * bytes, and it decodes to positions with location classes that trace a
 * coherent week-long drift.
 *
 * Layout, established on one deployment and verified field by field against
 * Lotek's own decode of the same tag (portalLog.ts): dive samples 14,342 of
 * 14,342 identical, health records identical on every field, day-log latitude
 * and longitude within the portal's 0.1° rounding.
 *
 *   header   "PSAT+-Argos"  u32 PID  u16 serial
 *   then     sections: u8 type, u32 count, count × fixed-size record
 *
 * All integers little-endian. Every timestamp is seconds since 2000-01-01
 * UTC; day numbers are days since the same epoch. Temperatures are raw/50 − 20,
 * as everywhere in Lotek's formats. Latitude is raw × 90/2047 with 2047 as the
 * no-fix sentinel; the "longitude" slots are solar-noon minutes (solarNoon.ts).
 *
 *   type  size  contents
 *   ----  ----  ------------------------------------------------------------
 *   3     42    day log: rx, u16 day, u16 pad, block 1 (sunrise, sunset, latN,
 *               latS, noonN, noonS, sst, sstDepth) + crc, block 2 (sstTime,
 *               minExtTemp, minDepth, maxDepth, four error slots) + crc
 *   0     13    dive: rx, tag time, crc, u16 temp, u16 depth
 *   1     15    dive variant with one more u16; every record seen failed CRC
 *   2     16    dive variant with one more u16 and a byte; likewise all failed
 *   5     33    health: rx, tag time, status byte, u16 serial, depth,
 *               corrosion s, crc, startV/100, endV/100, temp, light, latN,
 *               latS, noonN, noonS, crc
 *   10    17    ARGOS FIX: rx, u32 lat×1000, u32 lon×1000 (0–360), u32 zero,
 *               u8 location class as an ASCII character
 *   13    6     per message: rx, u8 signal, u8 flag
 *   11    7     per health message: rx, u16 message counter, u8 crc
 *
 * The day and health records carry two CRC flags because each is relayed in
 * two Argos message blocks; a failed block is still printed with whatever
 * bytes arrived, so each field is trusted only when its own block passed.
 * Which fields sit in which block was settled from duplicate receptions of the
 * same day disagreeing exactly where the second block begins.
 *
 * What this parser does NOT claim. The four error slots in the day log are
 * left undecoded: the manufacturer's latitude error fits C/√raw well, but
 * their longitude errors are not a function of the slot alone, and a fitted
 * approximation is not a decode. Types 1 and 2 are skipped and counted. The
 * per-message signal byte is exposed as dBm on an inferred scale (see
 * SIGNAL_DBM_OFFSET) and should be read for trend, not absolute level.
 */

export const LOTEK_ARGOS_MAGIC = 'PSAT+-Argos';

const EPOCH_2000_MS = Date.UTC(2000, 0, 1);
const DAY_MS = 86_400_000;

const SECTION_SIZES: Record<number, number> = { 0: 13, 1: 15, 2: 16, 3: 42, 5: 33, 10: 17, 11: 7, 13: 6 };
const SECTION_DAY = 3;
const SECTION_DIVE = 0;
const SECTION_HEALTH = 5;
const SECTION_FIX = 10;
const SECTION_MESSAGE = 13;
const SECTION_COUNTER = 11;

const LATITUDE_FULL_SCALE = 2047;
const NO_SST_RAW = 0;
const MINUTES_PER_DAY = 1440;

/** Readings closer together than this are the same sample — see diveLog.ts. */
const MIN_SAMPLE_GAP_MS = 30_000;

/**
 * Passes are anchored on the fixes, not clustered from the receptions alone.
 * The reception log carries no satellite identity, and two satellites are
 * often overhead within minutes of each other, so clustering on time gaps
 * merged their passes and reported more fixes than passes. Instead each fix
 * is one located pass and takes the receptions within PASS_HALF_WINDOW_S of
 * it; receptions near no fix are clustered on PASS_GAP_S into unlocated passes.
 */
const PASS_HALF_WINDOW_S = 600;
const PASS_GAP_S = 900;

/**
 * The per-message signal byte reads 224–228 on almost every message of the
 * reference deployment, with a scatter of rarer low values. Read as
 * byte − 356 it gives −132 to −128 dBm, which is the range CLS reported as
 * "Signal Level" for a sibling tag on the same programme. Inferred, not
 * verified against a CLS export of this tag; bytes under 200 are not signal.
 */
const SIGNAL_DBM_OFFSET = -356;
const SIGNAL_MIN_BYTE = 200;

export interface LotekArgosContainerResult {
  ptt: number;
  serial: number;
  fixes: ArgosFix[];
  passes: ArgosPass[];
  /** Every reception, for measuring the tag's transmission period. */
  messageTimes: { date: Date; satellite: string }[];
  unlocatedPasses: number;
  health: LotekHealthResult;
  dive: LotekPortalDiveLog;
  day: LotekPortalDayLog;
  /** Sections as found, in file order. */
  sections: { type: number; count: number }[];
  /** Records in sections whose layout is known but whose meaning is not. */
  skippedRecords: number;
  /** Reception span of the file. */
  from: Date | null;
  to: Date | null;
  /** Set when the walk stopped early on a section type this parser cannot size. */
  warning: string | null;
}

export function isLotekArgosContainer(head: Uint8Array): boolean {
  const text = new TextDecoder('ascii').decode(head.slice(0, LOTEK_ARGOS_MAGIC.length));
  return text === LOTEK_ARGOS_MAGIC;
}

const tagDate = (s: number) => new Date(EPOCH_2000_MS + s * 1000);
const dayDate = (d: number) => new Date(EPOCH_2000_MS + d * DAY_MS);
const tempC = (raw: number) => Number((raw / 50 - 20).toFixed(2));
const latitude = (raw: number) =>
  raw >= LATITUDE_FULL_SCALE ? null : Number(((raw * 90) / LATITUDE_FULL_SCALE).toFixed(3));
const minutes = (raw: number) => (raw > 0 && raw < MINUTES_PER_DAY ? raw : null);

function qualityOf(ch: string): ArgosQuality | null {
  return ch === '3' || ch === '2' || ch === '1' || ch === '0' || ch === 'A' || ch === 'B' || ch === 'Z'
    ? (ch as ArgosQuality)
    : null;
}

export function parseLotekArgosContainer(bytes: Uint8Array): LotekArgosContainerResult {
  if (!isLotekArgosContainer(bytes)) throw new Error('Not a Lotek PSAT+-Argos container.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = LOTEK_ARGOS_MAGIC.length;
  const ptt = view.getUint32(p, true);
  const serial = view.getUint16(p + 4, true);
  p += 6;

  // ─── walk the sections ───
  const sections: { type: number; count: number; offset: number }[] = [];
  let warning: string | null = null;
  while (p + 5 <= bytes.length) {
    const type = bytes[p];
    const count = view.getUint32(p + 1, true);
    const size = SECTION_SIZES[type];
    if (size === undefined) {
      warning = `Stopped at an unknown section type ${type} (${count} records) at byte ${p}; everything before it was read.`;
      break;
    }
    if (p + 5 + count * size > bytes.length) {
      warning = `Section type ${type} claims ${count} records but the file ends first; read what was there.`;
      sections.push({ type, count: Math.floor((bytes.length - p - 5) / size), offset: p + 5 });
      break;
    }
    sections.push({ type, count, offset: p + 5 });
    p += 5 + count * size;
  }
  const find = (t: number) => sections.filter((s) => s.type === t);

  let earliest = Infinity;
  let latest = -Infinity;
  const seen = (rx: number) => {
    if (rx < earliest) earliest = rx;
    if (rx > latest) latest = rx;
  };

  // ─── fixes (type 10) ───
  const fixes: ArgosFix[] = [];
  for (const s of find(SECTION_FIX)) {
    for (let i = 0; i < s.count; i++) {
      const o = s.offset + i * 17;
      const rx = view.getUint32(o, true);
      const lat = view.getUint32(o + 4, true) / 1000;
      let lon = view.getUint32(o + 8, true) / 1000;
      if (lon > 180) lon -= 360;
      const quality = qualityOf(String.fromCharCode(bytes[o + 16]));
      if (!quality || quality === 'Z') continue;
      if (!Number.isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
      seen(rx);
      fixes.push({
        date: tagDate(rx),
        latitude: lat,
        longitude: lon,
        quality,
        // No per-fix error is carried; class-based empirical errors apply, as
        // for the Argos DS dump.
        errorRadius: 0,
        semiMajor: 0,
        semiMinor: 0,
        orientation: 0,
        effectiveError: EMPIRICAL_ERRORS[quality] ?? 5000,
        isOutlier: false,
      });
    }
  }
  fixes.sort((a, b) => a.date.getTime() - b.date.getTime());

  // ─── receptions (type 13) → message times and passes ───
  const receptions: { rx: number; signal: number; ok: boolean }[] = [];
  for (const s of find(SECTION_MESSAGE)) {
    for (let i = 0; i < s.count; i++) {
      const o = s.offset + i * 6;
      const rx = view.getUint32(o, true);
      seen(rx);
      receptions.push({ rx, signal: bytes[o + 4], ok: bytes[o + 5] === 1 });
    }
  }
  receptions.sort((a, b) => a.rx - b.rx);
  const messageTimes = receptions.map((r) => ({ date: tagDate(r.rx), satellite: 'unknown' }));

  const passes: ArgosPass[] = [];
  let unlocatedPasses = 0;
  const makePass = (group: typeof receptions, fix: ArgosFix | null, at: number): ArgosPass => {
    const times = group.map((r) => r.rx);
    const start = times.length ? Math.min(...times) : at;
    const end = times.length ? Math.max(...times) : at;
    const signals = group.filter((r) => r.signal >= SIGNAL_MIN_BYTE).map((r) => r.signal);
    return {
      date: tagDate(fix ? at : start),
      satellite: 'unknown',
      msgCount: group.length,
      duplicates: 0,
      corrupt: group.filter((r) => !r.ok).length,
      avgInterval: group.length > 1 ? (end - start) / (group.length - 1) : 0,
      locationQuality: fix?.quality ?? '',
      latitude: fix?.latitude ?? null,
      longitude: fix?.longitude ?? null,
      latitude2: null,
      longitude2: null,
      frequencyHz: null,
      powerDbm: signals.length
        ? signals.reduce((a, b) => a + b, 0) / signals.length + SIGNAL_DBM_OFFSET
        : null,
    };
  };
  // Each reception goes to the nearest fix within the window, else is left over.
  const fixTimes = fixes.map((f) => Math.round((f.date.getTime() - EPOCH_2000_MS) / 1000));
  const byFix: (typeof receptions)[] = fixes.map(() => []);
  const leftover: typeof receptions = [];
  let j = 0;
  for (const r of receptions) {
    while (j + 1 < fixTimes.length && Math.abs(fixTimes[j + 1] - r.rx) <= Math.abs(fixTimes[j] - r.rx)) j++;
    if (fixTimes.length && Math.abs(fixTimes[j] - r.rx) <= PASS_HALF_WINDOW_S) byFix[j].push(r);
    else leftover.push(r);
  }
  fixes.forEach((f, i) => passes.push(makePass(byFix[i], f, fixTimes[i])));
  let cluster: typeof receptions = [];
  const flush = () => {
    if (cluster.length === 0) return;
    passes.push(makePass(cluster, null, cluster[0].rx));
    unlocatedPasses++;
    cluster = [];
  };
  for (const r of leftover) {
    if (cluster.length && r.rx - cluster[cluster.length - 1].rx > PASS_GAP_S) flush();
    cluster.push(r);
  }
  flush();
  passes.sort((a, b) => a.date.getTime() - b.date.getTime());

  // ─── health message counters (type 11), joined to health records on rx ───
  const counters = new Map<number, number>();
  for (const s of find(SECTION_COUNTER)) {
    for (let i = 0; i < s.count; i++) {
      const o = s.offset + i * 7;
      counters.set(view.getUint32(o, true), view.getUint16(o + 4, true));
    }
  }

  // ─── health (type 5) ───
  const healthByTagTime = new Map<number, LotekHealthRecord>();
  let corrupt = 0;
  const healthRaw: { rx: number; tag: number; status: number; serial: number; depth: number; corrosion: number; crc1: boolean; startV: number; endV: number; temp: number; light: number; crc2: boolean }[] = [];
  for (const s of find(SECTION_HEALTH)) {
    for (let i = 0; i < s.count; i++) {
      const o = s.offset + i * 33;
      const rec = {
        rx: view.getUint32(o, true),
        tag: view.getUint32(o + 4, true),
        status: bytes[o + 8],
        serial: view.getUint16(o + 9, true),
        depth: view.getUint16(o + 11, true),
        corrosion: view.getUint16(o + 13, true),
        crc1: bytes[o + 15] === 1,
        startV: view.getUint16(o + 16, true) / 100,
        endV: view.getUint16(o + 18, true) / 100,
        temp: view.getUint16(o + 20, true),
        light: view.getUint16(o + 22, true),
        crc2: bytes[o + 32] === 1,
      };
      seen(rec.rx);
      healthRaw.push(rec);
    }
  }
  for (const r of healthRaw) {
    if (!r.crc1 || !r.crc2) {
      corrupt++;
      continue;
    }
    const rec: LotekHealthRecord = {
      date: tagDate(r.rx),
      formatByte: 0,
      // Absolute seconds since 2000 here, not the payload's relative 256 Hz
      // counter; kept for ordering and deduplication only.
      tagSeconds: r.tag,
      statusByte: r.status,
      wetFlag: (r.status & 0x80) !== 0,
      serial: r.serial,
      depthM: r.depth,
      messageCounter: counters.get(r.rx) ?? 0,
      corrosionTimeS: r.corrosion,
      corrosionStartV: r.startV,
      corrosionEndV: r.endV,
      temperatureC: tempC(r.temp),
      light: r.light,
    };
    if (!isPlausibleHealthRecord(rec)) {
      corrupt++;
      continue;
    }
    if (!healthByTagTime.has(r.tag)) healthByTagTime.set(r.tag, rec);
  }
  const healthRecords = Array.from(healthByTagTime.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const statusValues = Array.from(new Set(healthRecords.map((r) => r.statusByte))).sort((a, b) => a - b);
  const health: LotekHealthResult = {
    records: healthRecords,
    corrupt,
    inconsistent: 0,
    undated: 0,
    statusChanged: statusValues.length > 1,
    statusValues,
  };

  // ─── dive (type 0) ───
  const diveByTime = new Map<number, SeriesReading>();
  let diveRejected = 0;
  for (const s of find(SECTION_DIVE)) {
    for (let i = 0; i < s.count; i++) {
      const o = s.offset + i * 13;
      seen(view.getUint32(o, true));
      const tag = view.getUint32(o + 4, true);
      if (bytes[o + 8] !== 1) {
        diveRejected++;
        continue;
      }
      if (diveByTime.has(tag)) continue;
      diveByTime.set(tag, {
        date: tagDate(tag),
        depth: view.getUint16(o + 11, true),
        depthRange: null,
        temperature: tempC(view.getUint16(o + 9, true)),
        temperatureRange: null,
      });
    }
  }
  const diveSorted = Array.from(diveByTime.values()).sort((a, b) => a.date.getTime() - b.date.getTime());
  const readings: SeriesReading[] = [];
  let duplicatesDropped = 0;
  for (const r of diveSorted) {
    const prev = readings[readings.length - 1];
    if (prev && r.date.getTime() - prev.date.getTime() < MIN_SAMPLE_GAP_MS) {
      duplicatesDropped++;
      continue;
    }
    readings.push(r);
  }
  const dive: LotekPortalDiveLog = { readings, records: readings.length, rejected: diveRejected, duplicatesDropped };

  let skippedRecords = 0;
  for (const s of sections) if (s.type === 1 || s.type === 2) skippedRecords += s.count;

  // ─── day log (type 3) ───
  interface DayBlocks { day: number; b1: number[] | null; b2: number[] | null }
  const days = new Map<number, DayBlocks>();
  let dayRejected = 0;
  for (const s of find(SECTION_DAY)) {
    for (let i = 0; i < s.count; i++) {
      const o = s.offset + i * 42;
      seen(view.getUint32(o, true));
      const day = view.getUint16(o + 4, true);
      const crc1 = bytes[o + 24] === 1;
      const crc2 = bytes[o + 41] === 1;
      if (!crc1 && !crc2) {
        dayRejected++;
        continue;
      }
      const b1: number[] = [];
      const b2: number[] = [];
      for (let k = 0; k < 8; k++) {
        b1.push(view.getUint16(o + 8 + 2 * k, true));
        b2.push(view.getUint16(o + 25 + 2 * k, true));
      }
      const entry = days.get(day) ?? { day, b1: null, b2: null };
      if (crc1 && !entry.b1) entry.b1 = b1;
      if (crc2 && !entry.b2) entry.b2 = b2;
      days.set(day, entry);
    }
  }
  const dailyDives: DailyDiveSummary[] = [];
  const sst: SSTReading[] = [];
  const positions: LotekDailyPosition[] = [];
  const dayRecords: LotekDayRecord[] = [];
  for (const d of Array.from(days.values()).sort((a, b) => a.day - b.day)) {
    const date = dayDate(d.day);
    const b1 = d.b1;
    const b2 = d.b2;
    if (b2) dailyDives.push({ date, minDepth: b2[2], maxDepth: b2[3], minAccuracy: 0, maxAccuracy: 0 });
    let sstC: number | null = null;
    if (b1 && b1[6] !== NO_SST_RAW) {
      sstC = tempC(b1[6]);
      const at = new Date(date.getTime());
      const minute = b2 ? minutes(b2[0]) : null;
      if (minute !== null) at.setUTCMinutes(minute);
      sst.push({ date: at, depth: b1[7], temperature: sstC, source: 'lotek-sst' });
    }
    const lonN = b1 ? longitudeFromNoonMinute(b1[4], date) : null;
    const lonS = b1 ? longitudeFromNoonMinute(b1[5], date) : null;
    positions.push({
      date,
      latNorth: b1 ? latitude(b1[2]) : null,
      latSouth: b1 ? latitude(b1[3]) : null,
      lonNorth: lonN,
      lonSouth: lonS,
      latErrNorth: null,
      latErrSouth: null,
      lonErrNorth: null,
      lonErrSouth: null,
      thresholdLat: null,
      thresholdLon: null,
    });
    dayRecords.push({
      date,
      sunriseMinutesUtc: b1 ? minutes(b1[0]) : null,
      sunsetMinutesUtc: b1 ? minutes(b1[1]) : null,
      latitudeNorth: b1 ? latitude(b1[2]) : null,
      latitudeSouth: b1 ? latitude(b1[3]) : null,
      longitudeNorth: lonN,
      longitudeSouth: lonS,
      sstC,
    });
  }
  const day: LotekPortalDayLog = {
    dailyDives,
    sst,
    positions,
    dayRecords,
    records: Array.from(days.values()).filter((d) => d.b1).length,
    rejected: dayRejected,
  };

  return {
    ptt,
    serial,
    fixes,
    passes,
    messageTimes,
    unlocatedPasses,
    health,
    dive,
    day,
    sections: sections.map((s) => ({ type: s.type, count: s.count })),
    skippedRecords,
    from: Number.isFinite(earliest) ? tagDate(earliest) : null,
    to: Number.isFinite(latest) ? tagDate(latest) : null,
    warning,
  };
}

/** Exposed for the verify script: the equation of time the decode relies on. */
export { equationOfTimeMinutes };
