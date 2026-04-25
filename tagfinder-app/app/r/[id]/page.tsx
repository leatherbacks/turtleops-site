'use client';

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { Loader2, MapPin, Copy, Check, Share2, AlertTriangle } from 'lucide-react';
import type { AnalysisResult, EnvironmentData } from '@/lib/types';

const TagMap = dynamic(() => import('@/components/tagfinder/TagMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[400px] flex items-center justify-center bg-surface rounded-xl border border-border">
      <Loader2 className="w-6 h-6 animate-spin text-muted" />
    </div>
  ),
});

interface ReportPayload {
  id: string;
  ptt: number | null;
  createdAt: string;
  expiresAt: string;
  viewCount: number;
  analysis: AnalysisResult;
  environment: EnvironmentData | null;
  brief: string | null;
}

export default function ReportPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/reports/${id}`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load report');
        }
        return r.json();
      })
      .then((data) => {
        // Re-hydrate dates inside the analysis snapshot (JSON dates come as strings)
        rehydrateDates(data.analysis);
        rehydrateDates(data.environment);
        setReport(data);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-muted" />
      </div>
    );
  }

  if (error || !report) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangle className="w-10 h-10 text-warning mb-3" />
        <h1 className="text-xl font-semibold mb-1">Report unavailable</h1>
        <p className="text-sm text-muted mb-6">
          {error ?? 'The shared report could not be loaded.'}
        </p>
        <a
          href="https://tagfinder.turtleops.org"
          className="text-sm text-primary hover:underline"
        >
          Open TurtleTag Recovery →
        </a>
      </div>
    );
  }

  return <ReportView report={report} />;
}

function ReportView({ report }: { report: ReportPayload }) {
  const a = report.analysis;
  const env = report.environment;
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const coordStr = `${Math.abs(a.bestLat).toFixed(4)}°${
    a.bestLat >= 0 ? 'N' : 'S'
  }, ${Math.abs(a.bestLon).toFixed(4)}°${a.bestLon >= 0 ? 'E' : 'W'}`;
  const mapsUrl = `https://maps.google.com/?q=${a.bestLat.toFixed(
    6
  )},${a.bestLon.toFixed(6)}`;
  const shareUrl =
    typeof window !== 'undefined'
      ? window.location.href
      : `https://tagfinder.turtleops.org/r/${report.id}`;
  const pttLabel = report.ptt ? `PTT ${report.ptt}` : 'Tag';

  const handleCopy = () => {
    navigator.clipboard.writeText(`${a.bestLat.toFixed(6)}, ${a.bestLon.toFixed(6)}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleShare = async () => {
    const shareData = {
      title: `${pttLabel} — Recovery report`,
      text: `${pttLabel} recovery report: ${coordStr}\n${shareUrl}`,
      url: shareUrl,
    };
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && typeof nav.share === 'function') {
        await nav.share(shareData);
      } else if (nav && nav.clipboard) {
        await nav.clipboard.writeText(shareUrl);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // user cancelled or share unavailable
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-bold tracking-tight">
              <span className="text-primary">TurtleTag</span> · {pttLabel}
            </h1>
            <p className="text-[11px] text-muted">
              Shared {formatRelative(report.createdAt)} · {report.viewCount} view
              {report.viewCount === 1 ? '' : 's'}
            </p>
          </div>
          <button
            onClick={handleShare}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-border hover:bg-surface-elevated"
          >
            {shared ? (
              <Check className="w-3.5 h-3.5 text-success" />
            ) : (
              <Share2 className="w-3.5 h-3.5" />
            )}
            Share
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        {/* Position hero */}
        <section className="bg-surface rounded-xl border border-primary/40 ring-1 ring-primary/20 p-5">
          <div className="flex items-center gap-2 mb-3">
            <MapPin className="w-5 h-5 text-primary" />
            <h2 className="font-semibold">Where to Search</h2>
          </div>
          <div className="flex flex-wrap items-center gap-3 mb-3">
            <span className="text-2xl md:text-3xl font-mono font-bold tracking-tight">
              {coordStr}
            </span>
            <button
              onClick={handleCopy}
              className="p-1.5 rounded-md hover:bg-surface-elevated"
              title="Copy coordinates"
            >
              {copied ? (
                <Check className="w-4 h-4 text-success" />
              ) : (
                <Copy className="w-4 h-4 text-muted" />
              )}
            </button>
          </div>
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener"
            className="inline-block text-sm text-primary hover:underline"
          >
            Open in Google Maps →
          </a>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
            <span>Search radius: {a.primaryRadiusM.toFixed(0)} m</span>
            <span>
              Fixes: {a.validFixes.length}/{a.allFixes.length}
            </span>
          </div>
        </section>

        {/* AI brief */}
        {report.brief && (
          <section className="bg-surface rounded-xl border border-border p-5">
            <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted">
              Recovery brief
            </h2>
            <div className="prose prose-sm prose-invert max-w-none whitespace-pre-wrap text-sm leading-relaxed">
              {report.brief}
            </div>
          </section>
        )}

        {/* Environment quick-reference */}
        {env && (
          <section className="bg-surface rounded-xl border border-border p-5">
            <h2 className="font-semibold mb-3 text-sm uppercase tracking-wide text-muted">
              Environment
            </h2>
            {env.forecast?.stormAlert && (
              <div className="mb-3 p-3 rounded-lg bg-error/10 border border-error/40 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-error flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-error">
                    Storm alert
                  </div>
                  <div className="text-xs mt-0.5">
                    {env.forecast.alertReason}. Recover before conditions deteriorate.
                  </div>
                </div>
              </div>
            )}
            <div className="grid grid-cols-2 gap-3 text-sm">
              {env.location && (
                <div>
                  <div className="text-xs text-muted uppercase tracking-wide">Location</div>
                  <div>{env.location.name}</div>
                </div>
              )}
              {env.elevation && (
                <div>
                  <div className="text-xs text-muted uppercase tracking-wide">Elevation</div>
                  <div className="font-mono">{env.elevation.meters.toFixed(2)} m</div>
                </div>
              )}
              {env.weather && (
                <div>
                  <div className="text-xs text-muted uppercase tracking-wide">Weather</div>
                  <div>
                    <span className="font-mono">
                      {env.weather.temperature?.toFixed(0)}°C
                    </span>{' '}
                    · {env.weather.conditions}
                  </div>
                </div>
              )}
              {env.tides?.nextLow && (
                <div>
                  <div className="text-xs text-muted uppercase tracking-wide">Next low tide</div>
                  <div className="text-xs">{formatTime(env.tides.nextLow.time)}</div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Map */}
        <section className="bg-surface rounded-xl border border-border p-2 overflow-hidden">
          <TagMap result={a} />
          <div className="flex flex-wrap gap-3 mt-3 justify-center text-[11px] text-muted px-2 pb-1">
            <LegendItem color="#d32f2f" label="Best estimate" />
            {a.popoff && <LegendItem color="#fbc02d" label="Popoff (P₀)" />}
            <LegendItem color="#1565c0" label="Q3 fix" />
            <LegendItem color="#0097a7" label="Q2 fix" />
            <LegendItem color="#7b1fa2" label="Q1/A fix" />
            {a.outlierFixes && a.outlierFixes.length > 0 && (
              <LegendItem color="#999999" label="Outlier" />
            )}
          </div>
        </section>

        <footer className="text-center text-xs text-muted py-6">
          <p>
            Shared via <a href="https://tagfinder.turtleops.org" className="text-primary hover:underline">TurtleTag Recovery</a>
            . Snapshot from {formatTime(new Date(report.createdAt))}; data may have updated since.
          </p>
          <p className="mt-2">
            Found this useful?{' '}
            <a href="https://tagfinder.turtleops.org" className="text-primary hover:underline">
              Analyze your own tag — free
            </a>
          </p>
        </footer>
      </main>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <div
        className="w-2 h-2 rounded-full border border-white/60"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </div>
  );
}

/** Walk a JSON-deserialized object and convert ISO date strings back to Date objects. */
function rehydrateDates(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;
  const o = obj as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
      o[k] = new Date(v);
    } else if (Array.isArray(v)) {
      v.forEach((item) => rehydrateDates(item));
    } else if (v && typeof v === 'object') {
      rehydrateDates(v);
    }
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const seconds = Math.max(0, Math.floor((now - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const min = Math.floor(seconds / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function formatTime(d: Date | string): string {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
