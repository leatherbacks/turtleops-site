// ─── Argos Fix (core data type) ───

export type ArgosQuality = '3' | '2' | '1' | '0' | 'A' | 'B' | 'Z';

export interface ArgosFix {
  date: Date;
  latitude: number;
  longitude: number;
  quality: ArgosQuality;
  errorRadius: number; // meters (0 if not reported)
  semiMajor: number; // meters
  semiMinor: number; // meters
  orientation: number; // degrees clockwise from north
  // Computed
  effectiveError: number; // meters — errorRadius or empirical fallback
  isOutlier: boolean;
}

// ─── Argos Pass (per-satellite-pass stats) ───

export interface ArgosPass {
  date: Date;
  satellite: string;
  msgCount: number;
  duplicates: number;
  /** null when the source format does not report CRC failures (e.g. Argos DS). */
  corrupt: number | null;
  avgInterval: number;
  locationQuality: string;
  /** Primary (picked) lat/lon */
  latitude: number | null;
  longitude: number | null;
  /** Secondary (mirror) lat/lon — Argos computes two possible positions per pass;
   *  the primary is the one picked based on recent history. The secondary can be
   *  useful diagnostically when the tag is obstructed and the primary looks wrong. */
  latitude2: number | null;
  longitude2: number | null;
  /** Measured frequency in Hz (includes Doppler shift) — useful for RDF gear */
  frequencyHz: number | null;
  /** Received signal strength in dBm (usually negative, e.g. -130 to -140) */
  powerDbm: number | null;
}

// ─── Mirror Solution Check (detects obstructed tags) ───

export type MirrorCheckVerdict =
  | 'primaries_consistent'   // All fixes cluster normally — trust the primaries
  | 'secondaries_match_better' // Secondaries form a tighter cluster than primaries
  | 'insufficient_data'      // Need at least 2 fixes with secondaries to compare
  | 'no_secondaries';        // Argos.csv didn't provide secondaries

export interface MirrorCheck {
  verdict: MirrorCheckVerdict;
  primarySpreadKm: number;
  secondarySpreadKm: number;
  /** If verdict is 'secondaries_match_better', this is the recomputed position */
  correctedLat: number | null;
  correctedLon: number | null;
  /** Human-readable explanation */
  reasoning: string;
  /** Number of passes compared */
  comparisonCount: number;
}

// ─── Tag Status (self-reports) ───

export interface TagStatus {
  date: Date;
  latitude: number | null;
  longitude: number | null;
  temperature: number | null;
  depth: number | null;
  type: string;
  /** Wet/dry sensor readings from WC Status.csv. Range 0–255 where lower
   *  values = wetter (sensor saturated by water), higher values = drier.
   *  - wetDry: instantaneous reading at the time of the status report
   *  - minWetDry: min over the report's accumulation window
   *  - maxWetDry: max over the report's accumulation window
   *  When minWetDry stays near 255 across multiple reports, the tag has
   *  been continuously dry — strong signal that it's off the animal/water.
   */
  wetDry: number | null;
  minWetDry: number | null;
  maxWetDry: number | null;
}

// ─── Time-Series Depth/Temp (Series.csv) ───

export interface SeriesReading {
  date: Date;
  depth: number | null;
  depthRange: number | null; // uncertainty ± meters
  temperature: number | null;
  temperatureRange: number | null;
}

// ─── Light / Geolocation Curves (LightLoc.csv) ───

export type LightLocType = 'Dawn' | 'Dusk' | 'Begin' | 'End' | 'Unknown';

export interface LightCurve {
  date: Date;
  type: LightLocType;
  solarLat: number | null;
  solarLon: number | null;
  initLat: number | null;
  initLon: number | null;
  /** up to 17 light-level samples taken during the curve */
  lightSamples: number[];
  /** corresponding depths for each light sample (meters) */
  depthSamples: number[];
  /** seconds between samples */
  deltaSeconds: number | null;
  minDepth: number | null;
  maxDepth: number | null;
  sstTemp: number | null;
  sstDepth: number | null;
  attenShallow: number | null;
  attenDeep: number | null;
}

// ─── Time-At-Temperature / Time-At-Depth Histograms (Histos.csv) ───
// One row per UTC day per histogram type. Bin edges live in TATLIMITS /
// TADLIMITS rows in the same file; data rows (TAT / TAD) carry counts
// per bin (units = % of day or minutes/day depending on tag config).

export type HistogramKind = 'TAT' | 'TAD';

export interface HistogramReading {
  date: Date;
  kind: HistogramKind;
  /** Per-bin counts (typically % of day in each bin) */
  counts: number[];
}

