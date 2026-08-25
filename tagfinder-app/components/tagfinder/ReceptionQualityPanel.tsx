'use client';

import type { ReceptionQuality } from '@/analysis/receptionQuality';
import { RadioTower } from 'lucide-react';

interface ReceptionQualityPanelProps {
  quality: ReceptionQuality;
}

const LABEL = {
  clear: 'Antenna clear',
  degraded: 'Partially covered',
  obstructed: 'Covered',
  insufficient: 'Not enough passes',
} as const;

/** Argos needs four messages in a pass to solve a class 1-3 position. */
const QUALITY_FIX_MESSAGES = 4;

export default function ReceptionQualityPanel({ quality }: ReceptionQualityPanelProps) {
  const { verdict, messagesPerPass, passes, resolvingFraction } = quality;

  const accent =
    verdict === 'obstructed'
      ? 'text-warning'
      : verdict === 'clear'
        ? 'text-primary'
        : 'text-muted';

  // The bar is drawn against the four-message floor rather than against the
  // best number in the dataset, because four is the only figure here with a
  // fixed meaning: below it a pass cannot produce a position worth navigating
  // on. Scale to 10 so a genuinely clear tag has somewhere to go.
  const pct = Math.min(100, (messagesPerPass / 10) * 100);
  const floorPct = (QUALITY_FIX_MESSAGES / 10) * 100;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <RadioTower className={`w-5 h-5 ${accent}`} />
        <h3 className="font-semibold">Antenna Exposure</h3>
        <span className={`text-xs uppercase tracking-wide font-semibold ml-auto ${accent}`}>
          {LABEL[verdict]}
        </span>
      </div>

      {verdict !== 'insufficient' && (
        <p className="text-2xl font-mono font-bold tracking-tight mb-1">
          {messagesPerPass.toFixed(1)}
          <span className="text-sm font-sans font-normal text-muted ml-2">
            messages per pass, across {passes} passes
          </span>
        </p>
      )}

      <p className="text-sm text-muted mb-3">{quality.reasoning}</p>

      {verdict !== 'insufficient' && (
        <>
          <div className="relative h-6 bg-border/40 rounded overflow-hidden mb-1">
            <div
              className={`absolute inset-y-0 left-0 ${
                verdict === 'obstructed'
                  ? 'bg-warning/70'
                  : verdict === 'clear'
                    ? 'bg-primary/70'
                    : 'bg-muted/50'
              }`}
              style={{ width: `${pct}%` }}
            />
            <div
              className="absolute inset-y-0 border-l-2 border-dashed border-ink/50"
              style={{ left: `${floorPct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted mb-3">
            <span>0</span>
            <span>
              ← {QUALITY_FIX_MESSAGES} messages: the minimum for a class 1–3 fix
            </span>
            <span>10</span>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <span className="text-muted">Passes reaching that floor</span>
            <span className="font-mono text-right">
              {resolvingFraction !== null ? `${(resolvingFraction * 100).toFixed(0)}%` : '—'}
            </span>
            {quality.locationYield !== null && (
              <>
                <span className="text-muted">Passes yielding a position</span>
                <span className="font-mono text-right">
                  {(quality.locationYield * 100).toFixed(0)}%
                </span>
              </>
            )}
          </div>
        </>
      )}

      <p className="text-[11px] text-muted mt-3">
        Measured from received passes only, so it works on a tag that stopped transmitting
        months ago. Calibrated against two tags recovered by hand: 2.3 messages per pass
        buried in beach sand, 5.1 lying exposed on an organic bank.
      </p>
    </div>
  );
}
