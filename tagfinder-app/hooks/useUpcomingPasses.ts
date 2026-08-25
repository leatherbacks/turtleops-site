import { useEffect, useState } from 'react';
import { predictPassesInWindow, type SatellitePass } from '@/analysis/satPrediction';

interface UseUpcomingPassesOptions {
  /** Position of the tag */
  lat: number | null;
  lon: number | null;
  /** How many hours ahead to predict (default 48) */
  hoursAhead?: number;
  /** Minimum peak elevation to include (default 5°) */
  minElevation?: number;
}

interface UseUpcomingPassesReturn {
  passes: SatellitePass[];
  loading: boolean;
  error: string | null;
}

/**
 * Predict upcoming Argos satellite passes over the tag's position.
 * Fetches TLEs, then propagates forward from "now" for the next N hours.
 */
export function useUpcomingPasses({
  lat,
  lon,
  hoursAhead = 48,
  minElevation = 5,
}: UseUpcomingPassesOptions): UseUpcomingPassesReturn {
  const [passes, setPasses] = useState<SatellitePass[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (lat === null || lon === null) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch('/api/tles');
        if (!res.ok) {
          if (!cancelled) {
            // Name the cause — three different failures used to share one
            // message, and telling them apart took a debugging session.
            setError(
              res.status === 429
                ? 'Rate limit reached — pass predictions will return tomorrow.'
                : res.status === 502
                  ? 'Orbital-element feed unreachable from the server (upstream refused the request). Usually transient — try again in a few hours.'
                  : 'Failed to fetch TLE data'
            );
          }
          return;
        }
        const data = await res.json();
        if (cancelled) return;
        if (!data.entries || data.entries.length === 0) {
          setError('No TLE data available');
          return;
        }

        const now = new Date();
        const end = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
        const predicted = predictPassesInWindow(
          data.entries,
          lat,
          lon,
          now,
          end,
          minElevation
        );

        if (!cancelled) setPasses(predicted);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Prediction failed');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [lat, lon, hoursAhead, minElevation]);

  return { passes, loading, error };
}
