'use client';

import { useState } from 'react';
import { ThumbsUp, ThumbsDown, Loader2, Check } from 'lucide-react';
import type { AnalysisResult } from '@/lib/types';

interface FeedbackWidgetProps {
  /** Sent with the feedback for context — helps you debug bad briefs later */
  result: AnalysisResult | null;
}

type Rating = -1 | 1;

export default function FeedbackWidget({ result }: FeedbackWidgetProps) {
  const [rating, setRating] = useState<Rating | null>(null);
  const [comment, setComment] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (chosenRating: Rating) => {
    setRating(chosenRating);
    setSubmitting(true);
    setError(null);

    // Snapshot only the key fields — not the full result (PII-light)
    const snapshot = result
      ? {
          ptt: result.ptt,
          tagCategory: result.tagCategory?.category,
          tagState: result.tagState?.phase,
          driftPattern: result.driftState?.pattern,
          bestLat: result.bestLat,
          bestLon: result.bestLon,
        }
      : null;

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: chosenRating,
          comment: comment.trim() || undefined,
          analysisSnapshot: snapshot,
          pageUrl: typeof window !== 'undefined' ? window.location.href : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || 'Failed to submit feedback');
        setRating(null);
      } else {
        setSubmitted(true);
      }
    } catch {
      setError('Failed to submit feedback');
      setRating(null);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitWithComment = async () => {
    if (rating === null) return;
    await handleSubmit(rating);
  };

  if (submitted) {
    return (
      <div className="bg-surface rounded-xl border border-success/20 p-4 flex items-center gap-3">
        <Check className="w-5 h-5 text-success flex-shrink-0" />
        <div className="text-sm">
          <div className="font-medium">Thanks for the feedback.</div>
          <div className="text-xs text-muted">
            Your response helps us improve the tool.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-4 no-print">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <div className="text-sm font-medium">Was this analysis helpful?</div>
          <div className="text-xs text-muted mt-0.5">
            Your response helps us improve the tool.
          </div>
        </div>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <button
            onClick={() => handleSubmit(1)}
            disabled={submitting || rating !== null}
            className={`p-2 rounded-lg border transition-colors ${
              rating === 1
                ? 'bg-success/20 border-success/40 text-success'
                : 'border-border hover:bg-surface-elevated'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            aria-label="Helpful"
          >
            <ThumbsUp className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleSubmit(-1)}
            disabled={submitting || rating !== null}
            className={`p-2 rounded-lg border transition-colors ${
              rating === -1
                ? 'bg-error/20 border-error/40 text-error'
                : 'border-border hover:bg-surface-elevated'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
            aria-label="Not helpful"
          >
            <ThumbsDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Optional comment — always visible so users can add context without clicking anything first */}
      <div className="space-y-2">
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional: what was most/least useful? Any bug or missing feature?"
          rows={2}
          className="w-full px-3 py-2 text-sm rounded-lg bg-surface-elevated border border-border text-foreground placeholder:text-muted focus:border-primary focus:outline-none resize-none"
          disabled={submitting || submitted}
        />
        {comment.trim().length > 0 && rating !== null && !submitting && (
          <button
            onClick={handleSubmitWithComment}
            className="w-full py-1.5 text-xs font-medium rounded-lg bg-primary text-black hover:bg-primary-light transition-colors"
          >
            Submit comment
          </button>
        )}
      </div>

      {submitting && (
        <div className="flex items-center gap-2 text-xs text-muted mt-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Sending...
        </div>
      )}

      {error && (
        <div className="text-xs text-error mt-2">{error}</div>
      )}
    </div>
  );
}
