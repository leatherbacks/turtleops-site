import type { DeploySummary, Manufacturer, TagCategoryInfo } from '@/lib/types';

/**
 * Instruments that are pop-up archival tags by construction. Nothing else these
 * models can be, so the name alone settles it and a missing ReleaseDate does
 * not change what the hardware is.
 */
const DEFINITE_PSAT_PATTERNS = [
  /mini.?pat/i,
  /^pat/i,
  /mr.?pat/i,
  /sea.?tag/i, // Desert Star SeaTag PSATs
  /x.?tag/i,
];

/**
 * Instruments that may be deployed either way. SPLASH is usually carried by the
 * animal rather than popped off, so for these the name is not enough — a
 * ReleaseDate has to confirm it.
 */
const AMBIGUOUS_PSAT_PATTERNS = [/splash/i];

/** Known PSAT (Pop-up Archival Tag) instrument identifiers */
const PSAT_PATTERNS = [...DEFINITE_PSAT_PATTERNS, ...AMBIGUOUS_PSAT_PATTERNS];

/** Known live-tracker identifiers */
const TRACKER_PATTERNS = [
  /^spot/i,
  /mk\d+/i, // Mk10, Mk9, etc. (typically tracker models)
  /smart.?position/i,
];

/**
 * Determine if a tag is a PSAT (release/popoff) or a live tracker.
 *
 * Primary signal: ReleaseDate in Summary. PSATs have one, live trackers don't.
 * Secondary signal: Instr field matches known patterns.
 */
export function detectTagCategory(
  summary: DeploySummary | null,
  manufacturer: Manufacturer | 'unknown' = 'unknown'
): TagCategoryInfo {
  if (!summary) {
    // Lotek's PSAT exports (Day Log / Dive Log) carry no equivalent of
    // Summary.csv, so there is no ReleaseDate to key off. But those files only
    // come off the PSAT line — a pop-up archival tag by definition — so the
    // absence of a summary must not be read as "live tracker" the way it is
    // for Wildlife Computers.
    if (manufacturer === 'lotek') {
      return {
        category: 'psat',
        instrument: 'Lotek PSAT',
        reasoning: 'Lotek PSAT export — this format is only produced by pop-up archival tags',
      };
    }
    return {
      category: 'tracker',
      instrument: 'unknown',
      reasoning: 'No Summary.csv provided — treating as live tracker',
    };
  }

  const instr = (summary.instrument || '').trim();

  // Strong signal: instrument matches PSAT pattern
  const matchesPsat = PSAT_PATTERNS.some((p) => p.test(instr));
  const matchesTracker = TRACKER_PATTERNS.some((p) => p.test(instr));

  if (matchesPsat && summary.releaseDate) {
    return {
      category: 'psat',
      instrument: instr,
      reasoning: `Instrument "${instr}" matches PSAT pattern with ReleaseDate`,
    };
  }

  // A named pop-up tag stays a pop-up tag when the export omits ReleaseDate.
  // Requiring both fields sent a real MiniPAT down the live-tracker path, where
  // its four post-release fixes were treated as animal movement and the
  // PSAT-only analyses were skipped entirely. A missing ReleaseDate is a gap in
  // the export, not evidence about the hardware — the analyses that genuinely
  // need one already check for it and say so.
  if (DEFINITE_PSAT_PATTERNS.some((p) => p.test(instr))) {
    return {
      category: 'psat',
      instrument: instr,
      reasoning:
        `Instrument "${instr}" is a pop-up archival tag. Summary.csv has no ReleaseDate, ` +
        `so anything needing the release moment is reported as unavailable rather than guessed.`,
    };
  }

  if (matchesTracker) {
    return {
      category: 'tracker',
      instrument: instr,
      reasoning: `Instrument "${instr}" matches live-tracker pattern`,
    };
  }

  // Fallback heuristics
  if (summary.releaseDate) {
    return {
      category: 'psat',
      instrument: instr || 'unknown',
      reasoning: `ReleaseDate present — treating as PSAT (Instr: "${instr || 'unspecified'}")`,
    };
  }

  return {
    category: 'tracker',
    instrument: instr || 'unknown',
    reasoning: `No ReleaseDate — treating as live tracker (Instr: "${instr || 'unspecified'}")`,
  };
}
