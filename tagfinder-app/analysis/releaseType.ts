import type { DeploySummary, ReleaseInterpretation, ReleaseCategory } from '@/lib/types';

/**
 * Interpret the Summary.csv ReleaseType field into actionable context.
 * Wildlife Computers MiniPAT values (and similar tags):
 *   - "Interval" / "Date" — scheduled release (normal)
 *   - "Detachment" / "Premature (Detachment)" — tag shed from animal
 *   - "Floater" — animal likely dead at surface
 *   - "Sitter" — constant depth for N days
 *   - "Sinker" — below threshold depth for N days
 *   - "Crush Depth" — failsafe near 1700m
 */
export function interpretReleaseType(
  summary: DeploySummary | null
): ReleaseInterpretation | null {
  if (!summary) return null;
  const raw = (summary.releaseType || '').trim();
  if (!raw) {
    return {
      category: 'unknown',
      rawType: raw,
      label: 'Unknown',
      implication: 'No release type specified in Summary.csv.',
      severity: 'info',
    };
  }

  const normalized = raw.toLowerCase();

  if (normalized.includes('interval') || normalized.includes('scheduled') || normalized === 'date') {
    return {
      category: 'scheduled',
      rawType: raw,
      label: 'Scheduled release',
      implication: 'Tag released at its pre-programmed deployment end date — this is a normal successful deployment.',
      severity: 'info',
    };
  }

  if (normalized.includes('detach')) {
    return {
      category: 'detachment',
      rawType: raw,
      label: 'Premature: Detachment',
      implication: 'Tag detected itself floating at the surface before the scheduled release date. The animal likely shed the tag, or the attachment failed.',
      severity: 'warning',
    };
  }

  if (normalized.includes('floater')) {
    return {
      category: 'floater',
      rawType: raw,
      label: 'Premature: Floater',
      implication: 'Tag was floating at the surface for extended time (>50% dry per hour). This often indicates the animal died at or near the surface.',
      severity: 'alert',
    };
  }

  if (normalized.includes('sitter') || normalized.includes('constant')) {
    return {
      category: 'sitter',
      rawType: raw,
      label: 'Premature: Sitter',
      implication: 'Tag was at a nearly constant depth for multiple days. Consistent with mortality (animal settled on bottom), tag entanglement, or dead animal caught on structure.',
      severity: 'alert',
    };
  }

  if (normalized.includes('sinker') || normalized.includes('sink')) {
    return {
      category: 'sinker',
      rawType: raw,
      label: 'Premature: Sinker',
      implication: 'Tag remained below a threshold depth for multiple days — indicates animal mortality and sinking. Tag released before crush depth.',
      severity: 'alert',
    };
  }

  if (normalized.includes('crush') || normalized.includes('depth limit')) {
    return {
      category: 'crush_depth',
      rawType: raw,
      label: 'Emergency: Crush-depth failsafe',
      implication: 'Tag triggered its crush-depth failsafe (typically ~1700m) to release before hardware damage. Strong mortality + descent signal.',
      severity: 'alert',
    };
  }

  const fallback: ReleaseCategory = 'unknown';
  return {
    category: fallback,
    rawType: raw,
    label: raw,
    implication: `Unrecognized release type "${raw}". May be a manufacturer-specific code.`,
    severity: 'info',
  };
}

/**
 * Release cause from a Lotek PSAT+ health message.
 *
 * Lotek ships no Summary.csv, so the Wildlife Computers path above reported
 * "unknown" for every Lotek tag while the answer sat in byte 6 of each health
 * payload. The manufacturer's manual names three programmed release
 * conditions and exactly three values have been observed, each constant
 * within its deployment and matching the ReleaseCause string in the
 * manufacturer's own decode (see parsers/lotek/healthMessage.ts):
 *
 *   0x80  scheduled elapsed time     (rendered "Wet Schedule")
 *   0x81  overpressure
 *   0x82  inactivity / constant depth
 *
 * The inactivity trigger is ambiguous by design — a shed tag floating and a
 * dead animal on the bottom both stop changing depth — so it maps to the same
 * category the WC "Sitter" does, with the same caution.
 */
export function interpretLotekReleaseStatus(statusByte: number): ReleaseInterpretation {
  const raw = `0x${statusByte.toString(16).padStart(2, '0')}`;
  switch (statusByte) {
    case 0x80:
      return {
        category: 'scheduled',
        rawType: `Wet Schedule (${raw})`,
        label: 'Scheduled release',
        implication:
          'The tag reports a scheduled (elapsed-time) release. Check the burn date against the ' +
          'programmed deployment length: a burn days early with this cause still recorded means ' +
          'the schedule fired, not the inactivity or pressure trigger.',
        severity: 'info',
      };
    case 0x81:
      return {
        category: 'crush_depth',
        rawType: `Overpressure (${raw})`,
        label: 'Premature: Overpressure',
        implication:
          'The tag released after exceeding its depth threshold for the programmed time. ' +
          'Consistent with the animal diving beyond the tag rating, or with a dead animal sinking.',
        severity: 'alert',
      };
    case 0x82:
      return {
        category: 'sitter',
        rawType: `Inactivity (${raw})`,
        label: 'Premature: Inactivity',
        implication:
          'The tag saw no change in pressure for several days. Lotek documents this trigger as ' +
          'ambiguous: a tag shed and floating and an animal dead on the bottom look the same to it.',
        severity: 'alert',
      };
    default:
      return {
        category: 'unknown',
        rawType: raw,
        label: 'Unknown',
        implication: `Health-message status byte ${raw} does not match any documented Lotek release condition.`,
        severity: 'info',
      };
  }
}
