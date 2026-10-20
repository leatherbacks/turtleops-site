import { useState, useEffect } from 'react';
import { analyzeAirMatch, type AirSample, type AirMatchAnalysis } from '@/analysis/airMatch';

/**
 * The stopped tag's temperature readings against the air measured at each
 * reading's own hour, from the nearest weather station. See analysis/airMatch.
 *
 * A hook for the same reason as useWaterMatch: it needs a network round-trip
 * and a position, which only exist once local parsing has produced a result.
 */

interface UseAirMatchReturn {
  analysis: AirMatchAnalysis | null;
  station: string | null;
  stationDistanceKm: number | null;
}

const MAX_SPAN_DAYS = 30;

function yyyymmdd(d: Date): string {
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}`
  );
}

export function useAirMatch(
  readings: { date: Date; temperatureC: number }[],
  lat: number | null,
  lon: number | null
): UseAirMatchReturn {
  const [analysis, setAnalysis] = useState<AirMatchAnalysis | null>(null);
  const [station, setStation] = useState<string | null>(null);
  const [stationDistanceKm, setStationDistanceKm] = useState<number | null>(null);

  const dated = readings.filter((r) => !isNaN(r.date.getTime()) && Number.isFinite(r.temperatureC));
  const first = dated.length ? Math.min(...dated.map((r) => r.date.getTime())) : 0;
  const last = dated.length ? Math.max(...dated.map((r) => r.date.getTime())) : 0;

  useEffect(() => {
    // Clear the previous tag's result first, as useWaterMatch learned to.
    setAnalysis(null);
    setStation(null);
    setStationDistanceKm(null);
    if (lat === null || lon === null || dated.length === 0) return;

    const begin = new Date(Math.max(first, last - MAX_SPAN_DAYS * 86_400_000) - 86_400_000);
    const end = new Date(last + 86_400_000);
    let cancelled = false;

    fetch(`/api/air-temp?lat=${lat}&lon=${lon}&begin=${yyyymmdd(begin)}&end=${yyyymmdd(end)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled || !res?.available || !Array.isArray(res.samples)) return;
        const air: AirSample[] = res.samples
          .map((s: { time: string; temperatureC: number }) => ({ date: new Date(s.time), temperatureC: s.temperatureC }))
          .filter((s: AirSample) => !isNaN(s.date.getTime()));
        setStation(res.station ?? null);
        setStationDistanceKm(typeof res.stationDistanceKm === 'number' ? res.stationDistanceKm : null);
        const a = analyzeAirMatch(dated, air, lat, lon);
        setAnalysis(a && { ...a, station: res.station ?? null, stationDistanceKm: res.stationDistanceKm ?? null });
      })
      .catch(() => {
        // The comparison falls back to the current air; nothing to show.
      });

    return () => {
      cancelled = true;
    };
    // Keyed on the bounds and count rather than the array identity, which is
    // rebuilt on every analysis pass.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, dated.length, first, last]);

  return { analysis, station, stationDistanceKm };
}
