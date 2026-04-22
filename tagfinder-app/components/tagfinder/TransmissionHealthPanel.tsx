'use client';

import type { TransmissionHealth, TransmissionHealthWindow } from '@/lib/types';
import { Activity, AlertTriangle, TrendingDown, Check } from 'lucide-react';

interface TransmissionHealthPanelProps {
  health: TransmissionHealth;
}

const TREND_META: Record<
  TransmissionHealth['trend'],
  { label: string; color: string; icon: typeof Check }
> = {
  stable: {
    label: 'Stable',
    color: 'text-success bg-success/10 border-success/20',
    icon: Check,
  },
  degrading: {
    label: 'Degrading',
    color: 'text-warning bg-warning/10 border-warning/20',
    icon: TrendingDown,
  },
  failing: {
    label: 'Failing',
    color: 'text-error bg-error/10 border-error/20',
    icon: AlertTriangle,
  },
  insufficient: {
    label: 'Insufficient data',
    color: 'text-muted bg-surface-elevated border-border',
    icon: Activity,
  },
};

export default function TransmissionHealthPanel({
  health,
}: TransmissionHealthPanelProps) {
  const meta = TREND_META[health.trend];
  const Icon = meta.icon;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Activity className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Transmission Health</h3>
      </div>

      <div className="mb-3">
        <span
          className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${meta.color}`}
        >
          <Icon className="w-3 h-3" />
          {meta.label.toUpperCase()}
        </span>
      </div>

      <p className="text-sm text-muted mb-3">{health.reasoning}</p>

      {health.windows.length >= 2 && (
        <div className="space-y-3">
          <MetricRow
            label="CRC failure"
            unit="%"
            windows={health.windows}
            valueFn={(w) => w.corruptPct}
            slope={health.corruptPctSlopePerDay}
            slopeUnit="%/d"
            slopeDirection="down-is-good"
          />
          {health.powerSlopePerDayDbm !== null && (
            <MetricRow
              label="Signal power"
              unit="dBm"
              windows={health.windows}
              valueFn={(w) => w.meanPowerDbm}
              slope={health.powerSlopePerDayDbm}
              slopeUnit="dBm/d"
              slopeDirection="up-is-good"
            />
          )}
          {health.frequencySlopePerDayHz !== null && (
            <MetricRow
              label="Freq offset"
              unit="Hz"
              windows={health.windows}
              valueFn={(w) => w.meanFrequencyOffsetHz}
              slope={health.frequencySlopePerDayHz}
              slopeUnit="Hz/d"
              slopeDirection="none"
            />
          )}
        </div>
      )}
    </div>
  );
}

function MetricRow({
  label,
  unit,
  windows,
  valueFn,
  slope,
  slopeUnit,
  slopeDirection,
}: {
  label: string;
  unit: string;
  windows: TransmissionHealthWindow[];
  valueFn: (w: TransmissionHealthWindow) => number | null;
  slope: number;
  slopeUnit: string;
  /** Which direction of slope is good — controls color coding of the slope value */
  slopeDirection: 'up-is-good' | 'down-is-good' | 'none';
}) {
  const values = windows.map(valueFn);
  const numericValues = values.filter((v): v is number => v !== null);
  if (numericValues.length < 2) return null;

  const min = Math.min(...numericValues);
  const max = Math.max(...numericValues);
  const latest = numericValues[numericValues.length - 1];

  let slopeColor = 'text-muted';
  if (slopeDirection === 'down-is-good') {
    slopeColor = slope > 0.5 ? 'text-error' : slope < -0.5 ? 'text-success' : 'text-muted';
  } else if (slopeDirection === 'up-is-good') {
    slopeColor = slope > 0.5 ? 'text-success' : slope < -0.5 ? 'text-error' : 'text-muted';
  }

  return (
    <div className="text-sm">
      <div className="flex items-baseline justify-between mb-1">
        <span className="text-muted text-xs uppercase tracking-wide">{label}</span>
        <span className="text-xs">
          <span className="font-mono">
            {latest.toFixed(label === 'Freq offset' ? 0 : 1)} {unit}
          </span>
          <span className={`ml-2 font-mono ${slopeColor}`}>
            {slope > 0 ? '+' : ''}
            {slope.toFixed(label === 'Freq offset' ? 0 : 2)} {slopeUnit}
          </span>
        </span>
      </div>
      <Sparkline values={values} min={min} max={max} />
    </div>
  );
}

function Sparkline({
  values,
  min,
  max,
}: {
  values: (number | null)[];
  min: number;
  max: number;
}) {
  const width = 200;
  const height = 28;
  const range = Math.max(max - min, 0.0001);
  const n = values.length;
  const stepX = n > 1 ? width / (n - 1) : 0;

  const points = values
    .map((v, i) => {
      if (v === null) return null;
      const x = i * stepX;
      const y = height - ((v - min) / range) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .filter((s): s is string => s !== null)
    .join(' ');

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-7 text-primary"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