export interface HistogramSet {
  /** Lower edges of TAT bins in °C (e.g. [8, 12, 14, 16, 18, 20, 22, 24, 26, 28, 30]) */
  tatBinEdges: number[];
  /** Lower edges of TAD bins in meters (e.g. [1, 2, 5, 10, 20, 35, 65, 80, 100, 150, 300]) */
  tadBinEdges: number[];
  tat: HistogramReading[];
  tad: HistogramReading[];
}

// ─── Daily Sensor Summary (DailyData.csv) ───
// One row per UTC day. Pre-aggregated by the tag's firmware: min/max temp,
// min/max depth, daily light delta. The diel temp range (MaxTemp - MinTemp)
// is the cleanest possible input to burial detection — no need to re-bucket
// raw Series readings ourselves.

export interface DailySummary {
  date: Date;
  minTemp: number | null;
  maxTemp: number | null;
  minDepth: number | null;
  maxDepth: number | null;
  deltaLight: number | null;
}

// ─── Daily Dive Summary (MinMaxDepth.csv) ───

export interface DailyDiveSummary {
  date: Date;
  minDepth: number;
  maxDepth: number;
  minAccuracy: number;
  maxAccuracy: number;
}

// ─── Sea Surface Temperature (SST.csv) ───

export interface SSTReading {
  date: Date;
  depth: number;
  temperature: number;
  source: string;
}

// ─── Corrupted Messages (Corrupt.csv) ───

export interface CorruptMessage {
  date: Date;
  reason: string;
  possibleType: string;
}

// ─── Deploy Summary ───

export interface DeploySummary {
  deployId: string;
  ptt: number;
  instrument: string;
  software: string;
  percentDecoded: number;
  passes: number;
  releaseDate: Date | null; // critical for Nault popoff estimation
  releaseType: string;
  deployDate: Date | null;
}

// ─── Drift State ───

export type DriftLabel = 'stuck' | 'drifting' | 'insufficient';

export interface DriftState {
  recent: DriftLabel; // last 24h
  medium: DriftLabel; // last 72h
  allTime: DriftLabel;
  pattern: string; // e.g., "drifted then stuck"
  recentSpreadKm: number;
  mediumSpreadKm: number;
  allTimeSpreadKm: number;
}

// ─── Drift Prediction ───

export interface DriftPrediction {
  speedKmH: number;
  headingDeg: number; // degrees from north
  /** Track window the vector was fitted over — needed to ask what the wind was
   *  doing while the tag was actually moving, versus what it will do next. */
  fitFrom: Date;
  fitTo: Date;
  predictions: {
    hoursAhead: number;
    lat: number;
    lon: number;
    uncertaintyRadiusKm: number; // cone width
  }[];
}

// ─── Drift Forcing Cross-Check ───
// Modelled wind and current beside the measured drift vector. Used to validate
// the extrapolation, never added to it — the vector already contains whatever
// forcing acted while the tag was moving.

export interface ForcingSample {
  time: Date;
  /** Direction the wind blows FROM (meteorological convention). */
  windFromDeg: number | null;
  windSpeedMs: number | null;
  /** Direction the current flows TOWARD (oceanographic convention). */
  currentTowardDeg: number | null;
  currentKmH: number | null;
}

export interface DriftForcing {
  current: { speedKmH: number; towardDeg: number } | null;
  windDuringFit: { speedMs: number; fromDeg: number } | null;
  windAhead: { speedMs: number; fromDeg: number } | null;
  /** Angle between measured drift heading and modelled current set, 0-180. */
  currentAgreementDeg: number | null;
  /** Measured drift speed as a fraction of modelled current speed. */
  currentSpeedRatio: number | null;
  /** Wind materially different now versus during the fit. */
  windShifted: boolean;
  windShiftDeg: number | null;
  windSpeedChangeMs: number | null;
  /** How much to trust extrapolating the measured vector forward. */
  confidence: 'good' | 'caution' | 'low';
  reasoning: string;
}

// ─── Landfall Prediction ───
// Where a drifting tag's predicted path first meets land. Straight-line drift
// extrapolation is land-blind, so without this the app can project a floating
// tag inland. For a recovery the crossing point is the more useful answer than
// an arbitrary +24h position.

export interface LandfallPrediction {
  willStrand: boolean;
  /** False when the drift vector is too old to extrapolate — the projection
   *  declined to answer rather than naming a strand point from stale data. */
  projectable: boolean;
  lat: number | null;
  lon: number | null;
  /** Hours after the last fix at which the path reaches land. */
  hoursFromLastFix: number | null;
  /** True when that moment is already in the past — tag is likely ashore now. */
  alreadyPassed: boolean;
  distanceKm: number | null;
  /** Drift-cone width at the landfall time, i.e. along-shore search spread. */
  uncertaintyKm: number | null;
  /** Spacing between path samples — the resolution of this answer. */
  resolutionKm: number;
  /** How far ahead the path was sampled. */
  horizonHours: number;
  reasoning: string;
}

