'use client';

import type { FateResult } from '@/hooks/useAnalysis';
import { Fish } from 'lucide-react';

const SOURCE = {
  wc_archive: 'the recovered tag’s archive',
  wc_series: 'the transmitted depth and temperature series',
  lotek_archive: 'the recovered tag’s archive',
  lotek_dive: 'the transmitted dive log',
} as const;

const VERDICT = {
  seabed: { label: 'On the seabed', cls: 'bg-primary/10 text-primary' },
  carried: { label: 'Carried by an animal', cls: 'bg-warning/10 text-warning' },
  unclear: { label: 'Unclear', cls: 'bg-muted/10 text-muted' },
} as const;

/** Findings worth a panel: anything found, or a recovered archive (where "nothing" is itself the answer). */
export function hasFateFindings(fate: FateResult): boolean {
  return fate.signatures.warmBody.length > 0 || fate.signatures.submerged.length > 0;
}

export default function FatePanel({ fate }: { fate: FateResult }) {
  const { warmBody, submerged, floatingFrom } = fate.signatures;
  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <Fish className="w-5 h-5 text-muted" />
        <h3 className="font-semibold">Swallowed, carried or on the seabed</h3>
      </div>
      <p className="text-xs text-muted mb-3">
        From {SOURCE[fate.source]}. A tag well above the warmest water it had been in is inside a warm-bodied
        predator. After it has floated free, a tag below the surface whose depth carries over from one reading to the
        next is being carried; one whose depth only jitters with the swell is lying on the bottom.
      </p>

      {warmBody.length > 0 && (
        <div className="space-y-2 mb-3">
          {fate.signatures.summary.slice(0, warmBody.length).map((line, i) => (
            <div key={i} className="rounded-lg bg-warning/10 border border-warning/30 p-3 text-sm">
              <div className="font-semibold text-warning mb-1">Warm body — swallowed by a predator</div>
              {line}
            </div>
          ))}
        </div>
      )}

      {submerged.map((s, i) => (
        <div key={i} className="rounded-lg border border-border p-3 text-sm mb-2">
          <span className={`inline-block text-xs font-semibold rounded px-2 py-0.5 mb-1 ${VERDICT[s.verdict].cls}`}>
            {VERDICT[s.verdict].label}
          </span>
          <p>{s.reasoning}</p>
        </div>
      ))}

      {warmBody.length === 0 && (
        <p className="text-sm text-muted">No warm-body stretch: the tag never ran well above the water around it.</p>
      )}
      {fate.seabedTested && submerged.length === 0 && (
        <p className="text-sm text-muted mt-1">
          {floatingFrom
            ? `After it floated free (${floatingFrom.toUTCString().slice(5, 22)} UTC) it never stayed below 3 m for three hours.`
            : 'The record never shows the tag floating free, so there is nothing to test for the seabed.'}
        </p>
      )}
      {!fate.seabedTested && (
        <p className="text-sm text-muted mt-1">
          The seabed test needs depth after release, and a Lotek tag&apos;s pressure reading means nothing once the
          release has fired.
        </p>
      )}
    </div>
  );
}
