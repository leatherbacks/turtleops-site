'use client';

import type { UnderwaterAfterRelease } from '@/analysis/underwaterAfterRelease';
import { Waves } from 'lucide-react';

export default function UnderwaterAfterReleasePanel({ finding }: { finding: UnderwaterAfterRelease }) {
  return (
    <div className="bg-surface rounded-xl border border-warning/40 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Waves className="w-5 h-5 text-warning" />
        <h3 className="font-semibold">Underwater after release</h3>
      </div>
      <div className="mb-3">
        <span className="inline-flex px-3 py-1 rounded-full text-xs font-semibold border text-warning bg-warning/10 border-warning/20">
          SUNK, NOT FLOATING
        </span>
      </div>
      <p className="text-sm text-muted">{finding.reasoning}</p>
      <p className="text-xs text-muted mt-2">
        {finding.sstJudged} sea-surface temperature record{finding.sstJudged === 1 ? '' : 's'} after release checked;{' '}
        {finding.readings.length} taken underwater.
      </p>
    </div>
  );
}
