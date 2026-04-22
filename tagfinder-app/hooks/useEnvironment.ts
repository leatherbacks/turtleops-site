import { useState, useEffect } from 'react';
import type { EnvironmentData } from '@/lib/types';
import { LAND_THRESHOLD_M } from '@/lib/constants';

interface UseEnvironmentReturn {
  data: EnvironmentData;
  loading: {
    elevation: boolean;
    weather: boolean;
    tides: boolean;
    location: boolean;
    bathymetry: boolean;
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
  });

  const [loading, setLoading] = useState({
    elevation: false,
    weather: false,
    tides: false,
    location: false,
    bathymetry: false,
  });

  useEffect(() => {
    if (lat === null || lon === null) return;

    setLoading({ elevation: true, weather: true, tides: true, location: true, bathymetry: true });

    // Elevation
    fetch(`/api/elevation?lat=${lat}&lon=${lon}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (res && typeof res.meters === 'number') {
          const classification =
            res.meters > LAND_THRESHOLD_M
              ? 'land'
              : res.meters >= 0
                ? 'intertidal'
                : 'water';
          setData((d) => ({
            ...d,
            elevation: {
              meters: res.meters,
              source: res.source,
              classification,
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

  return { data, loading };
}
