import { NextRequest, NextResponse } from 'next/server';

/**
 * 7-day weather + marine forecast from Open-Meteo.
 * Returns daily max wind, peak wave height, and a storm-alert flag
 * when conditions will likely wash the tag off the beach into open water.
 *
 * GET /api/forecast?lat=29.126&lon=-90.153
 */
export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') || '');
  const lon = parseFloat(request.nextUrl.searchParams.get('lon') || '');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
  }

  try {
    const weatherUrl =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,` +
      `wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant` +
      `&wind_speed_unit=kn&forecast_days=7&timezone=UTC`;

    const marineUrl =
      `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}` +
      `&daily=wave_height_max,wave_direction_dominant,wave_period_max` +
      `&forecast_days=7&timezone=UTC`;

    const [wxRes, marineRes] = await Promise.all([
      fetch(weatherUrl, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
      }),
      fetch(marineUrl, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
      }).catch(() => null),
    ]);

    if (!wxRes.ok) {
      return NextResponse.json({ error: 'Forecast lookup failed' }, { status: 502 });
    }

    const wx = await wxRes.json();
    const marine =
      marineRes && marineRes.ok ? await marineRes.json().catch(() => null) : null;

    const days = (wx.daily?.time ?? []) as string[];
    const forecast = days.map((date: string, i: number) => ({
      date,
      tempMaxC: wx.daily.temperature_2m_max?.[i] ?? null,
      tempMinC: wx.daily.temperature_2m_min?.[i] ?? null,
      precipitationMm: wx.daily.precipitation_sum?.[i] ?? null,
      windMaxKn: wx.daily.wind_speed_10m_max?.[i] ?? null,
      windGustKn: wx.daily.wind_gusts_10m_max?.[i] ?? null,
      windDirectionDeg: wx.daily.wind_direction_10m_dominant?.[i] ?? null,
      waveMaxM:
        marine?.daily?.wave_height_max?.[i] !== undefined
          ? marine.daily.wave_height_max[i]
          : null,
      wavePeriodS: marine?.daily?.wave_period_max?.[i] ?? null,
      waveDirectionDeg: marine?.daily?.wave_direction_dominant?.[i] ?? null,
      weatherCode: wx.daily.weather_code?.[i] ?? null,
    }));

    // Storm alert: within 72 hours, wind gust > 25 knots OR wave height > 2 m
    let stormAlert = false;
    let alertReason: string | null = null;
    const WIND_THRESHOLD = 25; // knots
    const WAVE_THRESHOLD = 2; // meters

    const horizon = forecast.slice(0, 3); // next 3 days
    const worstWind = horizon.reduce<{ day: string; kn: number } | null>(
      (acc, d) =>
        d.windGustKn !== null && (!acc || d.windGustKn > acc.kn)
          ? { day: d.date, kn: d.windGustKn }
          : acc,
      null
    );
    const worstWave = horizon.reduce<{ day: string; m: number } | null>(
      (acc, d) =>
        d.waveMaxM !== null && (!acc || d.waveMaxM > acc.m)
          ? { day: d.date, m: d.waveMaxM }
          : acc,
      null
    );

    if (worstWind && worstWind.kn > WIND_THRESHOLD) {
      stormAlert = true;
      alertReason = `Wind gusts forecast to reach ${worstWind.kn.toFixed(0)} knots on ${worstWind.day}`;
    }
    if (worstWave && worstWave.m > WAVE_THRESHOLD) {
      stormAlert = true;
      const waveReason = `wave heights up to ${worstWave.m.toFixed(1)} m on ${worstWave.day}`;
      alertReason = alertReason ? `${alertReason}; ${waveReason}` : waveReason;
    }

    return NextResponse.json(
      {
        source: 'open-meteo',
        forecast,
        stormAlert,
        alertReason,
        peakWindKn: worstWind?.kn ?? null,
        peakWaveM: worstWave?.m ?? null,
        marineAvailable: marine !== null,
      },
      { headers: { 'Cache-Control': 'public, max-age=1800, s-maxage=1800' } }
    );
  } catch {
    return NextResponse.json({ error: 'Forecast lookup failed' }, { status: 502 });
  }
}
