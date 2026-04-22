'use client';

import type { SatCoverage } from '@/lib/types';
import { Satellite } from 'lucide-react';

interface SatCoveragePanelProps {
  coverage: SatCoverage;
}

export default function SatCoveragePanel({ coverage }: SatCoveragePanelProps) {
  const healthColors: Record<SatCoverage['health'], string> = {
    healthy: 'text-success bg-success/10 border-success/20',
    marginal: 'text-warning bg-warning/10 border-warning/20',
    poor: 'text-error bg-error/10 border-error/20',
    unknown: 'text-muted bg-surface-elevated border-border',
  };

  const rate = (coverage.receptionRate * 100).toFixed(1);
  const ascRate = coverage.ascendingPredicted > 0
    ? ((coverage.ascendingReceived / coverage.ascendingPredicted) * 100).toFixed(0)
    : '—';
  const descRate = coverage.descendingPredicted > 0
    ? ((coverage.descendingReceived / coverage.descendingPredicted) * 100).toFixed(0)
    : '—';

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Satellite className="w-5 h-5 text-info" />
        <h3 className="font-semibold">Satellite Coverage</h3>
        <span
          className={`ml-auto inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${healthColors[coverage.health]}`}
        >
          {coverage.health.toUpperCase()}
        </span>
      </div>

      <p className="text-sm text-muted mb-3">{coverage.diagnosis}</p>

      <div className="grid grid-cols-3 gap-3 text-sm mb-4">
        <Stat label="Predicted passes" value={coverage.totalPredicted.toString()} />
        <Stat label="Received" value={coverage.totalReceived.toString()} />
        <Stat label="Reception rate" value={`${rate}%`} />
      </div>

      {coverage.perSat.length > 0 && (
        <div className="mb-4">
          <div className="text-xs text-muted uppercase tracking-wide mb-2">
            Per satellite
          </div>
          <div className="space-y-1.5">
            {coverage.perSat.map((s) => {
              const pct = (s.rate * 100).toFixed(0);
              return (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <span className="w-20 font-mono">{s.name}</span>
                  <div className="flex-1 bg-surface-elevated rounded-full h-2 overflow-hidden">
                    <div
                      className="h-full bg-info"
                      style={{ width: `${s.rate * 100}%` }}
                    />
                  </div>
                  <span className="w-20 text-right font-mono text-muted">
                    {s.received}/{s.predicted} ({pct}%)
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {(coverage.ascendingPredicted > 0 || coverage.descendingPredicted > 0) && (
        <div>
          <div className="text-xs text-muted uppercase tracking-wide mb-2">
            Direction bias
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <span className="text-muted">↑ Northbound:</span>{' '}
              <span className="font-mono">
                {coverage.ascendingReceived}/{coverage.ascendingPredicted} ({ascRate}%)
              </span>
            </div>
            <div>
              <span className="text-muted">↓ Southbound:</span>{' '}
              <span className="font-mono">
                {coverage.descendingReceived}/{coverage.descendingPredicted} ({descRate}%)
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted uppercase tracking-wide">{label}</div>
      <div className="font-mono font-medium text-lg">{value}</div>
    </div>
  );
}
