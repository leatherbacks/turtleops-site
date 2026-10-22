import { NextRequest, NextResponse } from 'next/server';
import { haversineKm } from '@/lib/haversine';

/**
 * Measured air temperature as a time series, from the nearest weather station.
 *
 * The weather endpoint answers "what is the air doing now", and the
 * temperature panel compared a reading from the day before against it: on
 * 33938, a 25.0 °C dawn reading after a cold front was set against 27.0 °C
 * of afternoon air instead of the 22.8 °C measured at that hour. See
 * analysis/airMatch.ts.
 *
 * Station observations, not a model. Open-Meteo's cell over the barrier
 * island at Melbourne Beach gave 25.9 °C for that dawn: it averages land with
 * sea and smooths away the very day–night swing being compared against.
 *
 * US only: NWS names the nearest stations, and the Iowa Environmental Mesonet
 * keeps their full METAR history (NWS's own API holds about a week).
 *
 * GET /api/air-temp?lat=28.03&lon=-80.54&begin=20261014&end=20261020
 */

const UA = 'TurtleTag/1.0 (turtleops.org)';
/**
 * Air differs less from place to place than water does, but an airport
 * inland swings more by day and night than a barrier island. Kept close, and
 * the distance is returned so the reading can be weighed.
 */
const MAX_STATION_DISTANCE_KM = 40;
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
  if (spanDays(begin, end) > MAX_SPAN_DAYS || spanDays(begin, end) < 0) {
    return NextResponse.json({ error: `Span must be 0–${MAX_SPAN_DAYS} days` }, { status: 400 });
  }

  try {
    const headers = { 'User-Agent': UA, Accept: 'application/geo+json' };
    const point = await fetch(`https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`, {
      signal: AbortSignal.timeout(6000),
      headers,
    });
    if (!point.ok) return NextResponse.json({ available: false, reason: 'outside_us' });
    const stationsUrl = (await point.json())?.properties?.observationStations;
    if (!stationsUrl) return NextResponse.json({ available: false, reason: 'no_station' });
    const stationsRes = await fetch(stationsUrl, { signal: AbortSignal.timeout(6000), headers });
    if (!stationsRes.ok) return NextResponse.json({ available: false, reason: 'no_station' });

    let nearest: { id: string; name: string; dist: number } | null = null;
    for (const f of (await stationsRes.json())?.features ?? []) {
      const id = f?.properties?.stationIdentifier;
      const [slon, slat] = f?.geometry?.coordinates ?? [];
      // Four-letter ICAO ids are the METAR stations the Mesonet archives.
      if (typeof id !== 'string' || !/^[A-Z]{4}$/.test(id) || typeof slat !== 'number') continue;
      const d = haversineKm(lat, lon, slat, slon);
      if (!nearest || d < nearest.dist) nearest = { id, name: f.properties.name ?? id, dist: d };
    }
    const n: { id: string; name: string; dist: number } | null = nearest;
    if (!n || n.dist > MAX_STATION_DISTANCE_KM) {
      return NextResponse.json({
        available: false,
        reason: 'no_nearby_station',
        nearestKm: n ? Number(n.dist.toFixed(1)) : null,
      });
    }

    const [y1, m1, d1] = [begin.slice(0, 4), +begin.slice(4, 6), +begin.slice(6, 8)];
    const [y2, m2, d2] = [end.slice(0, 4), +end.slice(4, 6), +end.slice(6, 8)];
    const url =
      `https://mesonet.agron.iastate.edu/cgi-bin/request/asos.py?station=${n.id}&data=tmpc` +
      `&year1=${y1}&month1=${m1}&day1=${d1}&year2=${y2}&month2=${m2}&day2=${d2}` +
      `&tz=Etc/UTC&format=onlycomma&missing=M&report_type=3`;
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000), headers: { 'User-Agent': UA } });
    if (!res.ok) return NextResponse.json({ available: false, reason: 'series_unavailable' });

    // "MLB,2026-10-19 10:53,22.78" — UTC, routine hourly reports only.
    const samples = (await res.text())
      .trim()
      .split('\n')
      .slice(1)
      .flatMap((line) => {
        const [, valid, tmpc] = line.split(',');
        const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(valid ?? '');
        const v = parseFloat(tmpc);
        if (!m || !Number.isFinite(v)) return [];
        const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
        return [{ time: new Date(t).toISOString(), temperatureC: v }];
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
  const d = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
  return (d(end) - d(begin)) / 86_400_000;
}
