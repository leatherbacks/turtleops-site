'use client';

import type { DetectedFile } from '@/lib/types';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';

interface FileListProps {
  files: DetectedFile[];
}

const FILE_TYPE_LABELS: Record<string, string> = {
  // Wildlife Computers
  locations: 'Locations',
  argos: 'Argos Passes',
  status: 'Tag Status',
  summary: 'Summary',
  series: 'Dive Series',
  sst: 'Sea Surface Temp',
  minmaxdepth: 'Daily Dive Range',
  corrupt: 'Corrupted Messages',
  lightloc: 'Light Levels',
  dailydata: 'Daily Summary',
  histos: 'Depth/Temp Histograms',
  // Lotek
  lotek_daylog: 'Day Log',
  lotek_divelog: 'Dive Log',
  // Argos / CLS
  argos_ds: 'Argos Raw (CLS)',
  unknown: 'Not recognized',
};

const SOURCE_LABELS: Record<string, string> = {
  wildlife_computers: 'Wildlife Computers',
  lotek: 'Lotek',
  argos_cls: 'Argos / CLS',
};

export default function FileList({ files }: FileListProps) {
  if (files.length === 0) return null;

  const recognized = files.filter((f) => f.fileType !== 'unknown');
  const unrecognized = files.filter((f) => f.fileType === 'unknown');

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted uppercase tracking-wide">
        Detected Files
      </h3>
      <div className="space-y-1">
        {recognized.map((f) => (
          <div key={f.file.name} className="py-1">
            <div className="flex items-center gap-2 text-sm">
              {f.warning ? (
                <AlertTriangle className="w-4 h-4 text-warning flex-shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 text-success flex-shrink-0" />
              )}
              <span className="font-medium">
                {FILE_TYPE_LABELS[f.fileType] ?? f.fileType}
              </span>
              {SOURCE_LABELS[f.source] && (
                <span className="text-xs text-muted opacity-70">
                  {SOURCE_LABELS[f.source]}
                </span>
              )}
              <span className="text-muted truncate">{f.file.name}</span>
            </div>
            {f.warning && (
              <p className="text-xs text-warning/90 ml-6 mt-0.5">{f.warning}</p>
            )}
          </div>
        ))}
        {unrecognized.map((f) => (
          <div
            key={f.file.name}
            className="flex items-center gap-2 text-sm py-1 text-muted"
          >
            <XCircle className="w-4 h-4 flex-shrink-0 opacity-50" />
            <span className="truncate">{f.file.name}</span>
            <span className="text-xs opacity-50">skipped</span>
          </div>
        ))}
      </div>
    </div>
  );
}
