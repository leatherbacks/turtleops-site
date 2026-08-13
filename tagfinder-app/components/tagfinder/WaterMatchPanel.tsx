'use client';

import type { WaterMatchAnalysis } from '@/analysis/waterMatch';
import { Thermometer } from 'lucide-react';

interface WaterMatchPanelProps {
  analysis: WaterMatchAnalysis;
  station: string | null;
  stationDistanceKm: number | null;
}

function stamp(d: Date): string {
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString(
    [],
    { hour: '2-digit', minute: '2-digit', hour12: false }
  )}`;
}

const VERDICT_LABEL = {
  immersed: 'In the water',
  exposed: 'Out of the water',
  unclear: 'Inconclusive',
} as const;

export default function WaterMatchPanel({
  analysis,
  station,
  stationDistanceKm,
}: WaterMatchPanelProps) {
  const { verdict, segments, transition, diurnal, coldestDeltaC, matched } = analysis;

  if (!analysis.available) {
    return (
      <div className="bg-surface rounded-xl border border-border p-5">
        <div className="flex items-center gap-2 mb-2">
          <Thermometer className="w-5 h-5 text-muted" />
          <h3 className="font-semibold">Tag vs Water Temperature</h3>
        </div>
        <p className="text-sm text-muted">{analysis.reasoning}</p>
      </div>
    );
  }

  const accent =
    verdict === 'exposed'
      ? 'text-warning'
      : verdict === 'immersed'
        ? 'text-primary'
        : 'text-muted';

  // Plot delta, not absolute temperature. The absolute values hide the signal
  // whenever the water itself is trending, which over a week it usually is.
  const deltas = matched.map((m) => m.deltaC);
  const lo = Math.min(-2, ...deltas);
  const hi = Math.max(2, ...deltas);
  const y = (d: number) => 100 - ((d - lo) / (hi - lo)) * 100;
  const x = (i: number) => (matched.length === 1 ? 50 : (i / (matched.length - 1)) * 100);

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <Thermometer className={`w-5 h-5 ${accent}`} />
        <h3 className="font-semibold">Tag vs Water Temperature</h3>
        <span className={`text-xs uppercase tracking-wide font-semibold ml-auto ${accent}`}>
          {VERDICT_LABEL[verdict]}
        </span>
      </div>

      {transition && (
        <p className="text-2xl font-mono font-bold tracking-tight mb-1">
          {stamp(transition.firstExposed)}
          <span className="text-sm font-sans font-normal text-muted ml-2">
            left the water, between {stamp(transition.lastImmersed)} and here
          </span>
        </p>
      )}

      <p className="text-sm text-muted mb-3">{analysis.reasoning}</p>

      {/* Delta strip: zero line is "matches the water", bars are excursions. */}
      <div className="relative w-full h-24 mb-1">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="w-full h-full overflow-visible"
        >
          {/* the band inside which a floating tag lives */}
          <rect
            x="0"
            y={y(2)}
            width="100"
            height={Math.max(0, y(-2) - y(2))}
            className="fill-primary/10"
          />
          <line x1="0" y1={y(0)} x2="100" y2={y(0)} className="stroke-border" strokeWidth="0.4" />
          {transition && (
            <line
              x1={x(matched.findIndex((m) => m.date >= transition.firstExposed))}
              y1="0"
              x2={x(matched.findIndex((m) => m.date >= transition.firstExposed))}
              y2="100"
              className="stroke-warning"
              strokeWidth="0.6"
              strokeDasharray="2 2"
            />
          )}
          {matched.map((m, i) => (
            <line
              key={i}
              x1={x(i)}
              y1={y(0)}
              x2={x(i)}
              y2={y(m.deltaC)}
              strokeWidth="1.4"
              strokeLinecap="round"
              className={
                Math.abs(m.deltaC) >= 2
                  ? 'stroke-warning'
                  : m.phase === 'night'
                    ? 'stroke-primary/60'
                    : 'stroke-primary'
              }
            />
          ))}
        </svg>
      </div>
      <div className="flex justify-between text-[11px] text-muted mb-3">
        <span>{matched.length > 0 ? stamp(matched[0].date) : ''}</span>
        <span>tag minus water, °C — shaded band is ±2 °C</span>
        <span>{matched.length > 0 ? stamp(matched[matched.length - 1].date) : ''}</span>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        {segments.map((s, i) => (
          <div key={i} className="contents">
            <span className="text-muted">
              {segments.length > 1 ? `Segment ${i + 1}` : 'Whole record'} ({s.n})
            </span>
            <span className="font-mono text-right">
              {s.medianDeltaC > 0 ? '+' : ''}
              {s.medianDeltaC.toFixed(1)} °C, spread {s.spreadC.toFixed(1)} —{' '}
              {VERDICT_LABEL[s.verdict].toLowerCase()}
            </span>
          </div>
        ))}
        {coldestDeltaC !== null && (
          <>
            <span className="text-muted">Coldest vs water</span>
            <span
              className={`font-mono text-right ${coldestDeltaC <= -3 ? 'text-warning font-semibold' : ''}`}
            >
              {coldestDeltaC.toFixed(1)} °C
            </span>
          </>
        )}
        {diurnal?.separationC !== null && diurnal && diurnal.nDay >= 2 && diurnal.nNight >= 2 && (
          <>
            <span className="text-muted">Day vs night</span>
            <span className="font-mono text-right">
              {diurnal.separationC!.toFixed(1)} °C apart
            </span>
          </>
        )}
      </div>

      {station && (
        <p className="text-[11px] text-muted mt-3">
          Water temperature from {station}
          {stationDistanceKm !== null ? `, ${stationDistanceKm.toFixed(0)} km away` : ''}.
          {analysis.unmatchedReadings > 0 &&
            ` ${analysis.unmatchedReadings} reading${
              analysis.unmatchedReadings === 1 ? '' : 's'
            } had no water observation within an hour and were excluded.`}
        </p>
      )}
    </div>
  );
}
