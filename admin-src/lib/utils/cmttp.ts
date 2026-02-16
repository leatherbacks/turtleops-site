/**
 * CMTTP Export Utilities
 * Cooperative Marine Turtle Tagging Program data formatting
 */

import type { ObservationWithTurtle } from '@/lib/database/observations';

// Species code mapping (TurtleOps → CMTTP)
const SPECIES_CODE_MAP: Record<string, string> = {
  'Leatherback': 'DC',      // Dermochelys coriacea
  'Loggerhead': 'CM',       // Caretta caretta
  'Green': 'CC',            // Chelonia mydas
  'Hawksbill': 'EI',        // Eretmochelys imbricata
  'Olive Ridley': 'LO',     // Lepidochelys olivacea
  'Kemps Ridley': 'LK',     // Lepidochelys kempii
  "Kemp's Ridley": 'LK',    // Alternative spelling
  'Flatback': 'FB',         // Natator depressus
};

interface CMTTPRow {
  projectType: string;
  species: string;
  sex: string;
  captureDate: string;
  captureSiteName: string;
  captureCounty: string;
  captureStateCountry: string;
  captureLatitude: string;
  captureLongitude: string;
  existingTag1: string;
  existingTag2: string;
  existingPitTag: string;
  recapture: string;
  appliedTag1: string;
  appliedTag2: string;
  appliedPitTag: string;
  sclNT: string;
  sclNN: string;
  scw: string;
  weightKg: string;
  cclNT: string;
  cclNN: string;
  ccw: string;
  releaseDate: string;
  releaseSiteName: string;
  releaseCounty: string;
  releaseStateCountry: string;
  releaseLatitude: string;
  releaseLongitude: string;
  comments: string;
}

/**
 * Convert TurtleOps observation to CMTTP format row
 */
export function observationToCMTTP(
  obs: ObservationWithTurtle,
  options: {
    projectType?: string;
    county?: string;
    state?: string;
    country?: string;
  } = {}
): CMTTPRow {
  const {
    projectType = 'Monitoring',
    county = '',
    state = 'FL',
    country = 'USA',
  } = options;

  // Format date as mm/dd/yyyy
  const formatDate = (date: Date | string | null): string => {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const year = d.getFullYear();
    return `${month}/${day}/${year}`;
  };

  // Get species code
  const speciesCode = obs.turtle?.species
    ? SPECIES_CODE_MAP[obs.turtle.species] || obs.turtle.species
    : '';

  // Extract existing tags (tags on turtle when encountered)
  // Tag priority: LRF, RRF, RFF, LFF
  const existingTags: string[] = [];
  let existingPitTag = '';

  // Collect flipper tags
  if (obs.tag_lrf) existingTags.push(obs.tag_lrf);
  if (obs.tag_rrf) existingTags.push(obs.tag_rrf);

  // Check RFF and LFF for PIT tags (15-digit numbers)
  if (obs.tag_rff) {
    if (obs.tag_rff.length >= 15 && /^\d+$/.test(obs.tag_rff)) {
      existingPitTag = obs.tag_rff;
    } else {
      existingTags.push(obs.tag_rff);
    }
  }

  if (obs.tag_lff) {
    if (!existingPitTag && obs.tag_lff.length >= 15 && /^\d+$/.test(obs.tag_lff)) {
      existingPitTag = obs.tag_lff;
    } else if (obs.tag_lff.length < 15) {
      existingTags.push(obs.tag_lff);
    }
  }

  // Applied tags (tags applied during this encounter)
  // For now, assume first encounter means tags were applied
  const isFirstEncounter = !obs.is_recapture;
  const appliedTag1 = isFirstEncounter ? existingTags[0] || '' : '';
  const appliedTag2 = isFirstEncounter ? existingTags[1] || '' : '';
  const appliedPitTag = isFirstEncounter ? existingPitTag : '';

  // Build comments field
  const commentParts: string[] = [];

  // Nesting status
  if (obs.did_she_nest === 'yes') {
    commentParts.push('Nesting event');
  } else if (obs.did_she_nest === 'no') {
    commentParts.push('False crawl');
  }

  // Body condition
  if (obs.body_condition) {
    commentParts.push(`Body condition: ${obs.body_condition}`);
  }

  // Injuries
  if (obs.has_injuries && obs.injury_locations) {
    try {
      const injuries = typeof obs.injury_locations === 'string'
        ? JSON.parse(obs.injury_locations)
        : obs.injury_locations;
      if (Array.isArray(injuries) && injuries.length > 0) {
        commentParts.push(`Injuries: ${injuries.join(', ')}`);
      }
    } catch (e) {
      // Invalid JSON, skip
    }
  }

  // Samples
  if (obs.samples_collected && obs.sample_types) {
    try {
      const samples = typeof obs.sample_types === 'string'
        ? JSON.parse(obs.sample_types)
        : obs.sample_types;
      if (Array.isArray(samples) && samples.length > 0) {
        commentParts.push(`Samples: ${samples.join(', ')}`);
      }
    } catch (e) {
      // Invalid JSON, skip
    }
  }

  // Nest marking
  if (obs.nest_marked && obs.nest_marking_method) {
    commentParts.push(`Nest marked (${obs.nest_marking_method})`);
  }

  // Behavior
  if (obs.turtle_behavior) {
    commentParts.push(`Behavior: ${obs.turtle_behavior}`);
  }

  // Relayed sighting
  if (obs.is_relayed_sighting) {
    commentParts.push('RELAYED SIGHTING');
  }

  // Additional comments
  if (obs.comments) {
    commentParts.push(obs.comments);
  }

  // Observer
  if (obs.observer_name) {
    commentParts.push(`Observer: ${obs.observer_name}`);
  }

  const stateCountry = state || country;

  return {
    projectType,
    species: speciesCode,
    sex: '', // Not captured in TurtleOps
    captureDate: formatDate(obs.encounter_date),
    captureSiteName: obs.beach_sector || '',
    captureCounty: county,
    captureStateCountry: stateCountry,
    captureLatitude: obs.final_latitude?.toString() || obs.latitude?.toString() || '',
    captureLongitude: obs.final_longitude?.toString() || obs.longitude?.toString() || '',
    existingTag1: existingTags[0] || '',
    existingTag2: existingTags[1] || '',
    existingPitTag: existingPitTag,
    recapture: obs.is_recapture ? 'Yes' : 'No',
    appliedTag1,
    appliedTag2,
    appliedPitTag,
    sclNT: '', // Straight carapace measurements not captured
    sclNN: '',
    scw: '',
    weightKg: '', // Weight not captured
    cclNT: obs.curved_carapace_length_max?.toString() || '',
    cclNN: obs.curved_carapace_length_min?.toString() || '',
    ccw: obs.curved_carapace_width?.toString() || '',
    releaseDate: formatDate(obs.encounter_date), // Same as capture for beach surveys
    releaseSiteName: obs.beach_sector || '',
    releaseCounty: county,
    releaseStateCountry: stateCountry,
    releaseLatitude: obs.final_latitude?.toString() || obs.latitude?.toString() || '',
    releaseLongitude: obs.final_longitude?.toString() || obs.longitude?.toString() || '',
    comments: commentParts.join('; '),
  };
}

