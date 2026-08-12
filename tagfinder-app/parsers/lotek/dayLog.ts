import type { DailyDiveSummary, SSTReading } from '@/lib/types';
import { resolveDateOrder, parseLotekDate, type DateOrder } from './dates';

/**
 * Lotek PSAT "Day Log" — one row per UTC day of firmware-computed summaries.
 *
 * Columns: TimeS, MaxPress, MinExtTemp, MinPress, SST2, SST2Depth, SST2Time,
 * Sunrise, Sunset, TFLatErrN/S, TFLatN/S, TFLonErrN/S, TFLonN/S, TFNoonN/S,
 * TRLat, TRLon
 *
 * Field notes established from the the reference deployment deployment:
 *
 * - Pressures are metres (see diveLog.ts).
 * - SST2 is the temperature at the day's shallowest sample, SST2Depth the depth
 *   it was taken at (it tracks MinPress closely), and SST2Time the minute of
 *   the day, UTC, at which it was recorded.
 * - Sunrise/Sunset/TFNoon are UTC. Predicting solar noon from TFLon
 *   (12:00 - lon x 4 min) reproduces TFNoon to within 4-5 minutes across every
 *   day of the deployment, which is the equation of time for July — so the
 *   longitude channel is internally consistent and physically correct.
 * - TF* are Lotek's onboard template-fit geolocation, carrying separate North
 *   and South solutions for the latitude ambiguity. TR* are the classic
 *   threshold-method estimates. Across the reference deployment, TFLatN has a standard deviation
 *   of 0.76 deg against TRLat's 22.3 deg — TR includes wild values such as
 *   latitude -70.5 — so TR is not usable as a track without heavy filtering.
 *
 * Sentinels are per-field, not global: 100 means "no value" in TFLat but is a
 * perfectly ordinary MaxPress.
 *
 * The two error channels are also asymmetric. When the tag has no geolocation
 * (days 1-2 here, before it has a full light curve) TFLon/TFLonErr use explicit
 * sentinels, but TFLatErr reports 33.52 deg — "unbounded" written as an ordinary
 * number rather than flagged. So always gate on the position being non-null;
 * never treat a finite TFLatErr as evidence that a latitude exists.
 */

const SENTINELS: Record<string, number> = {
  MaxPress: 10000,
  MinPress: 10000,
  MinExtTemp: 10000,
  SST2: -20,
  SST2Time: 10000,
  TFLatErrN: 1000000,
  TFLatErrS: 1000000,
  TFLonErrN: 1000000,
  TFLonErrS: 1000000,
  TFLatN: 100,
  TFLatS: 100,
  TFLonN: -179,
  TFLonS: -179,
};

/** Numeric field honouring that field's own no-data sentinel. */
function num(row: Record<string, string>, key: string): number | null {
  const raw = row[key];
  if (raw === undefined || raw === null || raw.trim() === '') return null;
  const v = parseFloat(raw);
  if (!Number.isFinite(v)) return null;
  if (SENTINELS[key] !== undefined && v === SENTINELS[key]) return null;
  return v;
}

/** One day of light-based geolocation, as computed on the tag. */
export interface LotekDailyPosition {
  date: Date;
  /** Template-fit solutions. Latitude is ambiguous; both are reported. */
  latNorth: number | null;
  latSouth: number | null;
  lonNorth: number | null;
  lonSouth: number | null;
  latErrNorth: number | null;
  latErrSouth: number | null;
  lonErrNorth: number | null;
  lonErrSouth: number | null;
  /** Threshold-method estimate — retained for reference, far noisier than TF. */
  thresholdLat: number | null;
  thresholdLon: number | null;
}

export interface LotekDayLogResult {
  dailyDives: DailyDiveSummary[];
  sst: SSTReading[];
  positions: LotekDailyPosition[];
  dateOrder: DateOrder | null;
  dateNote: string;
}

export function parseLotekDayLog(rows: Record<string, string>[]): LotekDayLogResult {
  const { order, reason } = resolveDateOrder(rows.map((r) => r['TimeS'] || ''));
  if (!order) {
    return { dailyDives: [], sst: [], positions: [], dateOrder: null, dateNote: reason };
  }

  const dailyDives: DailyDiveSummary[] = [];
  const sst: SSTReading[] = [];
  const positions: LotekDailyPosition[] = [];

  for (const row of rows) {
    const date = parseLotekDate(row['TimeS'] || '', order);
    if (!date) continue;

    const minDepth = num(row, 'MinPress');
    const maxDepth = num(row, 'MaxPress');
    if (minDepth !== null && maxDepth !== null) {
      dailyDives.push({
        date,
        minDepth,
        maxDepth,
        // Lotek reports no per-day accuracy figures; 0 is the same "unknown"
        // convention the Wildlife Computers MinMaxDepth parser uses.
        minAccuracy: 0,
        maxAccuracy: 0,
      });
    }

    const sstTemp = num(row, 'SST2');
    const sstDepth = num(row, 'SST2Depth');
    const sstMinute = num(row, 'SST2Time');
    if (sstTemp !== null) {
      // SST2Time is minutes since midnight UTC on the same day.
      const at = new Date(date.getTime());
      if (sstMinute !== null && sstMinute >= 0 && sstMinute < 1440) {
        at.setUTCMinutes(Math.round(sstMinute));
      }
      sst.push({
        date: at,
        depth: sstDepth ?? 0,
        temperature: sstTemp,
        source: 'lotek-sst2',
      });
    }

    positions.push({
      date,
      latNorth: num(row, 'TFLatN'),
      latSouth: num(row, 'TFLatS'),
      lonNorth: num(row, 'TFLonN'),
      lonSouth: num(row, 'TFLonS'),
      latErrNorth: num(row, 'TFLatErrN'),
      latErrSouth: num(row, 'TFLatErrS'),
      lonErrNorth: num(row, 'TFLonErrN'),
      lonErrSouth: num(row, 'TFLonErrS'),
      thresholdLat: num(row, 'TRLat'),
      thresholdLon: num(row, 'TRLon'),
    });
  }

  const byDate = (a: { date: Date }, b: { date: Date }) => a.date.getTime() - b.date.getTime();
  dailyDives.sort(byDate);
  sst.sort(byDate);
  positions.sort(byDate);

  return { dailyDives, sst, positions, dateOrder: order, dateNote: reason };
}
