import { NextRequest, NextResponse } from 'next/server';
import { parseTimestamp } from '@/lib/timestamp';

/**
 * Water temperature as a time series over the reception record.
 *
 * The environment endpoints answer "what is the water doing now", which is the
 * wrong question for a tag that has been transmitting for a week. Over six days
 * on one deployment the bay warmed 30.1 -> 32.0 C, comparable to the difference
 * being looked for, so a single current reading either hides a tag that left the
 * water or invents a departure for one that did not. See analysis/waterMatch.ts.
 *
 * GET /api/water-temp?lat=25.9&lon=-80.13&begin=20260807&end=20260813
 */

const UA = 'TurtleTag/1.0 (turtleops.org)';

/**
 * Water temperature is far more local than tide phase — a gauge inside a bay
 * and one out on the shelf can differ by several degrees on the same afternoon,
 * which is the whole signal here. Held much tighter than the 100 km used for
 * tides, and the distance is returned so callers can discount a far one.
 */
const MAX_STATION_DISTANCE_KM = 60;
/** NOAA rejects very long spans; a month covers any realistic record. */
const MAX_SPAN_DAYS = 31;

const DATE_RE = /^\d{8}$/;

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const lat = parseFloat(q.get('lat') || '');
  const lon = parseFloat(q.get('lon') || '');
  const begin = q.get('begin') || '';
  const end = q.get('end') || '';

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
  }
  if (!DATE_RE.test(begin) || !DATE_RE.test(end)) {
    return NextResponse.json({ error: 'begin/end must be YYYYMMDD' }, { status: 400 });
  }
  if (spanDays(begin, end) > MAX_SPAN_DAYS) {
    return NextResponse.json({ error: `Span exceeds ${MAX_SPAN_DAYS} days` }, { status: 400 });
  }

  try {
    // Only stations that actually report water temperature. The tide-prediction
    // list is much larger and mostly cannot answer this, so asking it would
    // return a nearby station that yields nothing.
    const stationsRes = await fetch(
      'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=watertemp',
      { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } }
    );
    if (!stationsRes.ok) {
      return NextResponse.json({ available: false, reason: 'stations_unavailable' });
    }

    const stations = await stationsRes.json();
    let nearest: { id: string; name: string; dist: number } | null = null;
    for (const s of stations?.stations ?? []) {
      if (typeof s?.lat !== 'number' || typeof s?.lng !== 'number') continue;
      const d = haversineKm(lat, lon, s.lat, s.lng);
      if (!nearest || d < nearest.dist) nearest = { id: s.id, name: s.name, dist: d };
    }
    const n: { id: string; name: string; dist: number } | null = nearest;
    if (!n || n.dist > MAX_STATION_DISTANCE_KM) {
      return NextResponse.json({
        available: false,
        reason: 'no_nearby_station',
        nearestKm: n ? Number(n.dist.toFixed(1)) : null,
      });
    }

    const url =
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${begin}` +
      `&end_date=${end}&station=${n.id}&product=water_temperature` +
      `&time_zone=gmt&units=metric&format=json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) {
      return NextResponse.json({ available: false, reason: 'series_unavailable' });
    }

    const json = await res.json();
    const raw: { t: string; v: string }[] = json?.data ?? [];

    // NOAA writes "2026-08-08 15:28" and uses '-' for a missing sample. Parsed
    // strictly: Date.parse would accept malformed input and return the year
    // 2000, which here would silently anchor the series two decades early.
    const samples = raw.flatMap((e) => {
      const d = parseTimestamp(e.t);
      const v = parseFloat(e.v);
      if (isNaN(d.getTime()) || !Number.isFinite(v)) return [];
      return [{ time: d.toISOString(), temperatureC: v }];
    });

    return NextResponse.json(
      {
        available: samples.length > 0,
        samples,
        station: n.name,
        stationId: n.id,
        stationDistanceKm: Number(n.dist.toFixed(1)),
      },
      { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
    );
  } catch {
    return NextResponse.json({ available: false, reason: 'error' });
  }
}

function spanDays(begin: string, end: string): number {
  const d = (s: string) =>
    Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  return (d(end) - d(begin)) / 86_400_000;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
