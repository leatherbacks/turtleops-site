import { useState, useEffect } from 'react';
import {
  analyzeWaterMatch,
  type TagTempReading,
  type WaterTempSample,
  type WaterMatchAnalysis,
} from '@/analysis/waterMatch';

/**
 * Compare the tag's temperature record against water temperature over the same
 * period, and find when — if ever — it stopped tracking the water.
 *
 * Outside useAnalysis for the same reason as useTidePhase: it needs a network
 * round-trip and a position, neither of which exists until local parsing has
 * already produced a result.
 */

interface UseWaterMatchReturn {
  analysis: WaterMatchAnalysis | null;
  station: string | null;
  stationDistanceKm: number | null;
  loading: boolean;
  unavailable: string | null;
}

/** NOAA rejects long spans, and a month is beyond any realistic record here. */
const MAX_SPAN_DAYS = 30;

function yyyymmdd(d: Date): string {
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}`
  );
}

export function useWaterMatch(
  readings: TagTempReading[],
  lat: number | null,
  lon: number | null
): UseWaterMatchReturn {
  const [analysis, setAnalysis] = useState<WaterMatchAnalysis | null>(null);
  const [station, setStation] = useState<string | null>(null);
  const [stationDistanceKm, setStationDistanceKm] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  const dated = readings.filter(
    (r) => !isNaN(r.date.getTime()) && Number.isFinite(r.temperatureC)
  );
  const first = dated.length ? Math.min(...dated.map((r) => r.date.getTime())) : 0;
  const last = dated.length ? Math.max(...dated.map((r) => r.date.getTime())) : 0;

  useEffect(() => {
    if (lat === null || lon === null || dated.length < 3) return;

    let begin = new Date(first);
    const end = new Date(last);
    const capped = new Date(last - MAX_SPAN_DAYS * 86_400_000);
    if (begin < capped) begin = capped;

    // A day either side, so a reading near a boundary still finds a water
    // sample within the matching window rather than being silently unmatched.
    const from = new Date(begin.getTime() - 86_400_000);
    const to = new Date(end.getTime() + 86_400_000);

    let cancelled = false;
    setLoading(true);
    setUnavailable(null);

    fetch(
      `/api/water-temp?lat=${lat}&lon=${lon}` +
        `&begin=${yyyymmdd(from)}&end=${yyyymmdd(to)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return;
        if (!res?.available || !Array.isArray(res.samples) || res.samples.length === 0) {
          setUnavailable(
            res?.reason === 'no_nearby_station'
              ? `No water-temperature gauge within 60 km${
                  typeof res.nearestKm === 'number' ? ` — nearest is ${res.nearestKm} km` : ''
                }. Water temperature varies too much over that distance to compare against.`
              : 'Water temperature unavailable for this position and period.'
          );
          setAnalysis(null);
          return;
        }
        const samples: WaterTempSample[] = res.samples
          .map((s: { time: string; temperatureC: number }) => ({
            date: new Date(s.time),
            temperatureC: s.temperatureC,
          }))
          .filter((s: WaterTempSample) => !isNaN(s.date.getTime()));

        setStation(res.station ?? null);
        setStationDistanceKm(
          typeof res.stationDistanceKm === 'number' ? res.stationDistanceKm : null
        );
        setAnalysis(analyzeWaterMatch(dated, samples, lat, lon));
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable('Water-temperature lookup failed.');
          setAnalysis(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // Keyed on the bounds and count rather than the array identity, which is
    // rebuilt on every analysis pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, dated.length, first, last]);

  return { analysis, station, stationDistanceKm, loading, unavailable };
}
