import { NextRequest, NextResponse } from 'next/server';
import { parseTimestamp } from '@/lib/timestamp';

/**
 * Tide highs and lows spanning an arbitrary date range.
 *
 * Distinct from /api/tides, which answers "what is the tide doing right now" for
 * the environment panel and only fetches today and tomorrow. This one answers
 * "what was the tide doing while the tag was transmitting", which needs history
 * covering the whole reception record — often a week or more back.
 *
 * GET /api/tide-extremes?lat=12.34&lon=-45.67&begin=20260101&end=20260107
 */

const UA = 'TurtleTag/1.0 (turtleops.org)';

/** Beyond this the nearest gauge is describing a different body of water. */
const MAX_STATION_DISTANCE_KM = 100;
/** NOAA rejects very long spans on the hilo product; a month is ample here. */
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
    const stationsRes = await fetch(
      'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions',
      { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': UA } }
    );
    if (!stationsRes.ok) {
      return NextResponse.json({ available: false, reason: 'stations_unavailable' });
    }

    const stations = await stationsRes.json();
    let nearest: { id: string; name: string; dist: number } | null = null;
    for (const s of stations?.stations ?? []) {
      const d = haversineKm(lat, lon, s.lat, s.lng);
      if (!nearest || d < nearest.dist) nearest = { id: s.id, name: s.name, dist: d };
    }
    // Aliased so the narrowing survives into the response body below.
    const n: { id: string; name: string; dist: number } | null = nearest;
    if (!n || n.dist > MAX_STATION_DISTANCE_KM) {
      return NextResponse.json({
        available: false,
        reason: 'no_nearby_station',
        nearestKm: n ? n.dist : null,
      });
    }
    nearest = n;

    const url =
      `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${begin}` +
      `&end_date=${end}&station=${nearest.id}&product=predictions&datum=MLLW` +
      `&time_zone=gmt&interval=hilo&units=metric&format=json`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) {
      return NextResponse.json({ available: false, reason: 'predictions_unavailable' });
    }

    const json = await res.json();
    const raw: { t: string; v: string; type: 'H' | 'L' }[] = json?.predictions ?? [];

    // NOAA returns "2026-08-08 15:28" — space separated, no zone marker, UTC
    // because we asked for time_zone=gmt.
    //
    // The obvious screen, isNaN(Date.parse(...)), does not work: Date.parse
    // accepts 'GARBAGE:00Z' and returns 2000-01-01, so garbage passed straight
    // through as a valid-looking extreme. These feed the tide-phase analysis,
    // where an extreme two decades out of range would silently corrupt every
    // phase assignment in the record. Parsed strictly instead.
    const extremes = raw.flatMap((e) => {
      const d = parseTimestamp(e.t);
      const height = parseFloat(e.v);
      if (isNaN(d.getTime()) || !Number.isFinite(height)) return [];
      return [{ time: d.toISOString(), type: e.type, height }];
    });

    return NextResponse.json(
      {
        available: extremes.length > 0,
        extremes,
        station: nearest.name,
        stationId: nearest.id,
        stationDistanceKm: nearest.dist,
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
