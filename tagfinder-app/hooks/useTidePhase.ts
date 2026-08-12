import { useState, useEffect } from 'react';
import type { ArgosPass, TideExtreme, TidePhaseAnalysis } from '@/lib/types';
import { analyzeTidePhase } from '@/analysis/tidePhase';

/**
 * Does this tag's reception track the tide, and when should a field team be
 * standing there with a receiver?
 *
 * Kept out of useAnalysis deliberately. Everything in that hook is local
 * parsing and runs synchronously; this needs a network round-trip for tide
 * predictions and a position to look them up against, neither of which exists
 * until the analysis has already produced a result. Same shape as
 * useEnvironment, for the same reason.
 */

interface UseTidePhaseReturn {
  analysis: TidePhaseAnalysis | null;
  station: string | null;
  stationDistanceKm: number | null;
  loading: boolean;
  /** Set when tides could not be looked up at all — outside US coverage, etc. */
  unavailable: string | null;
}

/** NOAA rejects long spans; a fortnight covers any realistic reception record. */
const MAX_SPAN_DAYS = 14;

function yyyymmdd(d: Date): string {
  return (
    `${d.getUTCFullYear()}` +
    `${String(d.getUTCMonth() + 1).padStart(2, '0')}` +
    `${String(d.getUTCDate()).padStart(2, '0')}`
  );
}

export function useTidePhase(
  passes: ArgosPass[],
  lat: number | null,
  lon: number | null
): UseTidePhaseReturn {
  const [analysis, setAnalysis] = useState<TidePhaseAnalysis | null>(null);
  const [station, setStation] = useState<string | null>(null);
  const [stationDistanceKm, setStationDistanceKm] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [unavailable, setUnavailable] = useState<string | null>(null);

  useEffect(() => {
    if (lat === null || lon === null || passes.length === 0) return;

    const dated = passes.filter((p) => !isNaN(p.date.getTime()));
    if (dated.length === 0) return;

    const times = dated.map((p) => p.date.getTime());
    const last = new Date(Math.max(...times));
    let first = new Date(Math.min(...times));
    // Cap the span from the *end*, since recent reception is what the analyzer
    // weighs most heavily anyway.
    const capped = new Date(last.getTime() - MAX_SPAN_DAYS * 86_400_000);
    if (first < capped) first = capped;

    // A day either side so the first and last passes are never left dangling
    // outside the extremes and silently dropped from the count.
    const begin = new Date(first.getTime() - 86_400_000);
    const end = new Date(last.getTime() + 86_400_000);

    let cancelled = false;
    setLoading(true);
    setUnavailable(null);

    fetch(
      `/api/tide-extremes?lat=${lat}&lon=${lon}` +
        `&begin=${yyyymmdd(begin)}&end=${yyyymmdd(end)}`
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return;
        if (!res?.available || !Array.isArray(res.extremes) || res.extremes.length < 2) {
          setUnavailable(
            res?.reason === 'no_nearby_station'
              ? 'No tide gauge within 100 km — tidal analysis not applicable here.'
              : 'Tide predictions unavailable for this position.'
          );
          setAnalysis(null);
          return;
        }
        const extremes: TideExtreme[] = res.extremes
          .map((e: { time: string; type: string; height: number }) => ({
            time: new Date(e.time),
            type: e.type === 'H' ? 'H' : 'L',
            height: e.height,
          }))
          .filter((e: TideExtreme) => !isNaN(e.time.getTime()));

        setStation(res.station ?? null);
        setStationDistanceKm(
          typeof res.stationDistanceKm === 'number' ? res.stationDistanceKm : null
        );
        setAnalysis(analyzeTidePhase(dated, extremes));
      })
      .catch(() => {
        if (!cancelled) {
          setUnavailable('Tide lookup failed.');
          setAnalysis(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // passes is rebuilt on every analysis; keying on its length and bounds
    // avoids refetching on every render without deep-comparing the array.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lon, passes.length]);

  return { analysis, station, stationDistanceKm, loading, unavailable };
}
