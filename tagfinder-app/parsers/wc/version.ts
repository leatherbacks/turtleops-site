/**
 * version.txt from a Wildlife Computers portal download: when the export was
 * built, and the decoder version.
 *
 *   This data was decoded with version 3.0.640 of DAP.
 *   This data was last updated on: 2026-10-02 15:42:26 (UTC).
 *
 * The export time is the true "as of" for everything else in the download.
 * Without it the sky window ran to the moment the page was opened, so passes
 * after the export was pulled — which the file could not contain — counted as
 * missed.
 */

export interface WCVersion {
  exportedAt: Date | null;
  dapVersion: string | null;
}

export function parseWCVersion(text: string): WCVersion | null {
  const t = text.match(/last updated on:\s*(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})\s*\(UTC\)/i);
  const v = text.match(/decoded with version\s+([\w.]+)\s+of DAP/i);
  if (!t && !v) return null;
  const exportedAt = t ? new Date(Date.UTC(+t[1], +t[2] - 1, +t[3], +t[4], +t[5], +t[6])) : null;
  return { exportedAt, dapVersion: v ? v[1] : null };
}
