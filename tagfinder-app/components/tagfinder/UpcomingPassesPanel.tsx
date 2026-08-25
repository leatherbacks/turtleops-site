'use client';

import type { SatellitePass } from '@/analysis/satPrediction';
import type { AntennaExposure } from '@/lib/types';
import { Clock, Loader2 } from 'lucide-react';

interface UpcomingPassesPanelProps {
  passes: SatellitePass[];
  loading: boolean;
  error: string | null;
  /** If provided, use the elevation cutoff to mark passes as "likely receivable" */
  exposure?: AntennaExposure | null;
}

export default function UpcomingPassesPanel({
  passes,
  loading,
  error,
  exposure,
}: UpcomingPassesPanelProps) {
  // Determine "likely to be received" threshold.
  // If we have an exposure analysis with a cutoff, use that.
  // Otherwise assume a moderate threshold of 30°.
  const elevThreshold = exposure?.elevationCutoffDeg ?? 30;

  // Must be a pass that has not already finished. The predictions are computed
  // when the analysis runs, but a report can be rendered or printed minutes to
  // hours later, and picking the first qualifying pass regardless of time
  // produced a headline reading "next likely reception in -3 min" — a pass that
  // had already come and gone.
  const now = Date.now();
  const stillToCome = passes.filter(
    (p) => p.riseTime.getTime() + p.duration * 1000 > now
  );
  const nextLikely = stillToCome.find((p) => p.maxElevation >= elevThreshold);
  const displayCount = 8;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-5 h-5 text-info" />
        <h3 className="font-semibold">Upcoming Satellite Passes</h3>
        <span className="text-xs text-muted ml-auto">next 48h</span>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-sm text-muted py-3">
          <Loader2 className="w-4 h-4 animate-spin" />
          Computing upcoming passes...
        </div>
      )}

      {error && (
        <div className="text-sm text-error py-3">{error}</div>
      )}

      {!loading && !error && passes.length === 0 && (
        <div className="text-sm text-muted py-3">
          No Argos satellite passes above {elevThreshold.toFixed(0)}° in the next 48 hours.
        </div>
      )}

      {!loading && !error && passes.length > 0 && (
        <>
          {nextLikely && (
            <div className="mb-3 p-3 rounded-lg bg-info/10 border border-info/20">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-info">
                  Next likely reception
                </span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="font-mono font-bold text-lg">
                  {formatRelativeTime(nextLikely.riseTime)}
                </span>
                <span className="text-xs text-muted">
                  ({formatLocalTime(nextLikely.riseTime)})
                </span>
              </div>
              <div className="text-xs text-muted mt-1">
                {nextLikely.satelliteName} · peak {nextLikely.maxElevation.toFixed(0)}° elevation
                at azimuth {nextLikely.peakAzimuth.toFixed(0)}° (
                {azimuthLabel(nextLikely.peakAzimuth)}) ·{' '}
                {Math.round(nextLikely.duration / 60)}-min window
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted uppercase tracking-wide border-b border-border">
                  <th className="py-1.5 pr-3">Rise (local)</th>
                  <th className="py-1.5 pr-3">Sat</th>
                  <th className="py-1.5 pr-3 text-right">Peak el</th>
                  <th className="py-1.5 pr-3 text-right">Peak az</th>
                  <th className="py-1.5 pr-1">Likely?</th>
                </tr>
              </thead>
              <tbody>
                {passes.slice(0, displayCount).map((p, i) => {
                  const likely = p.maxElevation >= elevThreshold;
                  return (
                    <tr
                      key={i}
                      className={`border-b border-border/40 ${likely ? '' : 'opacity-50'}`}
                    >
                      <td className="py-1.5 pr-3 font-mono">
                        {formatLocalTime(p.riseTime)}
                      </td>
                      <td className="py-1.5 pr-3">{p.satelliteName}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">
                        {p.maxElevation.toFixed(0)}°
                      </td>
                      <td className="py-1.5 pr-3 text-right font-mono">
                        {p.peakAzimuth.toFixed(0)}° ({azimuthLabel(p.peakAzimuth)})
                      </td>
                      <td className="py-1.5 pr-1">
                        {likely ? (
                          <span className="text-success">●</span>
                        ) : (
                          <span className="text-muted">○</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {passes.length > displayCount && (
              <div className="text-xs text-muted mt-2">
                + {passes.length - displayCount} more passes
              </div>
            )}
          </div>

          <div className="text-xs text-muted mt-3">
            ● = peak ≥ {elevThreshold.toFixed(0)}° — likely to produce a fix
            {exposure?.elevationCutoffDeg !== null &&
              exposure?.elevationCutoffDeg !== undefined && (
                <span> (based on detected antenna cutoff)</span>
              )}
          </div>
        </>
      )}
    </div>
  );
}

function formatRelativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  // A pass already underway is the most useful thing that can be said, and a
  // negative countdown is never a sensible thing to print.
  if (diffMs <= 0) return 'overhead now';
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return 'in under a minute';
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rem = minutes % 60;
  if (hours < 24) return `in ${hours}h ${rem}m`;
  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  return `in ${days}d ${remH}h`;
}

function formatLocalTime(date: Date): string {
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function azimuthLabel(deg: number): string {
  const dirs = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}
