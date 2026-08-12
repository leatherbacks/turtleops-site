import { useState, useEffect, useMemo } from 'react';
import type { EnvironmentData } from '@/lib/types';
import { LAND_THRESHOLD_M, INTERTIDAL_MAX_DEPTH_M } from '@/lib/constants';

interface UseEnvironmentReturn {
  data: EnvironmentData;
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
export function useEnvironment(
  lat: number | null,
  lon: number | null
): UseEnvironmentReturn {
  const [data, setData] = useState<EnvironmentData>({
    elevation: null,
    weather: null,
    tides: null,
    location: null,
    bathymetry: null,
    forecast: null,
  });

  const [loading, setLoading] = useState({
    elevation: false,
    weather: false,
    tides: false,
    location: false,
    bathymetry: false,
    forecast: false,
  });

  useEffect(() => {
    if (lat === null || lon === null) return;

    setLoading({ elevation: true, weather: true, tides: true, location: true, bathymetry: true, forecast: true });

    // Elevation
    fetch(`/api/elevation?lat=${lat}&lon=${lon}`)
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
      .finally(() => setLoading((l) => ({ ...l, elevation: false })));

    // Weather
    fetch(`/api/weather?lat=${lat}&lon=${lon}`)
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
      .finally(() => setLoading((l) => ({ ...l, weather: false })));

    // Tides
    fetch(`/api/tides?lat=${lat}&lon=${lon}`)
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
      .finally(() => setLoading((l) => ({ ...l, tides: false })));

    // Forecast (7-day wind/wave + storm alert)
    fetch(`/api/forecast?lat=${lat}&lon=${lon}`)
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
      .finally(() => setLoading((l) => ({ ...l, forecast: false })));

    // Bathymetry (GEBCO seabed depth)
    fetch(`/api/bathymetry?lat=${lat}&lon=${lon}`)
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
      .finally(() => setLoading((l) => ({ ...l, bathymetry: false })));

    // Geocoding
    fetch(`/api/geocode?lat=${lat}&lon=${lon}`)
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
      .finally(() => setLoading((l) => ({ ...l, location: false })));
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

  return { data: classified, loading };
}