// ─── Tag Category ───

export type TagCategory = 'psat' | 'tracker';

export interface TagCategoryInfo {
  category: TagCategory;
  instrument: string; // raw Instr value from Summary
  reasoning: string;
}

// ─── Tag State (from Status.csv) ───

export type TagPhase =
  | 'pre_popoff'
  | 'likely_recovered'
  | 'buried'
  | 'stranded_on_land'
  | 'surface'
  | 'partially_submerged'
  | 'submerged'
  | 'unknown';

export interface TagStateInfo {
  phase: TagPhase;
  /** Reasoning behind the phase classification (signals used) */
  reasoning: string;
  lastDepth: number | null; // most recent depth reading (m)
  lastTemperature: number | null; // most recent temperature (°C)
  avgTemperature: number | null; // mean over recent reports
  tempRange: { min: number; max: number } | null;
  depthVariability: number | null; // std dev of depth over recent window
  lastReportDate: Date | null;
  reportCount: number;
  /** Depth series (most recent 20) for sparkline/inspection */
  recentDepths: { date: Date; depth: number }[];
  /** Temperature series (most recent 20) */
  recentTemps: { date: Date; temp: number }[];
}

// ─── Data Quality (from Argos.csv) ───

export interface DataQuality {
  totalPasses: number;
  totalMessages: number;
  totalDuplicates: number;
  totalCorrupt: number;
  /** null when the source format does not report CRC failures (Argos DS). */
  corruptPct: number | null;
  avgMsgPerPass: number;
  firstPass: Date | null;
  lastPass: Date | null;
  /** Median transmit frequency in MHz, estimated from observed passes.
   *  Raw Argos samples include Doppler shift; the median across many passes
   *  approximates the tag's nominal frequency. */
  nominalFrequencyMHz: number | null;
}

// ─── Analysis Result ───

// ─── Tidal Intrusion (post-release) ───

// ─── Transmission repetition rate ───

/** One reception, as used to measure how often the tag transmits. */
export interface TransmissionTime {
  date: Date;
  satellite: string;
}

/**
 * How often the tag transmits, measured from its own message timestamps.
 *
 * A per-deployment configuration value that rarely appears in any export. For a
 * field team it decides whether a silence means "wrong place" or "not yet".
 */
export interface RepetitionRate {
  /** Nominal period in seconds. */
  periodS: number;
  /** Spread around it — Argos randomises the period deliberately. */
  jitterS: number;
  observedMinS: number;
  observedMaxS: number;
  sampleCount: number;
  /** Sub-second repeats discarded as the same transmission logged twice. */
  duplicatesDiscarded: number;
  /** Gaps at 2x, 3x... the period — lost messages, and confirmation of the base. */
  harmonics: { multiple: number; count: number }[];
  /** Share of gaps explained by the period and its harmonics. */
  fractionExplained: number;
  /** Silence beyond this means the tag stopped, not that a message was lost. */
  silenceThresholdS: number;
  /**
   * Shortest interval observed early in the record, and recently.
   *
   * Measured across all satellites, so it works at both fast and slow schedules
   * — but it is a FLOOR, not the period: jitter drags it below periodS. Use it
   * only through rateStepRatio, which compares like with like. Do not present
   * either figure as the tag's transmission interval; periodS is that.
   */
  earlyPeriodS: number | null;
  latePeriodS: number | null;
  /** latePeriodS / earlyPeriodS. Above ~3 the schedule has stepped down. */
  rateStepRatio: number | null;
  /**
   * The transmission schedule has slowed sharply. These tags buffer each burst
   * in a capacitor, so received power stays flat regardless of cell state and is
   * useless as a battery indicator — a step down in interval is how a
   * low-voltage threshold announces itself, and it means days not weeks.
   */
  slowedDown: boolean;
  confidence: 'high' | 'moderate' | 'low';
  reasoning: string;
}

// ─── Lotek activity-health message (decoded from the raw Argos payload) ───

/**
 * One activity-health record from a Lotek PSAT+.
 *
 * The only post-release sensor data these tags produce: the Day Log and Dive
 * Log stop when the archive schedule ends, which can be days before the tag
 * releases. Temperature, light and depth after pop-off arrive only here.
 */
