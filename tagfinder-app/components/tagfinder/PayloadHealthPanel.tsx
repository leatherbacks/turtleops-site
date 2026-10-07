'use client';

import type { PayloadHealth } from '@/lib/types';
import { FileWarning } from 'lucide-react';

/**
 * The sensor stream's own checksums, per day. The Data Quality panel can only
 * say "corrupted: not reported" for a CLS export; this is where a reader
 * learns that the dive payloads went unreadable on a date while the fixes
 * carried on, and therefore that no temperature or depth on the page is newer
 * than that date.
 */
export default function PayloadHealthPanel({ health }: { health: PayloadHealth }) {
  const meta = {
    readable: { label: 'Readable', color: 'text-success bg-success/10 border-success/20' },
    degraded: { label: 'Degraded', color: 'text-warning bg-warning/10 border-warning/20' },
    unreadable: { label: 'Unreadable', color: 'text-error bg-error/10 border-error/20' },
  }[health.verdict];
  const days = health.daily.slice(-14);
  const max = Math.max(1, ...days.map((d) => d.messages));

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <FileWarning className="w-5 h-5 text-orange-400" />
          <h3 className="font-semibold">Sensor Payloads</h3>
        </div>
        <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${meta.color}`}>
          {meta.label.toUpperCase()}
        </span>
      </div>
      <p className="text-sm text-muted mb-3">{health.reasoning}</p>
      <div className="grid grid-cols-3 gap-3 text-sm mb-3">
        <div>
          <div className="text-xs text-muted uppercase">Pass rate, last days</div>
          <div className="font-mono font-medium">{(100 * health.recentPassRate).toFixed(health.recentPassRate < 0.01 ? 1 : 0)}%</div>
        </div>
        <div>
          <div className="text-xs text-muted uppercase">Whole record</div>
          <div className="font-mono font-medium">{(100 * health.overallPassRate).toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-xs text-muted uppercase">{health.unreadableSince ? 'Unreadable since' : 'Last readable day'}</div>
          <div className="font-mono font-medium">{health.unreadableSince ?? health.lastReadableDay ?? '—'}</div>
        </div>
      </div>
      <div className="flex items-end gap-1 h-12" aria-label="Checksum pass rate by day, most recent on the right">
        {days.map((d) => (
          <div key={d.day} className="flex-1 flex flex-col justify-end" title={`${d.day}: ${(100 * d.passRate).toFixed(0)}% of ${d.messages}`}>
            <div
              className={`w-full rounded-sm ${d.passRate >= 0.25 ? 'bg-success/70' : d.passRate >= 0.05 ? 'bg-warning/70' : 'bg-error/70'}`}
              style={{ height: `${Math.max(6, (100 * d.messages) / max)}%` }}
            />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-xs text-muted mt-1">
        <span>{days[0]?.day}</span>
        <span>bar height = messages that day · colour = share passing checksum</span>
        <span>{days[days.length - 1]?.day}</span>
      </div>
    </div>
  );
}
