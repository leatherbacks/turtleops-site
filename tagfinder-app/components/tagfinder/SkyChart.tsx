'use client';

import type { AnnotatedPass, AntennaExposure } from '@/lib/types';
import { Satellite } from 'lucide-react';

interface SkyChartProps {
  passes: AnnotatedPass[];
  exposure?: AntennaExposure | null;
}

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 20;

/**
 * Polar sky chart: N at top, E at right.
 * Elevation 0° (horizon) at the outer edge, 90° (zenith) at center.
 */
export default function SkyChart({ passes, exposure }: SkyChartProps) {
  if (passes.length === 0) return null;

  const received = passes.filter((p) => p.received);
  const missed = passes.filter((p) => !p.received);

  // Compute cone inner radius (in SVG units) from elevation cutoff.
  // Elevation 0° is at outer edge (r=RADIUS), 90° at center (r=0).
  // The "cone of visibility" is the area INSIDE the cutoff elevation circle.
  const coneRadius =
    exposure?.elevationCutoffDeg !== null && exposure?.elevationCutoffDeg !== undefined
      ? RADIUS * (1 - exposure.elevationCutoffDeg / 90)
      : null;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Satellite className="w-5 h-5 text-info" />
        <h3 className="font-semibold">Satellite Sky View</h3>
        <span className="text-xs text-muted ml-auto">
          {received.length} received / {missed.length} missed
        </span>
      </div>

      <p className="text-xs text-muted mb-4">
        Each arc shows a satellite&apos;s path across the sky over the tag&apos;s
        position. Green = signal received, red = signal missed. Directional
        bias (e.g., all received from one side) suggests antenna obstruction.
      </p>

      {exposure && exposure.pattern !== 'too_few_passes' && exposure.pattern !== 'unknown' && (
        <div className="mb-4 p-3 rounded-lg bg-surface-elevated text-sm">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">
              Antenna exposure
            </span>
            <span className="text-xs text-muted">
              {(exposure.confidence * 100).toFixed(0)}% confidence
            </span>
          </div>
          <p className="text-xs text-muted">{exposure.reasoning}</p>
        </div>
      )}

      <div className="flex justify-center">
        <svg
          width={SIZE}
          height={SIZE}
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="max-w-full h-auto"
        >
          {/* Elevation rings */}
          {[30, 60].map((el) => {
            const r = RADIUS * (1 - el / 90);
            return (
              <circle
                key={el}
                cx={CENTER}
                cy={CENTER}
                r={r}
                fill="none"
                stroke="rgba(255,255,255,0.08)"
                strokeWidth={1}
                strokeDasharray="2,3"
              />
            );
          })}
          {/* Horizon circle */}
          <circle
            cx={CENTER}
            cy={CENTER}
            r={RADIUS}
            fill="rgba(0,0,0,0.2)"
            stroke="rgba(255,255,255,0.2)"
            strokeWidth={1.5}
          />

          {/* Sky cone of visibility — only the area INSIDE this circle is seen */}
          {coneRadius !== null && (
            <>
              <defs>
                <mask id="skyConeMask">
                  <rect width={SIZE} height={SIZE} fill="white" />
                  <circle cx={CENTER} cy={CENTER} r={coneRadius} fill="black" />
                </mask>
              </defs>
              <circle
                cx={CENTER}
                cy={CENTER}
                r={RADIUS}
                fill="rgba(239, 68, 68, 0.12)"
                mask="url(#skyConeMask)"
              />
              <circle
                cx={CENTER}
                cy={CENTER}
                r={coneRadius}
                fill="none"
                stroke="rgba(16, 185, 129, 0.6)"
                strokeWidth={1.5}
                strokeDasharray="4,3"
              />
              <text
                x={CENTER}
                y={CENTER - coneRadius - 4}
                fill="rgba(16, 185, 129, 0.8)"
                fontSize="9"
                textAnchor="middle"
              >
                visibility cone
              </text>
            </>
          )}

          {/* Cardinal axes */}
          <line
            x1={CENTER}
            y1={CENTER - RADIUS}
            x2={CENTER}
            y2={CENTER + RADIUS}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />
          <line
            x1={CENTER - RADIUS}
            y1={CENTER}
            x2={CENTER + RADIUS}
            y2={CENTER}
            stroke="rgba(255,255,255,0.06)"
            strokeWidth={1}
          />

          {/* Cardinal labels */}
          <text x={CENTER} y={14} fill="rgba(255,255,255,0.5)" fontSize="11" textAnchor="middle" fontWeight="600">N</text>
          <text x={SIZE - 10} y={CENTER + 4} fill="rgba(255,255,255,0.5)" fontSize="11" textAnchor="middle" fontWeight="600">E</text>
          <text x={CENTER} y={SIZE - 4} fill="rgba(255,255,255,0.5)" fontSize="11" textAnchor="middle" fontWeight="600">S</text>
          <text x={10} y={CENTER + 4} fill="rgba(255,255,255,0.5)" fontSize="11" textAnchor="middle" fontWeight="600">W</text>

          {/* Elevation labels */}
          <text x={CENTER + 2} y={CENTER - RADIUS * (1 - 30 / 90) - 2} fill="rgba(255,255,255,0.25)" fontSize="9">30°</text>
          <text x={CENTER + 2} y={CENTER - RADIUS * (1 - 60 / 90) - 2} fill="rgba(255,255,255,0.25)" fontSize="9">60°</text>
          <text x={CENTER + 2} y={CENTER - 2} fill="rgba(255,255,255,0.25)" fontSize="9">90°</text>

          {/* Arcs for missed passes (drawn first, behind) */}
          {missed.map((pass, i) => (
            <PassArc key={`m-${i}`} pass={pass} color="#ef4444" />
          ))}

          {/* Arcs for received passes (drawn on top) */}
          {received.map((pass, i) => (
            <PassArc key={`r-${i}`} pass={pass} color="#10b981" />
          ))}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-success" />
          Received
        </span>
        <span className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-error" />
          Missed
        </span>
      </div>
    </div>
  );
}

function PassArc({ pass, color }: { pass: AnnotatedPass; color: string }) {
  if (pass.trackPoints.length < 2) return null;

  const points = pass.trackPoints.map(({ azimuth, elevation }) => {
    // Convert az/el to SVG coords: N=top (90° angle from +x axis),
    // elevation 0 at edge (r=RADIUS), 90 at center (r=0)
    const r = RADIUS * (1 - elevation / 90);
    const theta = ((azimuth - 90) * Math.PI) / 180; // 0° = N, rotate so N is up
    const x = CENTER + r * Math.cos(theta);
    const y = CENTER + r * Math.sin(theta);
    return [x, y];
  });

  const path = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

  // Peak point (for marker)
  const peakIdx = pass.trackPoints.reduce(
    (maxI, p, i) =>
      p.elevation > pass.trackPoints[maxI].elevation ? i : maxI,
    0
  );
  const peak = points[peakIdx];

  return (
    <g>
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        opacity={0.85}
      />
      <circle
        cx={peak[0]}
        cy={peak[1]}
        r={2.5}
        fill={color}
        opacity={0.95}
      />
    </g>
  );
}