export interface LotekHealthRecord {
  /** When the satellite received it. */
  date: Date;
  /** Byte 1 — a format/config version, constant per deployment. */
  formatByte: number;
  /** The tag's own clock, seconds, to 1/256 s. */
  tagSeconds: number;
  /** Raw status byte. 0x80 is the only value yet observed on a valid record. */
  statusByte: number;
  /** Bit 7 of the status byte. Lotek renders 0x80 as "Wet Schedule", but the
   *  field has never varied, so it cannot yet distinguish a live conductivity
   *  reading from a latched enum. Do not present it as current wet/dry state. */
  wetFlag: boolean;
  serial: number;
  depthM: number;
  messageCounter: number;
  /** Latched from the release event — constant, not live telemetry. */
  corrosionTimeS: number;
  corrosionStartV: number;
  corrosionEndV: number;
  temperatureC: number;
  /** Raw counts; full scale is uncalibrated, so read as relative. */
  light: number;
}

// ─── Argos pass geometry / mirror solutions ───

/** Geometry of the satellite pass that produced one Doppler fix. */
export interface PassGeometry {
  date: Date;
  satellite: string;
  quality: string;
  latitude: number;
  longitude: number;
  /** Satellite elevation above the horizon as seen from the fix, degrees. */
  elevationDeg: number;
  slantRangeKm: number;
  /** How far the tag sat from the satellite's ground track. */
  crossTrackKm: number;
  /** The other Doppler solution — reflection across the orbital plane. */
  mirrorLat: number;
  mirrorLon: number;
  mirrorSeparationKm: number;
  /** Distance from the trusted fix cluster; null when there is no cluster. */
  primaryClusterKm: number | null;
  mirrorClusterKm: number | null;
  /** The two solutions are close enough that CLS could have swapped them. */
  ambiguous: boolean;
  /** Ambiguous AND the mirror fits the rest of the track better. */
  suspect: boolean;
}

export interface PassGeometryAnalysis {
  fixes: PassGeometry[];
  /** Fixes skipped because no orbital elements exist near enough in time. */
  tlesTooStale: number;
  /** Largest epoch-to-fix gap actually used, in days. */
  maxTleAgeDays: number;
  /** True when elements are stale enough to widen the error meaningfully. */
  tleAgeWarning: boolean;
  ambiguousCount: number;
  suspectCount: number;
  /** Fixes below 15 degrees elevation, where Doppler geometry is weak. */
  lowElevationCount: number;
  medianElevationDeg: number;
  medianCrossTrackKm: number;
  /** Passes skipped because no TLE matched the satellite. */
  tlesMissing: number;
  reasoning: string;
}

// ─── Tide-phase transmission analysis ───

/** One NOAA predicted high or low water. */
export interface TideExtreme {
  time: Date;
  type: 'H' | 'L';
  /** Metres relative to MLLW. */
  height: number;
}

/** Messages received in one band of the tidal range, split by direction. */
export interface TidePhaseBin {
  /** e.g. "0–20% (low)" — fraction of the tidal range above low water. */
  label: string;
  fallingMessages: number;
  risingMessages: number;
}

/**
 * Whether reception tracks the tide, and when to be standing there with a
 * receiver. Counts are exposure-corrected: passes are the denominator, so a
 * clustering of satellite passes on one phase cannot masquerade as a tidal
 * effect.
 */
export interface TidePhaseAnalysis {
  fallingMessages: number;
  risingMessages: number;
  /** Satellite passes in each phase — the exposure baseline. */
  fallingPasses: number;
  risingPasses: number;
  messagesPerPassFalling: number;
  messagesPerPassRising: number;
  /** How much better the dominant phase is, per pass. null when one phase had none. */
  excessRatio: number | null;
  dominant: 'falling' | 'rising' | 'neither';
  strength: 'strong' | 'moderate' | 'none';
  /** True only when every window tested agreed. A finding that appears at one
   *  cutoff and not others is an artefact of that cutoff, not a result. */
  robust: boolean;
  /** Min and max excess across the windows tested — the honest error bar. */
  excessRange: [number, number] | null;
  bins: TidePhaseBin[];
  /** Next stretch of the productive phase, narrowed to its best level band. */
  bestWindow: {
    legFrom: Date;
    legTo: Date;
    peakFrom: Date;
    peakTo: Date;
    peakBandLabel: string;
  } | null;
  /** Fraction of passes that fell inside the tide table. */
  coverage: number;
  /** Days of history analysed, or null when the whole record was used. */
  windowDays: number | null;
  analyzedFrom: Date;
  analyzedTo: Date;
  reasoning: string;
}

export interface TidalIntrusion {
  /** Is the tag being flooded/drained by tides? */
  detected: boolean;
  /** Confidence 0-1 based on periodicity strength */
  confidence: number;
  /** Description of the pattern */
  reasoning: string;
  /** % of post-release readings where tag was wet (depth > 0.2m) */
  wetPct: number;
  /** Max depth seen post-release (tidal peak) */
  maxPostReleaseDepth: number;
  /** Estimated cycle period in hours (should be ~12 for semidiurnal, ~24 for diurnal) */
  cyclePeriodHours: number | null;
}

