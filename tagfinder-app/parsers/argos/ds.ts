import type { ArgosFix, ArgosPass, ArgosQuality } from '@/lib/types';
import { EMPIRICAL_ERRORS, DISCARD_QUALITIES } from '@/lib/constants';

/**
 * Argos "DS" raw dump, as delivered by CLS.
 *
 * This is a CLS product, not a manufacturer one — a Wildlife Computers tag and
 * a Lotek tag produce byte-identical-looking files. It therefore identifies the
 * data source, never the hardware.
 *
 * Layout: a pass header, then one block of message lines per received message,
 * each message continuing over several lines of hex payload.
 *
 *   09999 099999  25 31 3E A 2026-01-02 03:52:23  12.34567  -45.67890  0 401675940.91
 *         2026-01-02 03:51:21  1   ed  32  08  12
 *                                  b4  e5  80  c0
 *
 * Header fields: programme, PTT, line count, bytes/message, satellite, and then
 * — only when Argos resolved a position — location class, date, time, latitude,
 * longitude, altitude, frequency.
 *
 * Two things this format does NOT carry, which the Wildlife Computers Locations
 * export does: error ellipses (radius / semi-major / semi-minor / orientation)
 * and secondary "mirror" solutions. Fixes therefore fall back to the empirical
 * per-class errors, and mirrorCheck cannot run. The CLS Doppler spreadsheet
 * export does include a continuous error radius if a tighter position is needed.
 *
 * The frequency field is already Doppler-corrected by CLS. Across 110 passes
 * from a single stationary tag it varied by only 51 Hz, where raw reception
 * would swing roughly +/-9 kHz across a pass — so it can be read directly as
 * the transmitter's carrier frequency rather than averaged.
 */

const HEADER_RE =
  /^(\d{5})\s+(\d{4,7})\s+(\d+)\s+(\d+)\s+(\S+)\s*(?:([0-9ABZ])\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+([\d.]+))?\s*$/;

const MESSAGE_RE = /^\s+(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s+\d+\s+[0-9a-f]{2}/;

/** Each received message occupies 8 payload lines after the header line. */
const LINES_PER_MESSAGE = 8;

export interface ArgosDSResult {
  fixes: ArgosFix[];
  passes: ArgosPass[];
  /** Every reception, for measuring the tag's transmission period. */
  messageTimes: { date: Date; satellite: string }[];
  /** PTT read from the file, if consistent across blocks. */
  ptt: number | null;
  /** Passes that delivered messages but no resolved position. */
  unlocatedPasses: number;
}

function toDate(d: string, t: string): Date {
  return new Date(`${d}T${t}Z`);
}

export function parseArgosDS(text: string): ArgosDSResult {
  const fixes: ArgosFix[] = [];
  const passes: ArgosPass[] = [];
  const ptts = new Set<number>();
  let unlocatedPasses = 0;

  let current: ArgosPass | null = null;
  let currentTimes: Date[] = [];
  const messageTimes: { date: Date; satellite: string }[] = [];

  const flush = () => {
    if (!current) return;
    const sorted = currentTimes.slice().sort((a, b) => a.getTime() - b.getTime());

    // Mean gap between messages actually received during the pass, in seconds.
    if (sorted.length >= 2) {
      const span = sorted[sorted.length - 1].getTime() - sorted[0].getTime();
      current.avgInterval = Math.round(span / 1000 / (sorted.length - 1));
    }

    // A pass Argos could not resolve still carries its message timestamps, and
    // still counts toward message yield and transmission health. Date it from
    // its first message rather than leaving it NaN — an unplaceable date
    // propagates into every consumer that buckets or sorts by time.
    if (isNaN(current.date.getTime()) && sorted.length > 0) {
      current.date = sorted[0];
    }

    // Nothing locatable and nothing timestamped: cannot be placed in time at
    // all, so it would only corrupt downstream ordering.
    if (!isNaN(current.date.getTime())) {
      passes.push(current);
    }

    current = null;
    currentTimes = [];
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const header = HEADER_RE.exec(rawLine);
    if (header) {
      flush();
      const [, , pttStr, nLines, , sat, lc, d, t, lat, lon, , freq] = header;

      const ptt = parseInt(pttStr, 10);
      if (Number.isFinite(ptt)) ptts.add(ptt);

      const msgCount = Math.max(0, Math.floor((parseInt(nLines, 10) - 1) / LINES_PER_MESSAGE));
      const located = Boolean(lc && d && t && lat && lon);
      if (!located) unlocatedPasses++;

      const passDate = located ? toDate(d, t) : new Date(NaN);

      current = {
        date: passDate,
        satellite: sat,
        msgCount,
        duplicates: 0, // not reported in DS
        // Not reported in DS. Must stay null rather than 0, or "no CRC data"
        // renders as a confident "0% corrupted".
        corrupt: null,
        avgInterval: 0,
        locationQuality: lc || '',
        latitude: located ? parseFloat(lat) : null,
        longitude: located ? parseFloat(lon) : null,
        latitude2: null, // DS carries no mirror solution
        longitude2: null,
        frequencyHz: freq ? parseFloat(freq) : null,
        powerDbm: null, // not reported in DS
      };

      if (located) {
        const quality = lc as ArgosQuality;
        const latitude = parseFloat(lat);
        const longitude = parseFloat(lon);
        if (
          !DISCARD_QUALITIES.includes(quality) &&
          Number.isFinite(latitude) &&
          Number.isFinite(longitude) &&
          !isNaN(passDate.getTime())
        ) {
          fixes.push({
            date: passDate,
            latitude,
            longitude,
            quality,
            errorRadius: 0,
            semiMajor: 0,
            semiMinor: 0,
            orientation: 0,
            effectiveError: EMPIRICAL_ERRORS[quality] ?? 5000,
            isOutlier: false,
          });
        }
      }
      continue;
    }

    const msg = MESSAGE_RE.exec(rawLine);
    if (msg && current) {
      const [datePart, timePart] = msg[1].split(' ');
      const at = toDate(datePart, timePart);
      currentTimes.push(at);
      if (!isNaN(at.getTime())) {
        messageTimes.push({ date: at, satellite: current.satellite });
      }
    }
  }
  flush();

  fixes.sort((a, b) => a.date.getTime() - b.date.getTime());
  passes.sort((a, b) => a.date.getTime() - b.date.getTime());

  messageTimes.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    fixes,
    passes,
    messageTimes,
    ptt: ptts.size === 1 ? Array.from(ptts)[0] : null,
    unlocatedPasses,
  };
}

/** Cheap content sniff — does this look like an Argos DS dump? */
export function looksLikeArgosDS(text: string): boolean {
  const lines = text.split(/\r?\n/, 60);
  return lines.some((l) => HEADER_RE.test(l));
}
