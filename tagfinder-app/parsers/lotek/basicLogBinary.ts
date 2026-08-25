/**
 * Lotek PSAT+ basic log, read from a recovered tag's offloaded .bin file.
 *
 * The densest record the tag keeps and the only one never transmitted: on the
 * reference deployment, 197,390 samples at one per 12 seconds for 27.5 days,
 * against 7,888 in the activity log and 3,225 recoverable over Argos. It exists
 * only on a physically recovered tag.
 *
 * The file is a SELF-DELIMITING RECORD STREAM, not a fixed-stride array — the
 * assumption that cost two failed decodes before this one:
 *
 *   sample  [A2][b0][b1][b2]                          4 bytes, every 12 s
 *   aux     [E2][battery][u1][u2][u3][u4][u5]         7 bytes, every 60 s
 *
 * Five samples between auxiliaries, and the auxiliaries are the only clock the
 * stream has: nothing in it carries a timestamp of any kind. Sample fields:
 *
 *   temp12  = (b1 & 0x0F) << 8 | b0    degrees C = raw/50 - 20, the same scale
 *                                      as every other Lotek temperature.
 *                                      Validated by daily bands against the
 *                                      activity log: maxima agree to 0.13 C.
 *   press12 = b2 << 4 | b1 >> 4        RAW SENSOR COUNTS, NOT dBar.
 *
 * PRESSURE IS UNCALIBRATED, and assuming otherwise was one of the failed
 * decodes: the counts run about 1.2 per dBar, so treating them as dBar fits
 * nothing while looking almost right. On the reference tag,
 * dBar = 0.827 x counts - 6.6, recovered by regression against the activity
 * log's calibrated pressures over the overlap. The conversion lives in the
 * tag's TagCalInfo header block, which is not decoded, so the constants are
 * PER-TAG: this parser returns counts, and fitPressureCalibration recovers the
 * conversion from any co-timed calibrated reference. Do not ship a hardcoded
 * scale.
 *
 * The aux record is [E2][battery][light][u1][u2][u3][u4]:
 *
 * Battery: volts = raw/20, inferred from the manufacturer's 3.6 V nominal and
 * a month of readings sitting at 3.65-3.70 V.
 *
 * Light: 0-255 on a log-like scale of its own — NOT the health message's
 * units. Identified, not assumed: it is the only aux field with any diel
 * signal (17.6x midday over midnight, medians across 28 days), and deriving
 * sunrise and sunset from it by threshold crossing reproduces the times the
 * tag's own geolocation recorded in the day log to within minutes in the
 * first week. Later in the record the derived day narrows symmetrically —
 * dawn late, dusk early by a similar amount — which is what light attenuation
 * at depth does and what a clock error cannot do, since a slipping minute
 * clock moves both ends the same way. The residual symmetric-component slip
 * works out to ~7 minutes over the month, which doubles as the best available
 * measurement of the minute clock's health. The narrowing steps up around the
 * record's deepest days and does not fully track depth after that; the cause
 * is unresolved and deriving twilight from this channel without the tag's own
 * depth-corrected template fit will read tens of minutes off. Treat it as a
 * relative light level, good for day/night and cloud/depth structure.
 *
 * The remaining four bytes stay unidentified.
 *
 * TIMING IS RELATIVE AND ANCHORLESS. Sample time = minutes-of-aux-seen x 60 +
 * slot x 12, from a stream start the file does not date. The caller must
 * anchor it externally — the activity log's first record is the natural
 * choice. Resynchronisations (corrupt bytes skipped to the next marker) make
 * the minute clock slip slightly; on the reference tag the daily bands stayed
 * aligned across all 29 days, so the drift is bounded well under an hour
 * end-to-end, but treat single-sample timestamps as approximate.
 *
 * THE END OF THIS LOG IS NOT AN EVENT. It ends when the flash fills, full
 * stop. On the reference deployment every one of the tag's three logs ended at
 * its own capacity within a two-hour window, roughly twelve hours BEFORE the
 * scheduled release — and reading the activity log's end as the release
 * produced a wrong conclusion that stood for a day. Nothing the tag records
 * marks the release.
 *
 * A corrupt sample here decodes to a plausible number more often than the
 * other logs' records do (no latched fields, no structure to check), and the
 * physical screen does not catch everything — isolated survivors reading
 * -5 C appeared on four days of the reference record. Use these samples in
 * aggregate, prefer quantiles to extremes, and prefer the activity log's
 * values wherever both hold the same instant.
 */

import type { LotekBasicSample, LotekBasicAux } from '@/lib/types';

const SAMPLE_MARKER = 0xa2;
const AUX_MARKER = 0xe2;
const SAMPLE_LEN = 4;
const AUX_LEN = 7;

const SAMPLE_INTERVAL_S = 12;
const SECONDS_PER_MINUTE = 60;

/** Physical screens. Deliberately generous — see the header on their limits. */
const MIN_TEMP_C = -5;
const MAX_TEMP_C = 45;
const MAX_PRESSURE_COUNTS = 3000;
const MIN_BATTERY_V = 1;
const MAX_BATTERY_V = 5;

/** Volts per count of the aux battery byte. */
const BATTERY_SCALE = 1 / 20;

export interface LotekBasicLogResult {
  samples: LotekBasicSample[];
  aux: LotekBasicAux[];
  /** Bytes skipped to regain a marker — corruption, counted not hidden. */
  resyncBytes: number;
  /** Trailing zero fill after the last record; unwritten flash, not data. */
  padBytes: number;
  /** Samples whose values failed the physical screen. */
  implausible: number;
  reason: string | null;
}

