import { NextRequest, NextResponse } from 'next/server';

/**
 * Elevation lookup: USGS EPQS (US) with Open-Elevation as global fallback.
 * GET /api/elevation?lat=29.126&lon=-90.153
 */
export async function GET(request: NextRequest) {
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
