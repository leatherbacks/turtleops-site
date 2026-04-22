'use client';

import type { PopoffResult } from '@/lib/types';
import { Target, AlertTriangle } from 'lucide-react';

interface PopoffEstimatePanelProps {
  popoff: PopoffResult;
}

export default function PopoffEstimatePanel({ popoff }: PopoffEstimatePanelProps) {
  const coordStr = `${Math.abs(popoff.lat).toFixed(4)}°${popoff.lat >= 0 ? 'N' : 'S'}, ${Math.abs(popoff.lon).toFixed(4)}°${popoff.lon >= 0 ? 'E' : 'W'}`;

  return (
    <div className="bg-surface rounded-xl border border-marker-popoff/30 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Target className="w-5 h-5 text-yellow-400" />
        <h3 className="font-semibold">Popoff Location Estimate</h3>
        <span className="text-xs text-muted bg-surface-elevated px-2 py-0.5 rounded">
          Nault et al. 2024
        </span>
      </div>

      <p className="text-sm text-muted mb-2">
        Estimated position where the animal was when the tag released.
      </p>

      <div className="mb-3">
        <span className="text-xl font-mono font-bold">{coordStr}</span>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm mb-4">
        <div>
          <span className="text-muted">Method:</span>{' '}
          <span className="font-medium capitalize">{popoff.method.replace('-', ' ')}</span>
        </div>
        <div>
          <span className="text-muted">Drift time:</span>{' '}
          <span className="font-medium">{popoff.driftTimeHours.toFixed(1)}h</span>
        </div>
        <div>
          <span className="text-muted">95% ellipse:</span>{' '}
          <span className="font-medium">
            {(popoff.ellipseSemiMajorM / 1000).toFixed(1)} × {(popoff.ellipseSemiMinorM / 1000).toFixed(1)} km
          </span>
        </div>
        <div>
          <span className="text-muted">Orientation:</span>{' '}
          <span className="font-medium">{popoff.ellipseOrientationDeg.toFixed(0)}°</span>
        </div>
      </div>

      <div className="flex items-start gap-2 text-xs text-muted bg-surface-elevated rounded-lg p-3">
        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-warning" />
        <span>
          Method validated on slow-moving benthic species (Nault et al. 2024).
          Drift behavior of your species may differ. Use as a guide, not a definitive position.
        </span>
      </div>
    </div>
  );
}
