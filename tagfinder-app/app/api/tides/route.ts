import { NextRequest, NextResponse } from 'next/server';
import { parseTimestamp } from '@/lib/timestamp';

const UA = 'TurtleTag/1.0 (turtleops.org)';

/**
 * Tide lookup: NOAA Tides & Currents.
 * Finds nearest station and returns current tide stage + next high/low.
 * US-only; returns null cleanly outside coverage.
 * GET /api/tides?lat=29.126&lon=-90.153
 */
export async function GET(request: NextRequest) {
  const lat = parseFloat(request.nextUrl.searchParams.get('lat') || '');
  const lon = parseFloat(request.nextUrl.searchParams.get('lon') || '');

  if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return NextResponse.json({ error: 'Invalid lat/lon' }, { status: 400 });
  }

  try {
    // Get all stations with predictions
    const stationsRes = await fetch(
      'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions',
      {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': UA },
      }
    );
    if (!stationsRes.ok) {
      return NextResponse.json({ available: false, reason: 'stations_unavailable' }, { status: 200 });
    }

    const stations = await stationsRes.json();
    const stationList = stations?.stations || [];

    // Find nearest station
    let nearest: { id: string; name: string; dist: number } | null = null;
    for (const s of stationList) {
      const d = haversineKm(lat, lon, s.lat, s.lng);
      if (!nearest || d < nearest.dist) {
        nearest = { id: s.id, name: s.name, dist: d };
      }
    }

    // If nearest station is > 100km away, tides aren't relevant
    const n: { id: string; name: string; dist: number } | null = nearest;
    if (!n || n.dist > 100) {
      return NextResponse.json(
        { available: false, reason: 'no_nearby_station', nearestKm: n?.dist ?? null },
        { status: 200 }
      );
    }
    nearest = n;

    // Get today's + tomorrow's predictions
    const today = new Date();
    const tomorrow = new Date(today.getTime() + 48 * 60 * 60 * 1000);
    const fmt = (d: Date) =>
      `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;

    const predUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${fmt(today)}&end_date=${fmt(tomorrow)}&station=${nearest.id}&product=predictions&datum=MLLW&time_zone=gmt&interval=hilo&units=english&format=json`;
    const predRes = await fetch(predUrl, {
      signal: AbortSignal.timeout(5000),
      headers: { 'User-Agent': UA },
    });
    if (!predRes.ok) {
      return NextResponse.json({ available: false, reason: 'predictions_unavailable' }, { status: 200 });
    }

    const preds = await predRes.json();
    const rawEvents: { t: string; v: string; type: 'H' | 'L' }[] = preds?.predictions || [];

    // NOAA writes "2026-04-13 10:26" (space, no T). Parsed strictly rather than
    // handed to `new Date`, which accepts nonsense and returns 2000-01-01 for
    // it — see parseTimestamp. Each event is screened on its own so a single
    // malformed row costs that row, not the whole panel: anything thrown here
    // is caught below and downgrades the entire response to available:false.
    const now = Date.now();
    const events = rawEvents.flatMap((e) => {
      const timestamp = parseTimestamp(e.t).getTime();
      const height = parseFloat(e.v);
      if (!Number.isFinite(timestamp) || !Number.isFinite(height)) return [];
      return [{ timestamp, iso: new Date(timestamp).toISOString(), height, type: e.type }];
    });

    const upcoming = events
      .filter((e) => e.timestamp > now)
      .sort((a, b) => a.timestamp - b.timestamp);

    const nextHigh = upcoming.find((e) => e.type === 'H');
    const nextLow = upcoming.find((e) => e.type === 'L');

    // Find the most recent PAST event to determine current state
    const past = events
      .filter((e) => e.timestamp <= now)
      .sort((a, b) => b.timestamp - a.timestamp);
    const lastEvent = past[0];
    const nextEvent = upcoming[0];

    let current: 'rising' | 'falling' | 'high' | 'low' | 'unknown' = 'unknown';
    if (lastEvent && nextEvent) {
      // Tide is heading toward nextEvent — if next is H we're rising, if next is L we're falling
      current = nextEvent.type === 'H' ? 'rising' : 'falling';
    } else if (nextEvent) {
      // No past data but we have upcoming
      current = nextEvent.type === 'H' ? 'falling' : 'rising';
    }

    // Tidal range (difference between next high and next low)
    const tidalRange =
      nextHigh && nextLow ? Math.abs(nextHigh.height - nextLow.height) : null;

    return NextResponse.json(
      {
        available: true,
        current,
        nextHigh: nextHigh ? { time: nextHigh.iso, height: nextHigh.height } : null,
        nextLow: nextLow ? { time: nextLow.iso, height: nextLow.height } : null,
        lastEvent: lastEvent
          ? { time: lastEvent.iso, height: lastEvent.height, type: lastEvent.type }
          : null,
        tidalRange,
        station: nearest.name,
        stationId: nearest.id,
        stationDistanceKm: nearest.dist,
      },
      { headers: { 'Cache-Control': 'public, max-age=600, s-maxage=600' } }
    );
  } catch {
    return NextResponse.json({ available: false, reason: 'error' }, { status: 200 });
  }
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