export interface DiveProfile {
  totalReadings: number;
  firstReading: Date;
  lastReading: Date;
  maxDepth: number;
  avgDepth: number;
  tempRange: { min: number; max: number } | null;
  /** Surface time percentage (depth < 1m) */
  surfaceTimePct: number;
  /** Downsampled series for display (max 300 points) */
  displaySeries: { date: Date; depth: number | null; temp: number | null }[];
}

// ─── Release Type Interpretation ───
// Derived from Summary.csv's ReleaseType field — tells us WHY the tag released.

export type ReleaseCategory =
  | 'scheduled'     // Interval / Date — tag released at pre-programmed time
  | 'detachment'    // Tag floating at surface (animal shed it)
  | 'floater'       // Animal likely dead at surface — dry readings dominated
  | 'sitter'        // Stuck at constant depth — mortality or entanglement
  | 'sinker'        // Sank below threshold — mortality and descent
  | 'crush_depth'   // Failsafe triggered near crush depth (~1700m)
  | 'unknown';

export interface ReleaseInterpretation {
  category: ReleaseCategory;
  rawType: string;
  label: string;
  implication: string;
  /** Severity/concern level — 'info' for normal, 'warning' for conditional, 'alert' for mortality signals */
  severity: 'info' | 'warning' | 'alert';
}

// ─── Light Analysis (from LightLoc.csv) ───

export type LightPattern =
  | 'normal_diurnal'   // Clear dawn/dusk curves — tag in open water/sky exposure
  | 'buried'           // Zero/near-zero light even at midday — likely under sand or sediment
  | 'shaded'           // Consistently low light during daytime — under tree canopy or structure
  | 'indoor'           // Erratic light pattern not matching natural day/night — artificial lighting
  | 'fully_dark'       // No light at all — deeply buried or inside opaque container
  | 'insufficient'
  | 'unknown';

export interface LightAnalysis {
  pattern: LightPattern;
  reasoning: string;
  confidence: number;
  /** Mean daytime light level across all post-release curves (0-250 typical Argos units) */
  meanDaytimeLight: number | null;
  /** Mean nighttime light level (should be near 0 in normal conditions) */
  meanNighttimeLight: number | null;
  curveCount: number;
  postReleaseCurveCount: number;
}

// ─── Temperature Comparison ───

export type TempEnvironment =
  | 'in_water'
  | 'in_air_exposed'
  | 'in_air_insulated'
  | 'air_conditioned' // tag is cooler than outside air — AC'd building, cooler, fridge
  | 'anomalous_hot'
  | 'insufficient'
  | 'unknown';

export interface TempComparison {
  environment: TempEnvironment;
  reasoning: string;
  tagTempRange: { min: number; max: number } | null;
  airTempC: number | null;
  sstTempC: number | null;
  tagMinusSST: number | null;
  tagMinusAir: number | null;
  confidence: number;
}

// ─── Burial Detection (thermal signature) ───
// A tag buried in sand shows a very specific thermal profile: tiny diurnal
// amplitude (0.3–1.4 °C at nest-chamber depth per published sea turtle
// nest studies, vs 10+ °C for a surface-exposed tag), smooth low-slope
// curve, and mean tracking daily-mean ambient. This is a positive-ID
// signal — distinguishable from in-water (low amplitude, mean matches SST)
// and AC building (low amplitude, mean much lower than ambient).

export type BurialVerdict =
  | 'buried_in_sand'     // low amplitude + on-land-ish mean
  | 'surface_exposed'    // high amplitude — wide diurnal swing
  | 'insulated_indoor'   // low amplitude but mean far from ambient (AC, heated room, vehicle)
  | 'in_water'           // low amplitude + mean matches SST
  | 'insufficient'
  | 'unknown';

export interface BurialDetection {
  verdict: BurialVerdict;
  reasoning: string;
  /** Median diel (24-hour) temperature amplitude in °C */
  medianDielAmplitudeC: number | null;
  /** Median temp across post-release readings, for context */
  medianTempC: number | null;
  /** Number of 24-hour windows used in the calculation */
  windowsAnalyzed: number;
  confidence: number;
}

// ─── Bathymetry ───

export interface Bathymetry {
  /** Seabed depth at the tag's position (meters below sea level, positive number) */
  seabedDepthM: number | null;
  source: 'gebco' | 'unavailable';
  interpretation: string;
  tagOnSeabed: boolean;
}

