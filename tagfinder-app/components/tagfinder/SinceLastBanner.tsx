'use client';

import type { SinceLast } from '@/analysis/sinceLast';
import { History } from 'lucide-react';

/** What changed since this user last analysed the same tag — see analysis/sinceLast.ts. */
export default function SinceLastBanner({ since }: { since: SinceLast }) {
  const moved = since.items.some((i) => i.kind === 'moved');
  const when = since.previousAnalysisAt.toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <div
      className={`rounded-xl border p-4 text-sm ${moved ? 'bg-warning/10 border-warning/30' : 'bg-surface border-border'}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <History className="w-4 h-4 text-primary" />
        <span className="font-semibold">Since your last analysis</span>
        <span className="text-muted text-xs">({when})</span>
      </div>
      <ul className="space-y-0.5">
        {since.items.map((i) => (
          <li key={i.kind} className={i.kind === 'moved' ? 'font-semibold' : ''}>
            {i.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
