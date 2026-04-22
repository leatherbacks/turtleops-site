'use client';

import type { MirrorCheck } from '@/lib/types';
import { AlertTriangle, Satellite } from 'lucide-react';

interface MirrorCheckPanelProps {
  mirror: MirrorCheck;
}

export default function MirrorCheckPanel({ mirror }: MirrorCheckPanelProps) {
  // Only show when we have a meaningful finding
  if (mirror.verdict === 'no_secondaries' || mirror.verdict === 'insufficient_data') {
    return null;
  }

  if (mirror.verdict === 'primaries_consistent') {
    // Silent success — don't clutter the UI
    return null;
  }

  // Mirror flip detected — show the warning
  return (
    <div className="bg-surface rounded-xl border border-warning/30 p-5">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="w-5 h-5 text-warning" />
        <h3 className="font-semibold">Mirror Solution Detected</h3>
        <span className="text-xs text-muted ml-auto">Obstructed antenna</span>
      </div>

      <p className="text-sm text-muted mb-3">{mirror.reasoning}</p>

      <div className="grid grid-cols-2 gap-3 text-sm mb-3">
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Primary spread</div>
          <div className="font-mono font-medium text-error">
            {mirror.primarySpreadKm.toFixed(1)} km
          </div>
        </div>
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Secondary spread</div>
          <div className="font-mono font-medium text-success">
            {mirror.secondarySpreadKm.toFixed(1)} km
          </div>
        </div>
      </div>

      {mirror.correctedLat !== null && mirror.correctedLon !== null && (
        <div className="bg-surface-elevated rounded-lg p-3">
          <div className="flex items-center gap-2 mb-1">
            <Satellite className="w-3.5 h-3.5 text-success" />
            <span className="text-xs font-semibold uppercase tracking-wide text-success">
              Likely true position
            </span>
          </div>
          <div className="font-mono font-medium">
            {Math.abs(mirror.correctedLat).toFixed(4)}°
            {mirror.correctedLat >= 0 ? 'N' : 'S'},{' '}
            {Math.abs(mirror.correctedLon).toFixed(4)}°
            {mirror.correctedLon >= 0 ? 'E' : 'W'}
          </div>
          <div className="text-xs text-muted mt-1">
            Recovery teams should focus here, not on the primary-position spread.
          </div>
        </div>
      )}
    </div>
  );
}