// ─── Tracker Tag Separation Detection ───
// For LIVE tracker tags (instrument=UT etc) that aren't PSATs and don't pop
// off — when the tag is removed from the animal or sheds spontaneously, it
// starts behaving like a PSAT post-popoff: stationary, transmitting from a
// fixed location, needs to be physically recovered. This detector spots that
// transition so the tool can switch from "where is this animal" to "where
// is this tag sitting now" — and all the existing recovery-brief / burial /
// transmission-health analyzers apply to the stationary period.

export type TrackerShedVerdict = 'separated' | 'still_moving' | 'insufficient';

export interface TrackerShedDetection {
  verdict: TrackerShedVerdict;
  reasoning: string;
  /** Hours of continuous stationary behavior detected (0 if not separated) */
  stationaryHours: number;
  /** Spread of fixes during the stationary period, in meters */
  recentSpreadM: number;
  /** Historic spread (last 30d, or all-time if shorter) — proves the tag DID move before */
  historicSpreadKm: number;
  /** Centroid of the stationary cluster, if detected */
  stationaryLat: number | null;
  stationaryLon: number | null;
  /** Timestamp of the first fix in the stationary cluster — when separation likely happened */
  separatedSinceISO: string | null;
  confidence: number;
}

// ─── Transmission Health Trend ───
// Tracks whether the tag's signal is degrading post-release. CRC failure rate,
// transmit power, and frequency drift each carry independent diagnostic signal
// about thermal stress, antenna obstruction, and battery health.

export type TransmissionTrend = 'stable' | 'degrading' | 'failing' | 'insufficient';

export interface TransmissionHealthWindow {
  /** Center date of the window (for plotting on a timeline) */
  date: Date;
  /** Total message count heard from Argos in this window */
  totalMessages: number;
  /** Corrupt (CRC-failed) message count */
  corruptMessages: number;
  /** Corrupt % (0–100) for this window */
  corruptPct: number;
  /** Mean received signal power (dBm) — more negative = weaker */
  meanPowerDbm: number | null;
  /** Mean frequency offset from 401.650 MHz nominal, in Hz — how far the tag has drifted */
  meanFrequencyOffsetHz: number | null;
}

export interface TransmissionHealth {
  trend: TransmissionTrend;
  /** Human-readable interpretation of the signals together */
  reasoning: string;
  /** Rolling-window buckets — ordered by time, suitable for a sparkline */
  windows: TransmissionHealthWindow[];
  /** Overall CRC % across all post-release passes; null when the source
   *  format does not report CRC failures at all (e.g. the Argos DS dump). */
  overallCorruptPct: number | null;
  /** Trend in corrupt % (negative = improving, positive = worsening) — per day */
  corruptPctSlopePerDay: number;
  /** Trend in mean power — negative = weakening, per day, dBm/day */
  powerSlopePerDayDbm: number | null;
  /** Trend in frequency offset — non-zero = thermal drift, per day, Hz/day */
  frequencySlopePerDayHz: number | null;
}

// ─── Antenna Exposure Analysis ───
// Diagnoses the physical condition of the tag's antenna from its reception
// pattern. If received passes cluster at high elevations while missed passes
// are at low elevations, the antenna has a limited sky-view cone.

export type ExposurePattern =
  | 'clear'              // Reception works at all elevations — antenna exposed
  | 'horizon_obstructed' // Only mid/high elevations work — horizon blocked all around
  | 'narrow_cone'        // Only very high elevations work — tiny sky window
  | 'directional'        // Received passes cluster in one compass direction
  | 'too_few_passes'     // Not enough data to conclude
  | 'unknown';

/** Best-fit physical orientation of the tag's whip antenna, inferred from
 *  the elevation/azimuth pattern of received vs missed passes. */
export interface AntennaOrientation {
  /** Angle from vertical, 0=upright, 90=lying flat */
  tiltDeg: number;
  /** Compass heading the tilt is in (only meaningful when tilted >15°);
   *  null when antenna is essentially vertical */
  tiltHeadingDeg: number | null;
  /** Plain-English summary, e.g. "Antenna near-vertical (tilt 12°)" */
  description: string;
  /** Confidence 0–1 based on how well the best fit explains the data */
  confidence: number;
  /** Number of passes used to fit */
  passCount: number;
}

