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
  corrupt: number;
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
  predictions: {
    hoursAhead: number;
    lat: number;
    lon: number;
    uncertaintyRadiusKm: number; // cone width
  }[];
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
  corruptPct: number;
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
  /** Overall CRC % across all post-release passes */
  overallCorruptPct: number;
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
}

// ─── Satellite Coverage Analysis ───

export interface SatCoverage {
  totalPredicted: number;
  totalReceived: number;
  receptionRate: number; // 0-1
  /** Per-satellite breakdown */
  perSat: {
    name: string;
    predicted: number;
    received: number;
    rate: number;
  }[];
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
  burialDetection: BurialDetection | null;

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

  // Search area
  primaryRadiusM: number;
  expandedRadiusM: number;

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

export type Manufacturer = 'wildlife_computers';
export type FileType =
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
  | 'unknown';

export interface DetectedFile {
  file: File;
  manufacturer: Manufacturer | 'unknown';
  fileType: FileType;
}

// ─── App State ───

export type AppPhase = 'idle' | 'parsing' | 'analyzed' | 'enriched';

export type UnitSystem = 'imperial' | 'metric';
