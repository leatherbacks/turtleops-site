'use client';

import { useState } from 'react';
import type { AntennaExposure, SatCoverage } from '@/lib/types';
import SatCoveragePanel from './SatCoveragePanel';
import SkyChart from './SkyChart';

/**
 * Satellite coverage and the sky view, in two windows: since the tag stopped,
 * and while it was afloat. One panel, one switch. The resting window is the
 * default whenever it has enough passes to say anything, because it is the
 * only window that describes where the tag is now; the float is kept one click
 * away as context, not stacked beneath as a second verdict.
 */

/** Fewer serving passes than this and the resting window is reported but not charted. */
export const MIN_RESTING_PASSES = 6;

interface SkySectionProps {
  afloat: SatCoverage;
  afloatExposure: AntennaExposure | null;
  resting: SatCoverage | null;
  restingExposure: AntennaExposure | null;
  restingSince: Date | null;
  windowEnd: Date | null;
  firstFix: Date | null;
}

const stamp = (d: Date | null) =>
  d ? d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : '';
const day = (d: Date | null) =>
  d ? d.toLocaleDateString([], { day: 'numeric', month: 'short' }) : '';

export default function SkySection({
  afloat,
  afloatExposure,
  resting,
  restingExposure,
  restingSince,
  windowEnd,
  firstFix,
}: SkySectionProps) {
  const restingUsable = !!(resting && resting.totalPredicted >= MIN_RESTING_PASSES);
  const [view, setView] = useState<'resting' | 'afloat'>(restingUsable ? 'resting' : 'afloat');
  const showResting = view === 'resting' && restingUsable && resting;
  const coverage = showResting ? resting! : afloat;
  const exposure = showResting ? restingExposure : afloatExposure;
  const windowLabel = showResting
    ? `Since it stopped · ${stamp(restingSince)} → ${windowEnd ? stamp(windowEnd) : 'last message'}`
    : restingSince
      ? `Afloat · ${day(firstFix)} → ${day(restingSince)}`
      : `Whole record · ${day(firstFix)} → ${day(windowEnd)}`;
  const other = showResting ? afloat : resting;
  const pct = (c: SatCoverage) => `${(100 * c.receptionRate).toFixed(0)}%`;

  return (
    <div className="space-y-4">
      {resting && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted uppercase tracking-wide">Sky window</span>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setView('resting')}
              disabled={!restingUsable}
              className={`px-3 py-1.5 ${view === 'resting' ? 'bg-info/15 text-foreground font-semibold' : 'text-muted'} disabled:opacity-50`}
              title={restingUsable ? '' : `Only ${resting.totalPredicted} passes since it stopped — too few to chart yet`}
            >
              Since it stopped
            </button>
            <button
              type="button"
              onClick={() => setView('afloat')}
              className={`px-3 py-1.5 border-l border-border ${view === 'afloat' ? 'bg-info/15 text-foreground font-semibold' : 'text-muted'}`}
            >
              Afloat
            </button>
          </div>
          <span className="text-muted">
            {restingUsable
              ? `the tag stopped moving at ${stamp(restingSince)}; the sky it sees now is the one that matters`
              : `stopped at ${stamp(restingSince)} — ${resting.totalReceived} of ${resting.totalPredicted} passes heard since, too few to chart; showing the float`}
          </span>
        </div>
      )}

      <SatCoveragePanel coverage={coverage} windowLabel={windowLabel} />
      {coverage.passes.length > 0 && <SkyChart passes={coverage.passes} exposure={exposure} windowLabel={windowLabel} />}

      {other && other.totalPredicted > 0 && (
        <p className="text-xs text-muted px-1">
          {showResting
            ? `Afloat, ${day(firstFix)} to ${day(restingSince)}: ${other.totalReceived} of ${other.totalPredicted} passes heard (${pct(other)}). That figure describes the float, not this place.`
            : `Since it stopped at ${stamp(restingSince)}: ${other.totalReceived} of ${other.totalPredicted} passes heard (${pct(other)}).`}
        </p>
      )}
    </div>
  );
}