/**
 * Convert array of observations to CMTTP CSV format
 */
export function exportObservationsToCMTTPCSV(
  observations: ObservationWithTurtle[],
  options: {
    projectType?: string;
    county?: string;
    state?: string;
    country?: string;
  } = {}
): string {
  // CSV header row (exact CMTTP format)
  const headers = [
    'PROJECT TYPE',
    'SPECIES',
    'SEX',
    'CAPTURE DATE',
    'SITE NAME',
    'COUNTY',
    'STATE/COUNTRY',
    'CAPTURE LATITUDE',
    'CAPTURE LONGITUDE',
    'EXISTING TAG 1',
    'EXISTING TAG 2',
    'EXISTING PIT TAG',
    'RECAPTURE',
    'APPLIED TAG 1',
    'APPLIED TAG 2',
    'APPLIED PIT TAG',
    'SCL N-T',
    'SCL N-N',
    'SCW',
    'WEIGHT (KG)',
    'CCL N-T',
    'CCL N-N',
    'CCW',
    'RELEASE DATE',
    'RELEASE SITE NAME',
    'RELEASE COUNTY',
    'RELEASE STATE/COUNTRY',
    'RELEASE LATITUDE',
    'RELEASE LONGITUDE',
    'COMMENTS',
  ];

  // Convert observations to rows
  const rows = observations.map(obs => {
    const row = observationToCMTTP(obs, options);
    return [
      row.projectType,
      row.species,
      row.sex,
      row.captureDate,
      row.captureSiteName,
      row.captureCounty,
      row.captureStateCountry,
      row.captureLatitude,
      row.captureLongitude,
      row.existingTag1,
      row.existingTag2,
      row.existingPitTag,
      row.recapture,
      row.appliedTag1,
      row.appliedTag2,
      row.appliedPitTag,
      row.sclNT,
      row.sclNN,
      row.scw,
      row.weightKg,
      row.cclNT,
      row.cclNN,
      row.ccw,
      row.releaseDate,
      row.releaseSiteName,
      row.releaseCounty,
      row.releaseStateCountry,
      row.releaseLatitude,
      row.releaseLongitude,
      row.comments,
    ];
  });

  // Escape CSV fields
  const escapeCSV = (value: string): string => {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  };

  // Build CSV content
  const csvRows = [
    headers.map(escapeCSV).join(','),
    ...rows.map(row => row.map(escapeCSV).join(',')),
  ];

  return csvRows.join('\n');
}

/**
 * Download CMTTP CSV file
 */
export function downloadCMTTPExport(
  observations: ObservationWithTurtle[],
  filename: string = 'cmttp_export.csv',
  options?: {
    projectType?: string;
    county?: string;
    state?: string;
    country?: string;
  }
): void {
  const csv = exportObservationsToCMTTPCSV(observations, options);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
