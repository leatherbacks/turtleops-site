'use client';

import type { AnalysisResult } from '@/lib/types';
import { MapPin, Copy, Check, Share2 } from 'lucide-react';
import { useState } from 'react';

interface PositionCardProps {
  result: AnalysisResult;
  /** When true, render as a hero card with larger typography. Used at the top
   *  of the results page; when embedded in the sidebar AnalysisPanel the
   *  compact default is used. */
  hero?: boolean;
}

/** Metres below 2 km, kilometres above — "21229m" reads as a bug, "21.2 km" reads as a fact. */
function formatDistance(metres: number): string {
  return metres >= 2000 ? `${(metres / 1000).toFixed(1)} km` : `${metres.toFixed(0)} m`;
}

export default function PositionCard({ result, hero = false }: PositionCardProps) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

  const coordStr = `${Math.abs(result.bestLat).toFixed(4)}°${
    result.bestLat >= 0 ? 'N' : 'S'
  }, ${Math.abs(result.bestLon).toFixed(4)}°${result.bestLon >= 0 ? 'E' : 'W'}`;

  const handleCopy = () => {
    navigator.clipboard.writeText(
      `${result.bestLat.toFixed(6)}, ${result.bestLon.toFixed(6)}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const mapsUrl = `https://maps.google.com/?q=${result.bestLat.toFixed(
    6
  )},${result.bestLon.toFixed(6)}`;
  const pttLabel = result.ptt ? `PTT ${result.ptt} — ` : '';
  const shareText =
    `${pttLabel}Best position estimate: ${coordStr}\n` +
    `Search radius: ${formatDistance(result.primaryRadiusM)}\n` +
    `Map: ${mapsUrl}\n` +
    `Full analysis: ${
      typeof window !== 'undefined'
        ? window.location.href
        : 'https://tagfinder.turtleops.org'
    }`;

  const handleShare = async () => {
    const shareData = {
      title: `TurtleTag${result.ptt ? ` ${result.ptt}` : ''}`,
      text: shareText,
    };
    try {
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && typeof nav.share === 'function') {
        await nav.share(shareData);
      } else if (nav && nav.clipboard) {
        await nav.clipboard.writeText(shareText);
      }
      setShared(true);
      setTimeout(() => setShared(false), 2000);
    } catch {
      // user cancelled or share unavailable
    }
  };

  const coordSizeClass = hero
    ? 'text-3xl md:text-4xl font-mono font-bold tracking-tight'
    : 'text-2xl font-mono font-bold tracking-tight';

  return (
    <div
      className={`bg-surface rounded-xl border ${
        hero ? 'border-primary/40 ring-1 ring-primary/20' : 'border-border'
      } p-5`}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapPin className="w-5 h-5 text-primary" />
          <h3 className="font-semibold">
            {hero ? 'Where to Search' : 'Best Estimate Position'}
          </h3>
        </div>
        {result.ptt && (
          <span className="text-xs text-muted bg-surface-elevated px-2 py-1 rounded">
            PTT {result.ptt}
          </span>
        )}
      </div>

      <div className="flex items-center flex-wrap gap-3 mb-3">
        <span className={coordSizeClass}>{coordStr}</span>
        <button
          onClick={handleCopy}
          className="p-1.5 rounded-md hover:bg-surface-elevated transition-colors"
          title="Copy coordinates"
        >
          {copied ? (
            <Check className="w-4 h-4 text-success" />
          ) : (
            <Copy className="w-4 h-4 text-muted" />
          )}
        </button>
        <button
          onClick={handleShare}
          className="p-1.5 rounded-md hover:bg-surface-elevated transition-colors"
          title="Share position to field team"
        >
          {shared ? (
            <Check className="w-4 h-4 text-success" />
          ) : (
            <Share2 className="w-4 h-4 text-muted" />
          )}
        </button>
        {hero && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noopener"
            className="text-xs text-primary hover:underline ml-auto"
          >
            Open in Google Maps →
          </a>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        <span>
          Method:{' '}
          {result.positionMethod === 'weighted_mean'
            ? 'Weighted mean'
            : 'Recent fixes only'}
        </span>
        <span>Search radius: {formatDistance(result.primaryRadiusM)}</span>
        <span>
          Fixes: {result.validFixes.length} of {result.allFixes.length} usable
        </span>
      </div>
      {result.searchRadiusBasis && (
        <p className="text-xs text-muted mt-2 leading-relaxed">
          {result.searchRadiusBasis}
        </p>
      )}

      {/*
        Landfall sits directly under the headline rather than three panels down.
        The headline stays the last confirmed position — that is the thing we
        actually observed — but on a tag that has been drifting for days the
        strand point is usually the more useful place to start, and burying it
        meant the most actionable number on the page was the easiest to miss.
        Promoted, not substituted: the extrapolation carries no wind-leeway
        term and has not yet been checked against a tag anyone recovered.
      */}
      {result.landfall && (
        <div
          className={`mt-3 rounded-lg border p-3 ${
            result.landfall.willStrand
              ? 'border-warning/40 bg-warning/5'
              : 'border-info/30 bg-info/5'
          }`}
        >
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span
              className={`text-xs uppercase tracking-wide font-semibold ${
                result.landfall.willStrand ? 'text-warning' : 'text-info'
              }`}
            >
              {!result.landfall.willStrand
                ? 'Not predicted to strand'
                : result.landfall.alreadyPassed
                  ? 'Likely already ashore'
                  : 'Predicted landfall'}
            </span>
            {result.landfall.lat !== null && result.landfall.lon !== null && (
              <span className="font-mono text-sm">
                {Math.abs(result.landfall.lat).toFixed(4)}°
                {result.landfall.lat >= 0 ? 'N' : 'S'},{' '}
                {Math.abs(result.landfall.lon).toFixed(4)}°
                {result.landfall.lon >= 0 ? 'E' : 'W'}
              </span>
            )}
            {result.landfall.willStrand && result.landfall.uncertaintyKm !== null && (
              <span className="text-xs text-muted">
                ±{result.landfall.uncertaintyKm.toFixed(1)} km along shore
              </span>
            )}
            {result.landfall.willStrand && result.landfall.lat !== null && (
            <a
              href={`https://www.google.com/maps?q=${result.landfall.lat},${result.landfall.lon}`}
              target="_blank"
              rel="noopener"
              className="text-xs text-primary hover:underline ml-auto no-print"
            >
              Open in Google Maps →
            </a>
            )}
          </div>
          <p className="text-xs text-muted mt-1.5 leading-relaxed">
            {result.landfall.reasoning}
          </p>
        </div>
      )}
    </div>
  );
}