/**
 * Find the stream. The header is variable-length, so the start is discovered:
 * the first sample marker from which a dozen consecutive records chain
 * cleanly. One marker is not enough — 0xA2 appears freely in header bytes.
 */
function findStreamStart(data: Uint8Array): number {
  const CHAIN = 12;
  outer: for (let i = 0; i < Math.min(data.length, 4096); i++) {
    if (data[i] !== SAMPLE_MARKER) continue;
    let p = i;
    for (let k = 0; k < CHAIN; k++) {
      if (data[p] === SAMPLE_MARKER) p += SAMPLE_LEN;
      else if (data[p] === AUX_MARKER) p += AUX_LEN;
      else continue outer;
      if (p >= data.length) continue outer;
    }
    return i;
  }
  return -1;
}

export function parseLotekBasicLog(data: Uint8Array): LotekBasicLogResult {
  const start = findStreamStart(data);
  if (start < 0) {
    return {
      samples: [],
      aux: [],
      resyncBytes: 0,
      padBytes: 0,
      implausible: 0,
      reason:
        'No basic-log stream found. Expected 4-byte 0xA2 sample records with 7-byte 0xE2 auxiliaries between them — this may be an Activity Log or Day Log file, whose layouts differ.',
    };
  }

  const samples: LotekBasicSample[] = [];
  const aux: LotekBasicAux[] = [];
  let resyncBytes = 0;
  let padBytes = 0;
  let implausible = 0;
  let minute = 0;
  let slot = 0;

  let p = start;
  while (p < data.length) {
    const b = data[p];
    if (b === SAMPLE_MARKER && p + SAMPLE_LEN <= data.length) {
      const b0 = data[p + 1];
      const b1 = data[p + 2];
      const b2 = data[p + 3];
      const temperatureC = (((b1 & 0x0f) << 8) | b0) / 50 - 20;
      const pressureCounts = (b2 << 4) | (b1 >> 4);
      // The slot advances even when the value is rejected: the record existed
      // and occupied its place in time; only its value is untrustworthy.
      const streamSeconds = minute * SECONDS_PER_MINUTE + slot * SAMPLE_INTERVAL_S;
      slot++;
      if (
        temperatureC <= MIN_TEMP_C ||
        temperatureC >= MAX_TEMP_C ||
        pressureCounts > MAX_PRESSURE_COUNTS
      ) {
        implausible++;
      } else {
        samples.push({
          streamSeconds,
          temperatureC: Number(temperatureC.toFixed(2)),
          pressureCounts,
        });
      }
      p += SAMPLE_LEN;
    } else if (b === AUX_MARKER && p + AUX_LEN <= data.length) {
      const rawBattery = data[p + 1];
      const batteryV = rawBattery * BATTERY_SCALE;
      aux.push({
        streamSeconds: minute * SECONDS_PER_MINUTE,
        batteryV:
          batteryV > MIN_BATTERY_V && batteryV < MAX_BATTERY_V
            ? Number(batteryV.toFixed(2))
            : null,
        lightRaw: data[p + 2],
        raw: Array.from(data.slice(p + 3, p + AUX_LEN)),
      });
      minute++;
      slot = 0;
      p += AUX_LEN;
    } else {
      if (b === 0) padBytes++;
      else resyncBytes++;
      p++;
    }
  }

  return { samples, aux, resyncBytes, padBytes, implausible, reason: null };
}

export interface PressureCalibration {
  /** dBar = slope * counts + intercept. */
  slope: number;
  intercept: number;
  residualSdDbar: number;
  n: number;
}

/**
 * Recover the per-tag counts-to-dBar conversion from co-timed calibrated
 * pressures — in practice, activity-log records aligned to the same instants.
 *
 * One trimming pass: fit, drop pairs beyond three standard deviations, refit.
 * Both sides of each pair are field measurements on a moving animal sampled on
 * different grids, so residual scatter of several dBar is normal; what the
 * trim removes is the corrupt record that decoded to a plausible number.
 */
export function fitPressureCalibration(
  pairs: { counts: number; dBar: number }[]
): PressureCalibration | null {
  const fit = (ps: { counts: number; dBar: number }[]) => {
    const n = ps.length;
    const mx = ps.reduce((s, p) => s + p.counts, 0) / n;
    const my = ps.reduce((s, p) => s + p.dBar, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of ps) {
      num += (p.counts - mx) * (p.dBar - my);
      den += (p.counts - mx) ** 2;
    }
    if (den === 0) return null;
    const slope = num / den;
    const intercept = my - slope * mx;
    const res = ps.map((p) => p.dBar - (slope * p.counts + intercept));
    const sd = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / n);
    return { slope, intercept, sd, res };
  };

  if (pairs.length < 20) return null;
  const first = fit(pairs);
  if (!first) return null;
  const kept = pairs.filter((_, i) => Math.abs(first.res[i]) <= 3 * first.sd);
  const second = kept.length >= 20 ? fit(kept) : first;
  if (!second) return null;
  const used = kept.length >= 20 ? kept : pairs;
  return {
    slope: Number(second.slope.toFixed(4)),
    intercept: Number(second.intercept.toFixed(2)),
    residualSdDbar: Number(second.sd.toFixed(2)),
    n: used.length,
  };
}

/** Apply a fitted calibration to one sample. */
export function pressureDbar(
  sample: LotekBasicSample,
  cal: PressureCalibration
): number {
  return Number((cal.slope * sample.pressureCounts + cal.intercept).toFixed(1));
}
