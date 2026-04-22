import { NextRequest, NextResponse } from 'next/server';

/**
 * Reverse geocoding: Census Geocoder (US) with Nominatim as global fallback.
 * GET /api/geocode?lat=29.126&lon=-90.153
 */
export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') || '');
  const lon = parseFloat(request.nextUrl.searchParams.get('lon') || '');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
  }

  // Try Census Geocoder (US only, free, no key)
  try {
    const censusUrl = `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}&benchmark=Public_AR_Current&vintage=Current_Current&layers=Counties,States&format=json`;
    const res = await fetch(censusUrl, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
    });
    if (res.ok) {
      const data = await res.json();
      const geogs = data?.result?.geographies;
      const counties = geogs?.['Counties'];
      const states = geogs?.['States'];
      if (counties && counties.length > 0) {
        const county = counties[0].NAME;
        const stateName = states?.[0]?.NAME || '';
        const stateAbbr = states?.[0]?.STUSAB || '';
        return NextResponse.json(
          {
            name: `${county}, ${stateAbbr || stateName}`,
            county,
            state: stateAbbr || stateName,
            source: 'census',
          },
          {
            headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
          }
        );
      }
    }
  } catch {
    // Fall through to Nominatim
  }

  // Fallback: Nominatim (global, free, requires User-Agent)
  try {
    const nomUrl = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=10`;
    const res = await fetch(nomUrl, {
      signal: AbortSignal.timeout(6000),
      headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
    });
    if (res.ok) {
      const data = await res.json();
      const addr = data?.address || {};
      const county = addr.county || addr.municipality || '';
      const state = addr.state || '';
      const country = addr.country_code?.toUpperCase() || '';
      const name = [county, state, country].filter(Boolean).join(', ') || data?.display_name || 'Unknown';
      return NextResponse.json(
        {
          name,
          county,
          state,
          source: 'nominatim',
        },
        {
          headers: { 'Cache-Control': 'public, max-age=3600, s-maxage=3600' },
        }
      );
    }
  } catch {
    // Both failed
  }

  return NextResponse.json({ error: 'Geocoding failed' }, { status: 502 });
}
