'use client';

import type { TidePhaseAnalysis } from '@/lib/types';
import { Waves } from 'lucide-react';

interface TidePhasePanelProps {
  analysis: TidePhaseAnalysis;
  station: string | null;
  stationDistanceKm: number | null;
}

function timeRange(from: Date, to: Date): string {
  const f = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = from.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  return `${day}, ${f(from)}–${f(to)}`;
}

export default function TidePhasePanel({
  analysis,
  station,
  stationDistanceKm,
}: TidePhasePanelProps) {
  const { dominant, strength, bins, bestWindow, excessRatio, excessRange } = analysis;

  const total = bins.reduce((s, b) => s + b.fallingMessages + b.risingMessages, 0);
  const max = Math.max(1, ...bins.map((b) => Math.max(b.fallingMessages, b.risingMessages)));

  const accent =
    strength === 'strong' ? 'text-primary' : strength === 'moderate' ? 'text-warning' : 'text-muted';

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <Waves className={`w-5 h-5 ${accent}`} />
        <h3 className="font-semibold">Reception vs Tide</h3>
        {strength !== 'none' && (
          <span
            className={`text-xs uppercase tracking-wide font-semibold ml-auto ${accent}`}
          >
            {dominant} tide{strength === 'moderate' ? ' (modest)' : ''}
          </span>
        )}
      </div>

      {/*
        The headline is deliberately the exposure-corrected per-pass figure, not
        the raw message split. Raw counts inherit the satellite schedule: on
        a reference PSAT+ deployment the raw ratio was 3.7:1 and 1.7x of that was simply more
        passes falling on ebbing tides.
      */}
      {strength !== 'none' && excessRatio !== null && (
        <p className="text-2xl font-mono font-bold tracking-tight mb-1">
          {excessRatio.toFixed(1)}×
          <span className="text-sm font-sans font-normal text-muted ml-2">
            more messages per pass on the {dominant} tide
          </span>
        </p>
      )}

      <p className="text-sm text-muted leading-relaxed">{analysis.reasoning}</p>

      {bestWindow && (
        <div className="mt-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
          <div className="text-xs uppercase tracking-wide font-semibold text-primary mb-1">
            Best search window
          </div>
          <div className="font-mono text-sm">
            {timeRange(bestWindow.peakFrom, bestWindow.peakTo)}
          </div>
          <p className="text-xs text-muted mt-1">
            Peak band {bestWindow.peakBandLabel} of the tidal range. The whole{' '}
            {dominant} leg runs {timeRange(bestWindow.legFrom, bestWindow.legTo)}.
          </p>
        </div>
      )}

      {total > 0 && (
        <div className="mt-4">
          <div className="text-xs text-muted mb-2">
            Messages by height in the tidal range — falling vs rising
          </div>
          <div className="flex flex-col gap-1">
            {bins.map((b) => (
              <div key={b.label} className="flex items-center gap-2 text-xs">
                <span className="font-mono text-muted w-24 shrink-0 text-right">
                  {b.label}
                </span>
                <div className="flex-1 flex items-center gap-1">
                  <div className="flex-1 flex justify-end">
                    <div
                      className="h-3 bg-primary/70 rounded-sm"
                      style={{ width: `${(b.fallingMessages / max) * 100}%` }}
                      title={`${b.fallingMessages} falling`}
                    />
                  </div>
                  <div className="flex-1">
                    <div
                      className="h-3 bg-muted/50 rounded-sm"
                      style={{ width: `${(b.risingMessages / max) * 100}%` }}
                      title={`${b.risingMessages} rising`}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-4 text-xs text-muted mt-2 justify-center">
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-primary/70 rounded-sm inline-block" /> falling
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-muted/50 rounded-sm inline-block" /> rising
            </span>
          </div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-border text-xs text-muted flex flex-wrap gap-x-4 gap-y-1">
        <span>
          {analysis.fallingPasses + analysis.risingPasses} passes analysed
          {analysis.windowDays ? `, last ${analysis.windowDays} days` : ', whole record'}
        </span>
        {excessRange && (
          <span>
            Across windows tested: {excessRange[0].toFixed(2)}×–{excessRange[1].toFixed(2)}×
          </span>
        )}
        {station && (
          <span>
            {station}
            {stationDistanceKm !== null ? ` (${stationDistanceKm.toFixed(0)} km)` : ''}
          </span>
        )}
      </div>
    </div>
  );
}
