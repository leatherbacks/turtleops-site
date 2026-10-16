import type { DeploySummary } from '@/lib/types';

/**
 * The release date to split the record on: the stated one, or, when the
 * export leaves it blank, the one inferred from transmission starting after
 * the archive ended (see parsers/wc/summary).
 *
 * MiniPAT 285927 had no ReleaseDate. Its archive ended 1 Apr 2026 and it
 * transmitted from 11 Apr; the parser inferred the release, but Tag State,
 * Light, Temperature and Burial only read the stated field and all reported
 * "insufficient". It was found buried flat in the sand at Padre Island, which
 * the satellite panels had already said; Tag State could not. The inferred
 * date errs late, so it can only withhold readings from the post-release
 * set, never admit the animal's dive record.
 */
export function effectiveRelease(summary: DeploySummary | null | undefined): Date | null {
  return summary?.releaseDate ?? summary?.inferredReleaseDate ?? null;
}