export interface AntennaExposure {
  pattern: ExposurePattern;
  /** Minimum peak elevation (°) among received passes */
  minReceivedElevation: number | null;
  /** Mean peak elevation (°) among received passes */
  meanReceivedElevation: number | null;
  /** Mean peak elevation (°) among missed passes */
  meanMissedElevation: number | null;
  /** Estimated elevation cutoff — above this, reception works; below it, fails */
  elevationCutoffDeg: number | null;
  /** Mean azimuth of received passes (compass direction, 0-360) */
  meanReceivedAzimuth: number | null;
  /** Is reception biased to one compass quadrant? */
  azimuthBias: 'N' | 'E' | 'S' | 'W' | 'symmetric' | null;
  /** Human-readable interpretation */
  reasoning: string;
  /** Confidence 0-1 */
  confidence: number;
  /** Best-fit physical orientation of the antenna whip (tilt + heading).
   *  Null when there aren't enough received passes to fit reliably. */
  orientation: AntennaOrientation | null;
}

// ─── Satellite Coverage Analysis ───

export interface SatCoverage {
  totalPredicted: number;
  totalReceived: number;
  receptionRate: number; // 0-1
  /** Per-satellite breakdown — serving satellites only. */
  perSat: {
    name: string;
    predicted: number;
    received: number;
    rate: number;
  }[];
  /** Satellites that never heard this tag across enough passes to conclude they
   *  are not carrying it. Excluded from the rate and from obstruction analysis,
   *  reported so the exclusion is visible rather than silent. */
  nonServing: { name: string; predicted: number }[];
  /** Direction bias: ascending (N-going) vs descending (S-going) */
  ascendingPredicted: number;
  ascendingReceived: number;
  descendingPredicted: number;
  descendingReceived: number;
  /** Interpretation of the pattern */
  diagnosis: string;
  /** Quality score: 'healthy' | 'marginal' | 'poor' */
  health: 'healthy' | 'marginal' | 'poor' | 'unknown';
  /** Per-pass annotations for sky-chart rendering */
  passes: AnnotatedPass[];
}

/** A predicted pass with reception annotation and sky trajectory */
export interface AnnotatedPass {
  satelliteName: string;
  riseTime: Date;
  setTime: Date;
  maxElevation: number;
  peakAzimuth: number;
  riseAzimuth: number;
  setAzimuth: number;
  direction: 'ascending' | 'descending';
  received: boolean;
  /** Azimuth/elevation samples for drawing the arc (every ~30s) */
  trackPoints: { azimuth: number; elevation: number }[];
}

export interface AnalysisResult {
  // Tag info
  summary: DeploySummary | null;
  ptt: number | null;
  tagCategory: TagCategoryInfo;
  diveProfile: DiveProfile | null;
  sst: SSTReading[] | null;
  dailyDives: DailyDiveSummary[] | null;
  corruptCount: number;
  tidalIntrusion: TidalIntrusion | null;
  satCoverage: SatCoverage | null;
  mirrorCheck: MirrorCheck | null;
  antennaExposure: AntennaExposure | null;
  releaseInterpretation: ReleaseInterpretation | null;
  /** If dive profile shows pre-release descent to near crush depth (~1700m), this is a mortality+sink signal */
  crushDepthEvent: { detected: boolean; maxDepthM: number; reasoning: string } | null;
  lightAnalysis: LightAnalysis | null;
  tempComparison: TempComparison | null;
  bathymetry: Bathymetry | null;
  transmissionHealth: TransmissionHealth | null;
  /** Post-release sensor records decoded from Lotek activity-health payloads. */
  lotekHealth: LotekHealthRecord[] | null;
  /** How often the tag transmits, measured from its own message timestamps. */
  repetitionRate: RepetitionRate | null;
  /** True if the health status byte ever changed — see LotekHealthRecord.wetFlag. */
  lotekHealthStatusChanged: boolean;
  burialDetection: BurialDetection | null;
  trackerShed: TrackerShedDetection | null;

  // Fixes
  allFixes: ArgosFix[];
  validFixes: ArgosFix[]; // after quality filter + outlier removal
  outlierFixes: ArgosFix[];

  // Position
  bestLat: number;
  bestLon: number;
  positionMethod: 'weighted_mean' | 'recent_only';

  // Drift
  driftState: DriftState;
  driftPrediction: DriftPrediction | null; // null if stuck
  /** Predicted first land crossing; computed async once elevations resolve. */
  landfall: LandfallPrediction | null;
  /** Modelled wind/current cross-check on the drift vector; computed async. */
  driftForcing: DriftForcing | null;

  // Search area
  primaryRadiusM: number;
  expandedRadiusM: number;
  /** Plain-English account of what the radius is made of. */
  searchRadiusBasis: string;

  // Popoff
  popoff: PopoffResult | null;
  /** Explanation of why popoff could not be estimated (null if popoff is estimated) */
  popoffSkipReason: string | null;

  // Tag state (from Status.csv — optional)
  tagState: TagStateInfo | null;

  // Data quality (from Argos.csv — optional)
  dataQuality: DataQuality | null;
}

// ─── Popoff Result ───

