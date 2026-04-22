'use client';

import type { DiveProfile } from '@/lib/types';
import { useMemo } from 'react';
import { Activity } from 'lucide-react';

interface DiveProfilePanelProps {
  profile: DiveProfile;
  releaseDate?: Date | null;
}

const WIDTH = 600;
const HEIGHT = 200;
const PADDING = 30;

export default function DiveProfilePanel({ profile, releaseDate }: DiveProfilePanelProps) {
  const { svgPath, tempPath, maxDepth, yTicks, xTicks } = useMemo(() => {
    const depths = profile.displaySeries
      .filter((p) => p.depth !== null)
      .map((p) => ({ t: p.date.getTime(), d: p.depth! }));
    const temps = profile.displaySeries
      .filter((p) => p.temp !== null)
      .map((p) => ({ t: p.date.getTime(), v: p.temp! }));

    if (depths.length === 0) {
      return { svgPath: '', tempPath: '', maxDepth: 0, yTicks: [], xTicks: [] };
    }

    const tMin = depths[0].t;
    const tMax = depths[depths.length - 1].t;
    const dMax = Math.max(...depths.map((p) => p.d));

    const xScale = (t: number) =>
      PADDING + ((t - tMin) / (tMax - tMin)) * (WIDTH - 2 * PADDING);
    const yScale = (d: number) =>
      PADDING + (d / dMax) * (HEIGHT - 2 * PADDING);

    const path = depths
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.t).toFixed(1)},${yScale(p.d).toFixed(1)}`)
      .join(' ');

    // Temperature overlay on separate scale
    let tempPathStr = '';
    if (temps.length > 0) {
      const tMinTemp = Math.min(...temps.map((p) => p.v));
      const tMaxTemp = Math.max(...temps.map((p) => p.v));
      const range = tMaxTemp - tMinTemp || 1;
      const yScaleTemp = (v: number) =>
        HEIGHT - PADDING - ((v - tMinTemp) / range) * (HEIGHT - 2 * PADDING) * 0.3;
      tempPathStr = temps
        .map((p, i) => `${i === 0 ? 'M' : 'L'}${xScale(p.t).toFixed(1)},${yScaleTemp(p.v).toFixed(1)}`)
        .join(' ');
    }

    // Y ticks (depth)
    const numYTicks = 4;
    const yTicks = Array.from({ length: numYTicks + 1 }, (_, i) => {
      const d = (dMax / numYTicks) * i;
      return { y: yScale(d), label: `${d.toFixed(0)}m` };
    });

    // X ticks (time) — start, middle, end
    const xTicks = [tMin, (tMin + tMax) / 2, tMax].map((t) => ({
      x: xScale(t),
      label: new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
    }));

    return { svgPath: path, tempPath: tempPathStr, maxDepth: dMax, yTicks, xTicks };
  }, [profile]);

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-5 h-5 text-info" />
        <h3 className="font-semibold">Dive Profile</h3>
        {releaseDate && profile.lastReading < releaseDate && (
          <span className="text-xs bg-info/10 text-info border border-info/20 px-2 py-0.5 rounded-full">
            pre-popoff
          </span>
        )}
        <span className="text-xs text-muted ml-auto">
          {profile.totalReadings} readings
        </span>
      </div>

      <div className="grid grid-cols-4 gap-3 text-sm mb-4">
        <Stat label="Max depth" value={`${profile.maxDepth.toFixed(1)}m`} />
        <Stat label="Avg depth" value={`${profile.avgDepth.toFixed(1)}m`} />
        <Stat
          label="Surface %"
          value={`${profile.surfaceTimePct.toFixed(0)}%`}
        />
        {profile.tempRange && (
          <Stat
            label="Temp"
            value={`${profile.tempRange.min.toFixed(1)}–${profile.tempRange.max.toFixed(1)}°C`}
          />
        )}
      </div>

      <div className="bg-surface-elevated rounded-lg p-2 overflow-x-auto">
        <svg
          width={WIDTH}
          height={HEIGHT}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto"
          preserveAspectRatio="none"
        >
          {/* Y-axis labels */}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line
                x1={PADDING}
                x2={WIDTH - PADDING}
                y1={t.y}
                y2={t.y}
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={1}
              />
              <text
                x={PADDING - 4}
                y={t.y + 3}
                fontSize={10}
                fill="rgba(255,255,255,0.4)"
                textAnchor="end"
              >
                {t.label}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {xTicks.map((t, i) => (
            <text
              key={i}
              x={t.x}
              y={HEIGHT - 5}
              fontSize={10}
              fill="rgba(255,255,255,0.4)"
              textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'}
            >
              {t.label}
            </text>
          ))}

          {/* Surface line */}
          <line
            x1={PADDING}
            x2={WIDTH - PADDING}
            y1={PADDING}
            y2={PADDING}
            stroke="rgba(16,185,129,0.4)"
            strokeWidth={1}
            strokeDasharray="3,3"
          />

          {/* Depth curve */}
          <path
            d={svgPath}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={1.5}
            strokeLinejoin="round"
          />

          {/* Temperature curve (overlay, thin) */}
          {tempPath && (
            <path
              d={tempPath}
              fill="none"
              stroke="#f59e0b"
              strokeWidth={1}
              strokeLinejoin="round"
              opacity={0.6}
            />
          )}
        </svg>
        <div className="flex gap-4 justify-center mt-2 text-xs text-muted">
          <span className="flex items-center gap-1">
            <div className="w-3 h-0.5 bg-info" /> Depth
          </span>
          {profile.tempRange && (
            <span className="flex items-center gap-1">
              <div className="w-3 h-0.5 bg-warning" /> Temperature
            </span>
          )}
          <span className="opacity-60">Max: {maxDepth.toFixed(0)}m</span>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className="font-mono font-medium">{value}</div>
    </div>
  );
}
