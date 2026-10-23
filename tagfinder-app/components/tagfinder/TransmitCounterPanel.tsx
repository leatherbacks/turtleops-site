'use client';

import type { TransmitCounter, DryVerdict } from '@/analysis/transmitCounter';
import { Radio } from 'lucide-react';

const VERDICT: Record<DryVerdict, { label: string; color: string }> = {
  dry: { label: 'Dry', color: 'text-success bg-success/10 border-success/20' },
  mostly_dry: { label: 'Mostly dry', color: 'text-success bg-success/10 border-success/20' },
  partly_wet: { label: 'Partly wet', color: 'text-warning bg-warning/10 border-warning/20' },
  wet: { label: 'Wet', color: 'text-error bg-error/10 border-error/20' },
};

// UTC, as in the reasoning above the table.
const stamp = (d: Date) =>
  `${d.toLocaleString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })} ${d.toISOString().slice(11, 16)}Z`;
const pct = (x: number | null) => (x === null ? '—' : `${(x * 100).toFixed(x < 0.1 ? 1 : 0)}%`);

export default function TransmitCounterPanel({ counter }: { counter: TransmitCounter }) {
  const v = counter.latest?.verdict ? VERDICT[counter.latest.verdict] : null;
  const rows = counter.windows.slice(-8);
  const hasStop = counter.windows.some((w) => w.resting);
  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <Radio className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Dry or wet: the tag&apos;s own transmit count</h3>
      </div>
      <p className="text-xs text-muted mb-3">
        The tag counts every transmission it makes, heard or not, and transmits only when dry. The count between
        status messages is time out of the water.
      </p>

      {v && (
        <div className="mb-3">
          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-semibold border ${v.color}`}>
            {v.label.toUpperCase()} · {pct(counter.latest!.dryFraction)} OF THE TIME
          </span>
        </div>
      )}

      <p className="text-sm text-muted mb-3">{counter.reasoning}</p>

      {rows.length >= 2 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="text-left text-muted uppercase">
                <th className="pr-3 pb-1">From</th>
                <th className="pr-3 pb-1">To</th>
                <th className="pr-3 pb-1 text-right">Hours</th>
                <th className="pr-3 pb-1 text-right">Sent</th>
                <th className="pr-3 pb-1 text-right">Dry</th>
                <th className="pb-1 text-right">Heard</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.from.toISOString()} className={`border-t border-border/50 ${hasStop && !w.resting ? 'text-muted' : ''}`}>
                  <td className="pr-3 py-1">{stamp(w.from)}</td>
                  <td className="pr-3 py-1">{stamp(w.to)}</td>
                  <td className="pr-3 py-1 text-right">{w.hours.toFixed(0)}</td>
                  <td className="pr-3 py-1 text-right">{w.sent.toLocaleString()}</td>
                  <td className="pr-3 py-1 text-right">{pct(w.dryFraction)}</td>
                  <td className="py-1 text-right">{pct(w.heardPerSent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-muted mt-2">
            Heard = share of the tag&apos;s transmissions satellites received.
            {hasStop && ' Greyed rows are before it stopped moving.'}
          </p>
        </div>
      )}
    </div>
  );
}
