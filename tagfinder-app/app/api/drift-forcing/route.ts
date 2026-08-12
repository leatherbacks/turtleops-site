import { NextRequest, NextResponse } from 'next/server';

/**
 * Hourly wind and ocean current at a position, spanning recent history and the
 * near forecast.
 *
 * Used to sanity-check a drift vector rather than to build one. The vector the
 * app extrapolates is measured from the tag's own positions, so it already
 * contains whatever wind and current acted while the tag was moving — adding a
 * modelled leeway term on top would double-count. What these fields are for is
 * asking two questions the track alone cannot answer: does the modelled current
 * agree with the direction the tag actually went, and has the wind changed
 * since the window the vector was fitted over?
 *
 * History is needed because the fitting window is usually in the past — often
 * days back, by the time anyone runs a recovery analysis.
 *
 * GET /api/drift-forcing?lat=12.34&lon=-45.67
 */

/** Enough history to cover a fitting window from a tag that went quiet a week ago. */
const PAST_DAYS = 7;
const FORECAST_DAYS = 3;

export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') || '');
  const lon = parseFloat(request.nextUrl.searchParams.get('lon') || '');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
  }

  const windUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&hourly=wind_speed_10m,wind_direction_10m` +
    `&wind_speed_unit=ms&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=UTC`;

  const currentUrl =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
    `&hourly=ocean_current_velocity,ocean_current_direction` +
    `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=UTC`;

  try {
    const [windRes, curRes] = await Promise.all([
      fetch(windUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
      }),
      fetch(currentUrl, {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
      }).catch(() => null),
    ]);

    if (!windRes.ok) {
      return NextResponse.json({ error: 'Wind lookup failed' }, { status: 502 });
    }

    const wind = await windRes.json();
    const times: string[] = wind?.hourly?.time ?? [];
    const windSpeed: (number | null)[] = wind?.hourly?.wind_speed_10m ?? [];
    const windDir: (number | null)[] = wind?.hourly?.wind_direction_10m ?? [];

    // Marine coverage is patchy inland and on small islands; treat as optional.
    let curSpeed: (number | null)[] = [];
    let curDir: (number | null)[] = [];
    let curTimes: string[] = [];
    if (curRes && curRes.ok) {
      const cur = await curRes.json();
      curTimes = cur?.hourly?.time ?? [];
      curSpeed = cur?.hourly?.ocean_current_velocity ?? [];
      curDir = cur?.hourly?.ocean_current_direction ?? [];
    }
    const curIndex = new Map(curTimes.map((t, i) => [t, i]));

    const hourly = times.map((t, i) => {
      const ci = curIndex.get(t);
      return {
        time: `${t}Z`,
        // Meteorological convention: the direction the wind blows FROM.
        windSpeedMs: typeof windSpeed[i] === 'number' ? windSpeed[i] : null,
        windFromDeg: typeof windDir[i] === 'number' ? windDir[i] : null,
        // Oceanographic convention: the direction the current flows TOWARD.
        currentKmH: ci !== undefined && typeof curSpeed[ci] === 'number' ? curSpeed[ci] : null,
        currentTowardDeg:
          ci !== undefined && typeof curDir[ci] === 'number' ? curDir[ci] : null,
      };
    });

    return NextResponse.json(
      { hourly, source: 'open-meteo' },
      { headers: { 'Cache-Control': 'public, max-age=1800, s-maxage=1800' } }
    );
  } catch {
    return NextResponse.json({ error: 'Drift forcing lookup failed' }, { status: 502 });
  }
}