export interface PopoffResult {
  lat: number;
  lon: number;
  method: 'target-tag' | 'proxy-tag';
  driftTimeHours: number;
  ellipseSemiMajorM: number;
  ellipseSemiMinorM: number;
  ellipseOrientationDeg: number;
}

// ─── Environment ───

export interface EnvironmentData {
  elevation: {
    meters: number;
    source: 'usgs' | 'open-elevation';
    classification: 'land' | 'intertidal' | 'water';
  } | null;
  weather: {
    temperature: number; // °C
    windSpeed: number; // km/h
    windDirection: string;
    conditions: string;
    source: 'nws' | 'open-meteo';
  } | null;
  tides: {
    current: 'rising' | 'falling' | 'high' | 'low' | 'unknown';
    nextHigh: { time: Date; height: number } | null;
    nextLow: { time: Date; height: number } | null;
    lastEvent: { time: Date; height: number; type: 'H' | 'L' } | null;
    tidalRange: number | null; // feet, difference between next H and next L
    station: string;
    stationDistanceKm: number;
  } | null;
  location: {
    name: string; // e.g., "Caminada Headland, Lafourche Parish, LA"
    county: string;
    state: string;
    source: 'census' | 'nominatim';
  } | null;
  bathymetry: {
    seabedDepthM: number | null; // null = on land per GEBCO
    rawElevationM: number;
    source: 'gebco';
  } | null;
  forecast: {
    days: ForecastDay[];
    stormAlert: boolean;
    alertReason: string | null;
    peakWindKn: number | null;
    peakWaveM: number | null;
  } | null;
}

export interface ForecastDay {
  date: string; // YYYY-MM-DD
  tempMaxC: number | null;
  tempMinC: number | null;
  precipitationMm: number | null;
  windMaxKn: number | null;
  windGustKn: number | null;
  windDirectionDeg: number | null;
  waveMaxM: number | null;
  wavePeriodS: number | null;
  waveDirectionDeg: number | null;
  weatherCode: number | null;
}

// ─── File Detection ───

/** What built the tag. */
export type Manufacturer = 'wildlife_computers' | 'lotek';

/**
 * Who produced the *file*, which is not the same question as who made the tag.
 * Wildlife Computers and Lotek both emit their own sensor exports, but the
 * Argos/CLS products (the DS text dump, the Doppler spreadsheet) are generated
 * by CLS and look identical whatever hardware is transmitting. A DS file alone
 * therefore tells us nothing about the manufacturer — and doesn't need to,
 * since every analyzer downstream of it works off normalized Argos types.
 */
export type FileSource = 'wildlife_computers' | 'lotek' | 'argos_cls';

export type FileType =
  // Wildlife Computers
  | 'locations'
  | 'argos'
  | 'status'
  | 'summary'
  | 'series'
  | 'sst'
  | 'minmaxdepth'
  | 'corrupt'
  | 'lightloc'
  | 'dailydata'
  | 'histos'
  // Lotek
  | 'lotek_daylog'
  | 'lotek_divelog'
  // Argos / CLS — manufacturer-agnostic
  | 'argos_ds'
  | 'argos_messages'
  | 'unknown';

export interface DetectedFile {
  file: File;
  /** Inferred tag manufacturer; 'unknown' for manufacturer-agnostic Argos files. */
  manufacturer: Manufacturer | 'unknown';
  /** Who produced this file. */
  source: FileSource | 'unknown';
  fileType: FileType;
  /** Set when a file was recognised but could not be parsed safely. */
  warning?: string;
}

/**
 * What a parsed dataset can actually support, so the UI can skip analyzers
 * instead of rendering their "unknown" verdicts as though they were findings.
 * An absent capability is a statement about the data, not about the tag.
 */
export interface DatasetCapabilities {
  manufacturer: Manufacturer | 'unknown';
  /** Argos fixes with per-fix error ellipses (WC Locations; not the CLS DS dump). */
  errorEllipses: boolean;
  /** Secondary ("mirror") Argos solutions — needed by mirrorCheck. */
  mirrorSolutions: boolean;
  /** Wet/dry conductivity readings — needed by tagState. */
  wetDry: boolean;
  /** Raw light-level curves — needed by lightLevel. */
  lightCurves: boolean;
  /** Per-pass CRC/corrupt counts and received power — transmissionHealth detail. */
  transmissionDiagnostics: boolean;
  /** A deploy summary carrying ReleaseType/ReleaseDate — needed by popoff + releaseType. */
  deploySummary: boolean;
  /** Depth/temperature time series. */
  depthSeries: boolean;
}

// ─── App State ───

export type AppPhase = 'idle' | 'parsing' | 'analyzed' | 'enriched';

export type UnitSystem = 'imperial' | 'metric';
