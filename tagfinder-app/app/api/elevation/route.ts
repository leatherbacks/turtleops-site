import { NextRequest, NextResponse } from 'next/server';

/** Batch cap — also bounds the work a single rate-limited request can cause. */
const MAX_BATCH_POINTS = 64;

/**
 * Elevation lookup: USGS EPQS (US) with Open-Elevation as global fallback.
 *
 *   GET /api/elevation?lat=29.126&lon=-90.153
 *   GET /api/elevation?points=12.34,-45.67|12.35,-45.68|...
 *
 * The batch form exists so a drift-landfall walk costs one request rather than
 * one per probe — these routes are rate limited to 60/IP/day, and sampling a
 * path point-by-point would exhaust a user's budget in a single analysis.
 * Only Open-Elevation is used for batches; USGS EPQS is single-point.
 */
export async function GET(request: NextRequest) {
  const pointsParam = request.nextUrl.searchParams.get('points');
  if (pointsParam) return handleBatch(pointsParam);

  const lat = parseFloat(request.nextUrl.searchParams.get('lat') || '');
  const lon = parseFloat(request.nextUrl.searchParams.get('lon') || '');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
  }

  // Try USGS EPQS first (US coverage, best precision)
  try {
    const usgsUrl = `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&units=Meters&wkid=4326&includeDate=false`;
    const res = await fetch(usgsUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
    });
    if (res.ok) {
      const data = await res.json();
      const elev = parseFloat(data?.value);
      if (!isNaN(elev) && elev > -9999) {
        return NextResponse.json(
          { meters: elev, source: 'usgs' },
          {
            headers: { 'Cache-Control': 'public, max-age=900, s-maxage=900' },
          }
        );
      }
    }
  } catch {
    // Fall through to Open-Elevation
  }

  // Fallback: Open-Elevation (global, free, no key)
  try {
    const oeUrl = `https://api.open-elevation.com/api/v1/lookup?locations=${lat},${lon}`;
    const res = await fetch(oeUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
    });
    if (res.ok) {
      const data = await res.json();
      const elev = data?.results?.[0]?.elevation;
      if (typeof elev === 'number') {
        return NextResponse.json(
          { meters: elev, source: 'open-elevation' },
          {
            headers: { 'Cache-Control': 'public, max-age=900, s-maxage=900' },
          }
        );
      }
    }
  } catch {
    // Both failed
  }

  return NextResponse.json({ error: 'Elevation lookup failed' }, { status: 502 });
}

/** "lat,lon|lat,lon|..." -> elevations in the same order. */
async function handleBatch(raw: string) {
  const points: { lat: number; lon: number }[] = [];
  for (const pair of raw.split('|')) {
    const [latStr, lonStr] = pair.split(',');
    const lat = parseFloat(latStr);
    const lon = parseFloat(lonStr);
    if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      return NextResponse.json({ error: `Invalid point: ${pair}` }, { status: 400 });
    }
    points.push({ lat, lon });
  }

  if (points.length === 0) {
    return NextResponse.json({ error: 'No points supplied' }, { status: 400 });
  }
  if (points.length > MAX_BATCH_POINTS) {
    return NextResponse.json(
      { error: `Too many points (max ${MAX_BATCH_POINTS})` },
      { status: 400 }
    );
  }

  try {
    const locations = points.map((p) => `${p.lat},${p.lon}`).join('|');
    const res = await fetch(
      `https://api.open-elevation.com/api/v1/lookup?locations=${locations}`,
      {
        signal: AbortSignal.timeout(12000),
        headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
      }
    );
    if (res.ok) {
      const data = await res.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      if (results.length === points.length) {
        return NextResponse.json(
          {
            points: points.map((p, i) => ({
              lat: p.lat,
              lon: p.lon,
              meters: typeof results[i]?.elevation === 'number' ? results[i].elevation : null,
            })),
            source: 'open-elevation',
          },
          { headers: { 'Cache-Control': 'public, max-age=900, s-maxage=900' } }
        );
      }
    }
  } catch {
    // fall through
  }

  return NextResponse.json({ error: 'Elevation lookup failed' }, { status: 502 });
}
