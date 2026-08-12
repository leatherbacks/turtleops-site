import type { ArgosQuality } from './types';

// ─── Empirical Argos Errors (Boyd & Brightsmith 2013) ───
// Used as fallback when error_radius and semi-major/minor are 0 in CSV

export const EMPIRICAL_ERRORS: Record<ArgosQuality, number> = {
  '3': 514,
  '2': 762,
  '1': 1920,
  'A': 1640,
  '0': 5493,
  'B': 14098,
  'Z': Infinity, // discard
};

// ─── Quality Tiers ───

/** Qualities used for position estimation (weighted) */
export const POSITION_QUALITIES: ArgosQuality[] = ['3', '2', '1', 'A'];

/** Qualities shown as context only (too uncertain for position calc) */
export const CONTEXT_QUALITIES: ArgosQuality[] = ['B'];

/** Qualities discarded entirely */
export const DISCARD_QUALITIES: ArgosQuality[] = ['Z'];

// ─── Drift Classification Thresholds ───

/** Max pairwise spread (meters) below which a tag is "stuck" */
export const STUCK_THRESHOLD_M = 500;

/** Max pairwise spread (meters) above which a tag is "drifting" */
export const DRIFT_THRESHOLD_M = 2000;

/** Minimum window duration (hours) to make a classification */
export const MIN_WINDOW_HOURS = 24;

// ─── Outlier Detection ───

/** Distance from median (km) to flag as outlier for stuck tags */
export const STUCK_OUTLIER_DISTANCE_KM = 50;

/** Max plausible drift speed (km/h) for temporal outlier detection */
export const MAX_DRIFT_SPEED_KMH = 5;

// ─── Search Radius ───

/** Minimum search radius (meters) */
export const MIN_SEARCH_RADIUS_M = 500;

/** Expanded radius multiplier */
export const EXPANDED_RADIUS_MULTIPLIER = 1.5;

// ─── Drift Prediction ───

/** Hours ahead to predict for drifting tags */
export const PREDICTION_HOURS = [6, 12, 24];

/** Number of recent fixes to use for drift trajectory calculation */
export const DRIFT_TRAJECTORY_FIX_COUNT = 5;

// ─── Land/Water Classification (elevation thresholds) ───

/** Above this elevation (meters) → likely on land */
export const LAND_THRESHOLD_M = 0.5;

/** Seabed depth beyond which a position is open water rather than intertidal.
 *  Terrain models report 0 m over the sea, so bathymetry has to break the tie. */
export const INTERTIDAL_MAX_DEPTH_M = 2;

// ─── Rate Limits ───

export const MAX_ANALYSES_PER_DAY = 10;

// ─── Map Marker Colors (from brief) ───

export const MARKER_COLORS = {
  current: { fill: '#d32f2f', border: '#b71c1c' },
  popoff: { fill: '#fbc02d', border: '#f57f17' },
  q3: { fill: '#1565c0', border: '#0d47a1' },
  q2: { fill: '#0097a7', border: '#00695c' },
  q1a: { fill: '#7b1fa2', border: '#4a148c' },
  b: { fill: '#666666', border: '#444444' },
  outlier: { fill: '#999999', border: '#666666' },
  searchPrimary: '#d32f2f',
  searchExpanded: '#f57c00',
  bcee: '#7b1fa2',
} as const;
