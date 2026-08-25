'use client';

import type { ArchiveOnlyResult } from '@/hooks/useAnalysis';
import DiveProfilePanel from './DiveProfilePanel';

interface ArchivePanelsProps {
  archive: ArchiveOnlyResult;
  /**
   * Standalone: an offload-only upload, where the archive is the whole result.
   * Embedded: shown beneath a full recovery analysis, display-only — the
   * analyses above it run purely on the Argos-relayed data, by design, so
   * conclusions do not change based on whether the tag is already in hand.
   */
  standalone: boolean;
  onReset?: () => void;
}

const hm = (m: number | null) =>
  m === null
    ? '—'
    : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

export default function ArchivePanels({ archive, standalone, onReset }: ArchivePanelsProps) {
  return (
    <div className={standalone ? 'max-w-3xl mx-auto space-y-4' : 'space-y-4 mt-6'}>
      <div className="bg-surface rounded-xl border border-border p-5">
        <h2 className="text-xl font-bold tracking-tight mb-1">
          Recovered-tag archive
        </h2>
        <p className="text-sm text-muted">
          {archive.profile.totalReadings.toLocaleString()} archived readings,{' '}
          {archive.from.toLocaleDateString()} &ndash; {archive.to.toLocaleDateString()}
          {archive.basicSamples > 0 &&
            ` · basic log ${archive.basicSamples.toLocaleString()} samples`}
          {archive.anchorMethod === 'day' &&
            ' · dated to the day (±12 h) — add the Lotek Dive Log CSV for exact times'}
        </p>
        <p className="text-xs text-muted mt-2">
          {standalone
            ? 'No Argos positions in this upload, so there is no search to plan — ' +
              'position, drift and recovery analyses need a CLS export or raw Argos ' +
              'file alongside. The archive itself is below.'
            : 'Display only. The recovery analyses above run purely on the ' +
              'Argos-relayed data — the source that exists while there is still a ' +
              'tag to find — so their conclusions do not depend on the offload.'}
        </p>
      </div>

      <DiveProfilePanel profile={archive.profile} />

      {archive.dayRecords.length > 0 && (
        <div className="bg-surface rounded-xl border border-border p-5">
          <h3 className="font-semibold mb-2">Day log — onboard geolocation</h3>
          <p className="text-xs text-muted mb-3">
            Latitude from the tag&apos;s own light geolocation (longitude is not
            decodable from the offload). Sunrise/sunset UTC as the tag measured them.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono">
              <thead>
                <tr className="text-left text-xs text-muted uppercase">
                  <th className="pr-4 pb-1">Date</th>
                  <th className="pr-4 pb-1">Lat °N</th>
                  <th className="pr-4 pb-1">SST °C</th>
                  <th className="pr-4 pb-1">Sunrise</th>
                  <th className="pb-1">Sunset</th>
                </tr>
              </thead>
              <tbody>
                {archive.dayRecords.map((d) => (
                  <tr key={d.date.toISOString()} className="border-t border-border/50">
                    <td className="pr-4 py-1">{d.date.toISOString().slice(0, 10)}</td>
                    <td className="pr-4 py-1">{d.latitudeNorth?.toFixed(2) ?? 'no fix'}</td>
                    <td className="pr-4 py-1">{d.sstC?.toFixed(1) ?? '—'}</td>
                    <td className="pr-4 py-1">{hm(d.sunriseMinutesUtc)}</td>
                    <td className="py-1">{hm(d.sunsetMinutesUtc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {standalone && onReset && (
        <div className="text-center">
          <button
            onClick={onReset}
            className="text-sm text-muted hover:text-primary underline underline-offset-2"
          >
            Analyze different files
          </button>
        </div>
      )}
    </div>
  );
}
