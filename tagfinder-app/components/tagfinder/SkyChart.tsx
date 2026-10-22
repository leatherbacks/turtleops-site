'use client';

import type { AnnotatedPass, AntennaExposure } from '@/lib/types';
import { Satellite } from 'lucide-react';

interface SkyChartProps {
  passes: AnnotatedPass[];
  exposure?: AntennaExposure | null;
  /** Which period of the record the arcs come from. */
  windowLabel?: string;
}

const SIZE = 320;
const CENTER = SIZE / 2;
const RADIUS = SIZE / 2 - 20;

/**
 * Polar sky chart: N at top, E at right.
 * Elevation 0° (horizon) at the outer edge, 90° (zenith) at center.
 */
export default function SkyChart({ passes, exposure, windowLabel }: SkyChartProps) {
  if (passes.length === 0) return null;

  const received = passes.filter((p) => p.received);
  const missed = passes.filter((p) => !p.received);
  // With message times the heard stretch of each arc is drawn, not the whole
  // arc: a tag under a roof is heard near the top of most passes, and a
  // whole green arc reads as open sky.
  const located = received.some((p) => (p.heardPoints?.length ?? 0) > 0);

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
      {windowLabel && <p className="text-xs text-muted font-mono mb-2">{windowLabel}</p>}

      <p className="text-xs text-muted mb-4">
        Each arc shows a satellite&apos;s path across the sky over the tag&apos;s
        position.{' '}
        {located
          ? 'Green marks where on the arc its messages came through; grey is the rest of a heard pass; red passes heard nothing.'
          : 'Green = signal received, red = signal missed.'}{' '}
        Directional bias (e.g., all received from one side) suggests antenna obstruction.
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
          {exposure.orientation && exposure.orientation.confidence > 0.3 && (
            <div className="mt-2 pt-2 border-t border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted">
                  Likely physical orientation
                </span>
                <span className="text-xs text-muted">
                  {(exposure.orientation.confidence * 100).toFixed(0)}% confidence ·{' '}
                  {exposure.orientation.passCount} passes
                </span>
              </div>
              <p className="text-xs text-muted">{exposure.orientation.description}</p>
            </div>
          )}
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

          {/* Blocked half of the sky — a wall, building or bank on that side.
              A fill would vanish under the missed arcs, so it is a divider
              across the disc and a label at the blocked rim. */}
          {exposure?.obstruction && (() => {
            const t = ((exposure.obstruction.towardDeg - 90) * Math.PI) / 180;
            const x1 = CENTER + RADIUS * Math.cos(t - Math.PI / 2);
            const y1 = CENTER + RADIUS * Math.sin(t - Math.PI / 2);
            const x2 = CENTER + RADIUS * Math.cos(t + Math.PI / 2);
            const y2 = CENTER + RADIUS * Math.sin(t + Math.PI / 2);
            const lx = CENTER + (RADIUS - 22) * Math.cos(t);
            const ly = CENTER + (RADIUS - 22) * Math.sin(t);
            return (
              <>
                <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.85)" strokeWidth={1.5} strokeDasharray="5,4" />
                <rect x={lx - 26} y={ly - 8} width={52} height={16} rx={4} fill="rgba(0,0,0,0.75)" />
                <text x={lx} y={ly + 0.5} textAnchor="middle" dominantBaseline="middle" fontSize={9} fontWeight={600} fill="#fff">
                  {exposure.obstruction.toward} blocked
                </text>
              </>
            );
          })()}

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
          {received.map((pass, i) =>
            located && (pass.heardPoints?.length ?? 0) > 0 ? (
              <HeardArc key={`r-${i}`} pass={pass} />
            ) : (
              <PassArc key={`r-${i}`} pass={pass} color="#10b981" />
            )
          )}
        </svg>
      </div>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <div className={`w-3 ${located ? 'h-1' : 'h-0.5'} bg-success`} />
          {located ? 'Messages came through' : 'Received'}
        </span>
        {located && (
          <span className="flex items-center gap-1.5">
            <div className="w-3 h-0.5 bg-gray-400" />
            Rest of a heard pass
          </span>
        )}
        <span className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-error" />
          Missed
        </span>
      </div>
    </div>
  );
}

/** Elevation 0 at the edge, 90 at the centre; N up. */
function toXY(azimuth: number, elevation: number): [number, number] {
  const r = RADIUS * (1 - elevation / 90);
  const theta = ((azimuth - 90) * Math.PI) / 180;
  return [CENTER + r * Math.cos(theta), CENTER + r * Math.sin(theta)];
}

/** A heard pass: the whole arc faint, the stretch where messages arrived bold, a dot per message. */
function HeardArc({ pass }: { pass: AnnotatedPass }) {
  if (pass.trackPoints.length < 2) return null;
  const arc = pass.trackPoints.map((p) => toXY(p.azimuth, p.elevation));
  const heard = (pass.heardPoints ?? []).map((p) => toXY(p.azimuth, p.elevation));
  const d = (pts: [number, number][]) =>
    pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  return (
    <g>
      <path d={d(arc)} fill="none" stroke="#9ca3af" strokeWidth={1} strokeLinecap="round" opacity={0.45} />
      {heard.length > 1 && (
        <path d={d(heard)} fill="none" stroke="#10b981" strokeWidth={3.5} strokeLinecap="round" opacity={0.9} />
      )}
      {heard.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.2} fill="#10b981" />
      ))}
    </g>
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
