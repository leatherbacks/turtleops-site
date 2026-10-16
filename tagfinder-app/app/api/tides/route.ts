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
    const ranked = (stationList as { id: string; name: string; lat: number; lng: number }[])
      .map((s) => ({ id: s.id, name: s.name, dist: haversineKm(lat, lon, s.lat, s.lng) }))
      .sort((a, b) => a.dist - b.dist);
    const nearest = ranked[0];
    if (!nearest || nearest.dist > 100) {
      return NextResponse.json(
        { available: false, reason: 'no_nearby_station', nearestKm: nearest?.dist ?? null },
        { status: 200 }
      );
    }

    const primary = await tideAt(nearest);
    if (!primary) {
      return NextResponse.json({ available: false, reason: 'predictions_unavailable' }, { status: 200 });
    }

    // A barrier island has two tides: the open coast on one side, a sound or
    // lagoon of a few inches on the other. Nearest-station picked the Pamlico
    // Sound (0.3 ft) for an oceanfront campground at Waves, NC, and the Indian
    // River Lagoon (0.2 ft) for a tag 600 m from the Atlantic at Melbourne
    // Beach. Which side a tag is on is not something the tide route can know,
    // so when the stations around it belong to different regimes, both are
    // returned and labelled, and the reader uses the one for the shore they
    // search.
    let alternate: Awaited<ReturnType<typeof tideAt>> = null;
    if (primary.tidalRange !== null) {
      const want = regimeOf(primary.tidalRange, primary.station) === 'sheltered' ? 'open' : 'sheltered';
      for (const st of ranked.slice(1, 6).filter((r) => r.dist <= ALTERNATE_MAX_KM)) {
        const t = await tideAt(st);
        if (t && t.tidalRange !== null && regimeOf(t.tidalRange, t.station) === want) { alternate = t; break; }
      }
    }

    return NextResponse.json(
      {
        available: true,
        ...primary,
        regime: primary.tidalRange !== null ? regimeOf(primary.tidalRange, primary.station) : null,
        alternate: alternate ? { ...alternate, regime: regimeOf(alternate.tidalRange!, alternate.station) } : null,
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

/** Range (ft) below which a station is sheltered water, and at or above which it is open coast. */
const SHELTERED_MAX_FT = 0.6;
const OPEN_MIN_FT = 1.5;
/** How far to look for a station of the other regime. */
const ALTERNATE_MAX_KM = 30;

/**
 * NOAA names a station by its water body, and inside water is not always
 * small water: Palm Valley on the ICWW runs 3.7 ft, more than the Atlantic
 * beach 6 km east at Ponte Vedra, but on its own timing. A name that places
 * the station inside counts as sheltered whatever its range.
 */
const INSIDE_WATER = /\b(inside|ICWW|Intracoastal|Sound|River|Lagoon|Lake|Creek|Causeway|Bayou|Bay|Harbou?r|Marsh|Canal)\b/i;

/** NOAA names read "Place, Water body"; the water body is what to judge. "Boynton Beach, Lake Worth" is the lagoon. */
function waterBodyOf(name: string): string {
  const i = name.lastIndexOf(',');
  return i >= 0 ? name.slice(i + 1) : name;
}

function regimeOf(rangeFt: number, name: string): 'sheltered' | 'open' | 'mixed' {
  const body = waterBodyOf(name);
  if (/\(ocean\)|\bocean\b|atlantic|gulf of/i.test(body)) return 'open';
  if (INSIDE_WATER.test(body) || rangeFt < SHELTERED_MAX_FT) return 'sheltered';
  return rangeFt >= OPEN_MIN_FT ? 'open' : 'mixed';
}

async function tideAt(st: { id: string; name: string; dist: number }) {
  const today = new Date();
  const later = new Date(today.getTime() + 48 * 60 * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
  const predUrl = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?begin_date=${fmt(today)}&end_date=${fmt(later)}&station=${st.id}&product=predictions&datum=MLLW&time_zone=gmt&interval=hilo&units=english&format=json`;
  const predRes = await fetch(predUrl, { signal: AbortSignal.timeout(5000), headers: { 'User-Agent': UA } }).catch(() => null);
  if (!predRes || !predRes.ok) return null;
  const preds = await predRes.json();
  const rawEvents: { t: string; v: string; type: 'H' | 'L' }[] = preds?.predictions || [];

  const now = Date.now();
  const events = rawEvents.flatMap((e) => {
    const timestamp = parseTimestamp(e.t).getTime();
    const height = parseFloat(e.v);
    if (!Number.isFinite(timestamp) || !Number.isFinite(height)) return [];
    return [{ timestamp, iso: new Date(timestamp).toISOString(), height, type: e.type }];
  });
  const upcoming = events.filter((e) => e.timestamp > now).sort((a, b) => a.timestamp - b.timestamp);
  const nextHigh = upcoming.find((e) => e.type === 'H');
  const nextLow = upcoming.find((e) => e.type === 'L');
  const past = events.filter((e) => e.timestamp <= now).sort((a, b) => b.timestamp - a.timestamp);
  const lastEvent = past[0];
  const nextEvent = upcoming[0];

  let current: 'rising' | 'falling' | 'high' | 'low' | 'unknown' = 'unknown';
  if (lastEvent && nextEvent) current = nextEvent.type === 'H' ? 'rising' : 'falling';
  else if (nextEvent) current = nextEvent.type === 'H' ? 'falling' : 'rising';

  return {
    current,
    nextHigh: nextHigh ? { time: nextHigh.iso, height: nextHigh.height } : null,
    nextLow: nextLow ? { time: nextLow.iso, height: nextLow.height } : null,
    lastEvent: lastEvent ? { time: lastEvent.iso, height: lastEvent.height, type: lastEvent.type } : null,
    tidalRange: nextHigh && nextLow ? Math.abs(nextHigh.height - nextLow.height) : null,
    station: st.name,
    stationId: st.id,
    stationDistanceKm: st.dist,
  };
}
