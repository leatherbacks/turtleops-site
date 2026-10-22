'use client';

import { Sparkles, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';

interface SearchBriefPanelProps {
  brief: string | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** The environment and sky have settled, so a brief can be written. */
  ready: boolean;
}

const STATUS_MESSAGES = [
  'Reading the tag analysis...',
  'Considering position, drift state, and environmental context...',
  'Cross-checking satellite reception patterns...',
  'Evaluating tidal and weather factors...',
  'Weighing recovery scenarios...',
  'Drafting the recovery brief...',
  'Reviewing recommendations...',
];

export default function SearchBriefPanel({
  brief,
  loading,
  error,
  onRetry,
  ready,
}: SearchBriefPanelProps) {
  const [statusIndex, setStatusIndex] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);

  // Rotate status messages every 4 seconds while loading
  useEffect(() => {
    if (!loading) {
      setStatusIndex(0);
      setElapsedSec(0);
      return;
    }
    const startedAt = Date.now();
    const interval = setInterval(() => {
      setStatusIndex((i) => (i + 1) % STATUS_MESSAGES.length);
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 4000);
    // Also tick elapsed every second
    const secInterval = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startedAt) / 1000));
    }, 1000);
    return () => {
      clearInterval(interval);
      clearInterval(secInterval);
    };
  }, [loading]);

  return (
    <div className="bg-surface rounded-xl border border-primary/20 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sparkles className={`w-5 h-5 text-primary ${loading ? 'animate-pulse' : ''}`} />
        <h3 className="font-semibold">Recovery Brief</h3>
        <span className="text-xs text-muted ml-auto">
          {loading ? `${elapsedSec}s` : 'AI-generated'}
        </span>
      </div>

      {loading && (
        <div className="space-y-3">
          {/* Rotating status message */}
          <div className="flex items-center gap-2 text-sm text-primary">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span>{STATUS_MESSAGES[statusIndex]}</span>
          </div>

          {/* Skeleton paragraph lines — pulse to show activity */}
          <div className="space-y-2 pt-2">
            <SkeletonLine width="95%" />
            <SkeletonLine width="88%" />
            <SkeletonLine width="92%" />
            <SkeletonLine width="60%" />
          </div>
          <div className="space-y-2 pt-2">
            <SkeletonLine width="90%" />
            <SkeletonLine width="85%" />
            <SkeletonLine width="72%" />
          </div>

          <p className="text-xs text-muted pt-2">
            Our recovery AI is working through this tag, drawing on what past
            recoveries have taught us. Usually 15–30 seconds.
          </p>
        </div>
      )}

      {error && !loading && (
        <div className="space-y-3">
          <p className="text-sm text-error">{error}</p>
          <button
            onClick={onRetry}
            className="flex items-center gap-2 text-xs px-3 py-1.5 rounded-lg border border-border hover:bg-surface-elevated transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </button>
        </div>
      )}

      {brief && !loading && (
        <div className="prose prose-sm prose-invert max-w-none">
          {brief.split('\n\n').map((para, i) => (
            <p key={i} className="text-sm leading-relaxed mb-3 last:mb-0">
              {para}
            </p>
          ))}
        </div>
      )}

      {!brief && !loading && !error && (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            A written summary of every panel below, with a recommended next step. Takes 15–30 seconds.
          </p>
          <button
            onClick={onRetry}
            disabled={!ready}
            className="flex items-center gap-2 text-sm px-3 py-1.5 rounded-lg border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Sparkles className="w-4 h-4" />
            {ready ? 'Write recovery brief' : 'Loading environmental data…'}
          </button>
        </div>
      )}
    </div>
  );
}

function SkeletonLine({ width }: { width: string }) {
  return (
    <div
      className="h-3 rounded bg-surface-elevated animate-pulse"
      style={{ width }}
    />
  );
}
