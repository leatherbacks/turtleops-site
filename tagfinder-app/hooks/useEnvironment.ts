import { useState, useEffect, useMemo } from 'react';
import type { EnvironmentData } from '@/lib/types';
import { LAND_THRESHOLD_M, INTERTIDAL_MAX_DEPTH_M } from '@/lib/constants';

interface UseEnvironmentReturn {
  data: EnvironmentData;
  /**
   * True once every fetch for the current position has finished, success or
   * failure. Distinct from the loading flags, whose initial state is false —
   * "not loading" at mount means "not started", and a consumer that gated on
   * it fired before any data existed. React 18's effect ordering happened to
   * mask that; React 19's did not, and an AI brief shipped claiming the
   * environment was empty above panels displaying it.
   */
  settled: boolean;
  loading: {
    elevation: boolean;
    weather: boolean;
    tides: boolean;
    location: boolean;
    bathymetry: boolean;
    forecast: boolean;
  };
}

/**
 * Fetch environmental context (elevation, weather, tides, location name)
 * for a given coordinate. All 4 APIs called in parallel, independent loading states.
 */

/**
 * One retry on a gateway failure. The lookups behind these routes (Nominatim,
 * NOAA, USGS) return 502/503 under load, and a single failed geocode left the
 * AI brief writing "the geocoder returned no place name" beneath a panel that
 * resolved the place a moment later.
 */
async function fetchWithRetry(url: string): Promise<Response> {
  const first = await fetch(url).catch(() => null);
  if (first && first.status < 500) return first;
  await new Promise((r) => setTimeout(r, 1500));
  return fetch(url);
}

const EMPTY_ENVIRONMENT: EnvironmentData = {
    elevation: null,
    weather: null,
    tides: null,
    location: null,
    bathymetry: null,
    forecast: null,
  };

export function useEnvironment(
  lat: number | null,
  lon: number | null
): UseEnvironmentReturn {
  const [data, setData] = useState<EnvironmentData>(EMPTY_ENVIRONMENT);

  const [loading, setLoading] = useState({
    elevation: false,
    weather: false,
    tides: false,
    location: false,
    bathymetry: false,
    forecast: false,
  });
  // Settled is keyed to the position it was computed for. A plain boolean
  // stayed true from the previous tag until this effect re-ran, and in that
  // one render the brief effect saw "settled" and sent the new tag's brief
  // with the old tag's environment — a 47127 brief went out with no elevation
  // and tag state unknown while the panel beside it said "on land".
  const positionKey = lat === null || lon === null ? null : `${lat},${lon}`;
  const [settledFor, setSettledFor] = useState<string | null>(null);
  const settled = positionKey !== null && settledFor === positionKey;

  useEffect(() => {
    // A new position starts from nothing; otherwise the previous tag's
    // elevation, tides and weather sit in the panels until each fetch returns.
    setData(EMPTY_ENVIRONMENT);
    if (lat === null || lon === null) return;
    const key = `${lat},${lon}`;

    setLoading({ elevation: true, weather: true, tides: true, location: true, bathymetry: true, forecast: true });

    // Settles only when every chain below has finished, success or failure.
    let remaining = 6;
    const done = () => {
      remaining--;
      if (remaining === 0) setSettledFor(key);
    };

    // Elevation
    fetchWithRetry(`/api/elevation?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res && typeof res.meters === 'number') {
          // Provisional only. Terrain models clamp to 0 over the sea, so
          // elevation alone cannot tell open water from the intertidal zone —
          // the final call is made below, once bathymetry has resolved.
          setData((d) => ({
            ...d,
            elevation: {
              meters: res.meters,
              source: res.source,
              classification:
                res.meters > LAND_THRESHOLD_M ? 'land' : 'intertidal',
            },
          }));
        }
      })
      .catch(() => {})
      .finally(() => { setLoading((l) => ({ ...l, elevation: false })); done(); });

    // Weather
    fetchWithRetry(`/api/weather?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res && !res.error) {
          setData((d) => ({
            ...d,
            weather: {
              temperature: res.temperature,
              windSpeed: res.windSpeed,
              windDirection: res.windDirection,
              conditions: res.conditions,
              source: res.source,
            },
          }));
        }
      })
      .catch(() => {})
      .finally(() => { setLoading((l) => ({ ...l, weather: false })); done(); });

    // Tides
    fetchWithRetry(`/api/tides?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res?.available) {
          setData((d) => ({
            ...d,
            tides: {
              current: res.current,
              nextHigh: res.nextHigh
                ? { time: new Date(res.nextHigh.time), height: res.nextHigh.height }
                : null,
              nextLow: res.nextLow
                ? { time: new Date(res.nextLow.time), height: res.nextLow.height }
                : null,
              lastEvent: res.lastEvent
                ? {
                    time: new Date(res.lastEvent.time),
                    height: res.lastEvent.height,
                    type: res.lastEvent.type,
                  }
                : null,
              tidalRange: res.tidalRange,
              station: res.station,
              stationDistanceKm: res.stationDistanceKm,
            },
          }));
        }
      })
      .catch(() => {})
      .finally(() => { setLoading((l) => ({ ...l, tides: false })); done(); });

    // Forecast (7-day wind/wave + storm alert)
    fetchWithRetry(`/api/forecast?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res && !res.error) {
          setData((d) => ({
            ...d,
            forecast: {
              days: res.forecast,
              stormAlert: !!res.stormAlert,
              alertReason: res.alertReason ?? null,
              peakWindKn: res.peakWindKn ?? null,
              peakWaveM: res.peakWaveM ?? null,
            },
          }));
        }
      })
      .catch(() => {})
      .finally(() => { setLoading((l) => ({ ...l, forecast: false })); done(); });

    // Bathymetry (GEBCO seabed depth)
    fetchWithRetry(`/api/bathymetry?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res && !res.error && typeof res.rawElevationM === 'number') {
          setData((d) => ({
            ...d,
            bathymetry: {
              seabedDepthM: res.seabedDepthM,
              rawElevationM: res.rawElevationM,
              source: 'gebco',
            },
          }));
        }
      })
      .catch(() => {})
      .finally(() => { setLoading((l) => ({ ...l, bathymetry: false })); done(); });

    // Geocoding
    fetchWithRetry(`/api/geocode?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res && !res.error) {
          setData((d) => ({
            ...d,
            location: {
              name: res.name,
              county: res.county,
              state: res.state,
              source: res.source,
            },
          }));
        }
      })
      .catch(() => {})
      .finally(() => { setLoading((l) => ({ ...l, location: false })); done(); });
  }, [lat, lon]);

  /**
   * Final land / intertidal / water call.
   *
   * Elevation on its own cannot make it: USGS and Open-Elevation are terrain
   * models and return 0 over the sea, so every offshore position came back
   * "intertidal". PTT 41008 sat ~40 km off the Keys in 16 m of water and the
   * report told the reader it "may wash up at high tide".
   *
   * GEBCO bathymetry is the discriminator — if there is real water depth under
   * the position, it is not the intertidal zone.
   */
  const classified = useMemo<EnvironmentData>(() => {
    const el = data.elevation;
    if (!el) return data;

    if (el.meters > LAND_THRESHOLD_M) {
      return { ...data, elevation: { ...el, classification: 'land' } };
    }

    const seabed = data.bathymetry?.seabedDepthM ?? null;
    const classification =
      seabed !== null && seabed > INTERTIDAL_MAX_DEPTH_M ? 'water' : 'intertidal';

    return { ...data, elevation: { ...el, classification } };
  }, [data]);

  return { data: classified, loading, settled };
}
