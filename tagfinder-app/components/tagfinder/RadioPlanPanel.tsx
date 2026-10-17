'use client';

import type { RadioPlan } from '@/analysis/radioPlan';
import { Radio } from 'lucide-react';

/** Radio direction-finding plan: frequency, interval, listening spots, steps. */
export default function RadioPlanPanel({ plan }: { plan: RadioPlan }) {
  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-1">
        <Radio className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Radio Direction-Finding</h3>
      </div>
      <p className="text-sm mb-3">{plan.headline}</p>

      <div className="grid grid-cols-3 gap-3 text-sm mb-3">
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Frequency</div>
          <div className="font-mono font-medium">
            {plan.frequencyMHz ? `${plan.frequencyMHz.toFixed(3)} MHz` : '401.650 ± 0.03'}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Burst every</div>
          <div className="font-mono font-medium">{plan.periodS ? `${plan.periodS} s` : 'not measured'}</div>
        </div>
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Listen per spot</div>
          <div className="font-mono font-medium">{Math.round(plan.dwellS / 60)} min</div>
        </div>
      </div>

      <table className="w-full text-xs mb-3">
        <thead>
          <tr className="text-muted text-left">
            <th className="py-1 pr-2 font-medium">Spot</th>
            <th className="py-1 pr-2 font-medium">Side</th>
            <th className="py-1 pr-2 font-medium">Lat, lon</th>
            <th className="py-1 pr-2 font-medium text-right">Bearing to tag (true)</th>
            <th className="py-1 font-medium text-right">Distance</th>
          </tr>
        </thead>
        <tbody className="font-mono">
          {plan.stations.map((s) => (
            <tr key={s.id} className="border-t border-border">
              <td className="py-1 pr-2">{s.id}</td>
              <td className="py-1 pr-2 font-sans">{s.side}</td>
              <td className="py-1 pr-2">
                {s.lat.toFixed(4)}, {s.lon.toFixed(4)}
              </td>
              <td className="py-1 pr-2 text-right">{s.bearingDeg}°</td>
              <td className="py-1 text-right">{s.distanceM} m</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-muted mb-3">
        Use the nearest public road, path or beach access to each spot; where a spot falls in water,
        the nearest point of shore on that side. Bearings are true; most phone compasses can be set
        to true north.
      </p>

      <ol className="list-decimal pl-5 space-y-1.5 text-sm text-muted">
        {plan.steps.map((s, k) => (
          <li key={k}>{s}</li>
        ))}
      </ol>

      {plan.gear.length > 0 && (
        <div className="mt-4">
          <div className="text-xs text-muted uppercase tracking-wide mb-1.5">Settings for your receiver</div>
          <div className="space-y-1.5">
            {plan.gear.map((g) => (
              <details key={g.id} className="rounded-lg border border-border px-3 py-2">
                <summary className="cursor-pointer text-sm font-medium">{g.name}</summary>
                <p className="text-xs text-muted mt-1.5">{g.summary}</p>
                <ul className="list-disc pl-5 mt-1.5 space-y-1 text-sm text-muted">
                  {g.settings.map((s, k) => (
                    <li key={k}>{s}</li>
                  ))}
                </ul>
                <p className="text-sm mt-2">
                  <span className="font-medium">Check it&apos;s your tag:</span> {g.verify}
                </p>
              </details>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
