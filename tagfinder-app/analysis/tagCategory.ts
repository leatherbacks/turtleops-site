import type { DeploySummary, Manufacturer, TagCategoryInfo } from '@/lib/types';

/** Known PSAT (Pop-up Archival Tag) instrument identifiers */
const PSAT_PATTERNS = [
  /mini.?pat/i,
  /^pat/i,
  /mr.?pat/i,
  /splash/i, // SPLASH tags can be archival too
  /sea.?tag/i, // Desert Star SeaTag PSATs
  /x.?tag/i,
];

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
