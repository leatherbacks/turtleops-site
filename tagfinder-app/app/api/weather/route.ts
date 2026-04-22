import { NextRequest, NextResponse } from 'next/server';

const UA = 'TurtleTag/1.0 (turtleops.org)';

/**
 * Weather lookup: NWS (US) with Open-Meteo as global fallback.
 * GET /api/weather?lat=29.126&lon=-90.153
 */
export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') || '');
  const lon = parseFloat(request.nextUrl.searchParams.get('lon') || '');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
  }

  // Try NWS (US only, free, requires User-Agent)
  try {
    const pointRes = await fetch(
      `https://api.weather.gov/points/${lat.toFixed(4)},${lon.toFixed(4)}`,
      {
        signal: AbortSignal.timeout(5000),
        headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
      }
    );
    if (pointRes.ok) {
      const point = await pointRes.json();
      const stationsUrl = point?.properties?.observationStations;
      if (stationsUrl) {
        const stationsRes = await fetch(stationsUrl, {
          signal: AbortSignal.timeout(5000),
          headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
        });
        if (stationsRes.ok) {
          const stations = await stationsRes.json();
          const stationId = stations?.features?.[0]?.properties?.stationIdentifier;
          if (stationId) {
            const obsRes = await fetch(
              `https://api.weather.gov/stations/${stationId}/observations/latest`,
              {
                signal: AbortSignal.timeout(5000),
                headers: { 'User-Agent': UA, Accept: 'application/geo+json' },
              }
            );
            if (obsRes.ok) {
              const obs = await obsRes.json();
              const p = obs?.properties || {};
              return NextResponse.json(
                {
                  temperature: p.temperature?.value ?? null,
                  windSpeed: p.windSpeed?.value ?? null,
                  windDirection: degToCompass(p.windDirection?.value),
                  windDirectionDeg: p.windDirection?.value ?? null,
                  conditions: p.textDescription || '',
                  source: 'nws',
                  stationId,
                },
                {
                  headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' },
                }
              );
            }
          }
        }
      }
    }
  } catch {
    // Fall through to Open-Meteo
  }

  // Fallback: Open-Meteo (global, free, no key)
  try {
    const omUrl = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m,weather_code`;
    const res = await fetch(omUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': UA },
    });
    if (res.ok) {
      const data = await res.json();
      const c = data?.current || {};
      return NextResponse.json(
        {
          temperature: c.temperature_2m ?? null,
          windSpeed: c.wind_speed_10m ?? null,
          windDirection: degToCompass(c.wind_direction_10m),
          windDirectionDeg: c.wind_direction_10m ?? null,
          conditions: weatherCodeToText(c.weather_code),
          source: 'open-meteo',
        },
        {
          headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' },
        }
      );
    }
  } catch {
    // Both failed
  }

  return NextResponse.json({ error: 'Weather lookup failed' }, { status: 502 });
}

function degToCompass(deg: number | null): string {
  if (deg === null || deg === undefined) return '';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

function weatherCodeToText(code: number | null): string {
  if (code === null || code === undefined) return '';
  // WMO weather code mapping (abbreviated)
  if (code === 0) return 'Clear';
  if (code <= 3) return 'Partly cloudy';
  if (code <= 48) return 'Foggy';
  if (code <= 57) return 'Drizzle';
  if (code <= 67) return 'Rain';
  if (code <= 77) return 'Snow';
  if (code <= 82) return 'Rain showers';
  if (code <= 86) return 'Snow showers';
  if (code <= 99) return 'Thunderstorm';
  return '';
}
