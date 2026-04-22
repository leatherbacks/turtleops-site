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
