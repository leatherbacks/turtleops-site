import { NextRequest, NextResponse } from 'next/server';

/**
 * Bathymetry lookup via OpenTopoData GEBCO dataset (global seabed depth).
 * Returns seabed depth in meters (positive = depth below sea level).
 * GET /api/bathymetry?lat=29.126&lon=-90.153
 */
export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') || '');
  const lon = parseFloat(request.nextUrl.searchParams.get('lon') || '');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
  }

  try {
    // GEBCO 2020: 15 arc-second global bathymetry grid
    const url = `https://api.opentopodata.org/v1/gebco2020?locations=${lat},${lon}`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
    });
    if (res.ok) {
      const data = await res.json();
      const elev = data?.results?.[0]?.elevation;
      if (typeof elev === 'number') {
        // GEBCO returns elevation (positive=above sea, negative=below).
        // Convert to "seabed depth" — positive meters below sea level, or null if on land.
        const seabedDepthM = elev < 0 ? -elev : null;
        return NextResponse.json(
          { seabedDepthM, rawElevationM: elev, source: 'gebco' },
          { headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' } }
        );
      }
    }
  } catch {
    // Fall through
  }

  return NextResponse.json({ error: 'Bathymetry lookup failed' }, { status: 502 });
}
