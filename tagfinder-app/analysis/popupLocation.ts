/**
 * Pop-up location estimation and error ellipse computation
 * 
 * Ported from Nault et al. 2024 (Animal Biotelemetry 12:7)
 * "Estimation of pop-up satellite archival tag initial surface position"
 * https://doi.org/10.1186/s40317-024-00360-7
 * 
 * Original R function: estimate_errors (Additional file 4)
 * 
 * This estimates where an animal was when a PSAT tag released (P0),
 * given the first two high-quality Argos drift fixes after popoff (P1, P2)
 * using the TARGET-TAG METHOD. See paper for PROXY-TAG METHOD variant.
 */

export interface ArgosFix {
  /** Latitude in decimal degrees */
  lat: number;
  /** Longitude in decimal degrees */
  lon: number;
  /** Timestamp (ms since epoch) */
  time: number;
  /** Argos error ellipse semi-major axis in meters */
  semiMajor: number;
  /** Argos error ellipse semi-minor axis in meters */
  semiMinor: number;
  /** Argos error ellipse orientation, degrees clockwise from north */
  orientation: number;
}

export interface PopupEstimate {
  /** Estimated pop-off location */
  lat: number;
  lon: number;
  /** Composite error ellipse at the requested confidence level */
  ellipseSemiMajor: number;    // meters
  ellipseSemiMinor: number;    // meters
  ellipseOrientation: number;  // degrees clockwise from north
  /** Drift time from popoff to P1, in hours */
  driftTimeHours: number;
}

// Chi-squared inverse CDF for 2 degrees of freedom at common levels
// For arbitrary P, use a proper implementation (e.g., jstat.chisquare.inv)
const CHI2_INV_DOF2: Record<string, number> = {
  '0.63': 2.0,      // Argos native confidence level
  '0.68': 2.279,
  '0.95': 5.991,
  '0.99': 9.210,
};

function chi2Inv(p: number): number {
  const key = p.toFixed(2);
  if (CHI2_INV_DOF2[key] !== undefined) return CHI2_INV_DOF2[key];
  // Fallback: Wilson-Hilferty approximation for df=2
  // Good enough for confidence levels in the 0.5–0.99 range
  const z = inverseNormalCDF(p);
  return 2 * Math.pow(1 - 1/9 + z * Math.sqrt(1/9), 3);
}

function inverseNormalCDF(p: number): number {
  // Beasley-Springer-Moro approximation
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
             1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
             6.680131188771972e+01, -1.328068155288572e+01];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number, r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((a[0]*q + a[1])*q + a[2])*q + a[3])*q + a[4])*q + a[5]) /
           ((((b[0]*q + b[1])*q + b[2])*q + b[3])*q + b[4] + 1);
  } else if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (((((a[0]*r + a[1])*r + a[2])*r + a[3])*r + a[4])*r + a[5])*q /
           (((((b[0]*r + b[1])*r + b[2])*r + b[3])*r + b[4])*r + 1);
  } else {
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((a[0]*q + a[1])*q + a[2])*q + a[3])*q + a[4])*q + a[5]) /
             ((((b[0]*q + b[1])*q + b[2])*q + b[3])*q + b[4] + 1);
  }
}

/** 2x2 symmetric matrix represented as [xx, xy, yy] */
type Sigma2 = [number, number, number];

/**
 * Build a 2x2 covariance matrix from an Argos error ellipse.
 * Argos reports orientation as degrees CW from north; convert to
 * math-standard angle (CCW from east) via theta = 90° - orientation.
 * The 63% contour uses C = sqrt(2), so std devs are semiAxis/C.
 */
function ellipseToCovariance(
  semiMajor: number,
  semiMinor: number,
  orientationDeg: number
): Sigma2 {
  const C = Math.sqrt(2);
  const lam1 = (semiMajor / C) ** 2;  // variance along major axis
  const lam2 = (semiMinor / C) ** 2;  // variance along minor axis
  const theta = Math.PI / 2 - (Math.PI / 180) * orientationDeg;
  const c = Math.cos(theta), s = Math.sin(theta);
  // Sigma = lam1 * e1 e1^T + lam2 * e2 e2^T
  // e1 = [c, s],  e2 = [-s, c]
  const xx = lam1 * c * c + lam2 * s * s;
  const xy = lam1 * c * s - lam2 * s * c;
  const yy = lam1 * s * s + lam2 * c * c;
  return [xx, xy, yy];
}

/** Eigendecomposition of a 2x2 symmetric matrix. Returns [larger eigenvalue, smaller, angle_rad_of_larger_eigvec] */
function eigen2x2(sigma: Sigma2): { lam1: number; lam2: number; angleRad: number } {
  const [a, b, d] = sigma;
  const tr = a + d;
  const det = a * d - b * b;
  const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
  const lam1 = tr / 2 + disc;
  const lam2 = tr / 2 - disc;
  // Eigenvector for lam1: solve (A - lam1*I) v = 0
  // If b != 0: v = [lam1 - d, b] (or equivalently [b, lam1 - a])
  let vx: number, vy: number;
  if (Math.abs(b) > 1e-12) {
    vx = lam1 - d;
    vy = b;
  } else {
    // Diagonal matrix
    if (a >= d) { vx = 1; vy = 0; } else { vx = 0; vy = 1; }
  }
  const angleRad = Math.atan2(vy, vx);
  return { lam1, lam2, angleRad };
}

/**
 * Compute the composite error ellipse for an estimated pop-up location.
 * Direct port of Nault et al. 2024's `estimate_errors` R function.
 * 
 * @param p1 First high-quality Argos drift location
 * @param p2 Second Argos drift location (after P1)
 * @param popoffTime Timestamp of tag release from animal
 * @param confidence Probability contour level (default 0.63 = Argos native; use 0.95 for BCEE)
 * @returns Semi-major, semi-minor (meters), and orientation (deg CW from N)
 */
export function computeEllipse(
  p1: ArgosFix,
  p2: ArgosFix,
  popoffTime: number,
  confidence: number = 0.63
): { semiMajor: number; semiMinor: number; orientationDeg: number } {
  // Drift times in consistent units (hours, though ratio is unitless so any unit works)
  const driftT0 = (p1.time - popoffTime) / (1000 * 3600);  // P0 -> P1
  const driftT  = (p2.time - p1.time)      / (1000 * 3600); // P1 -> P2
  
  // Covariances for P1 and P2
  const Sigma1 = ellipseToCovariance(p1.semiMajor, p1.semiMinor, p1.orientation);
  const Sigma2 = ellipseToCovariance(p2.semiMajor, p2.semiMinor, p2.orientation);
  
  // Linear combination: P0 = a*P1 + b*P2
  const a = (driftT0 + driftT) / driftT;
  const b = -driftT0 / driftT;
  
  // Sigma_P0 = a^2 * Sigma1 + b^2 * Sigma2 (P1, P2 assumed independent)
  // (This is M * joint_Sigma * M^T simplified.)
  const sigmaP0: Sigma2 = [
    a * a * Sigma1[0] + b * b * Sigma2[0],
    a * a * Sigma1[1] + b * b * Sigma2[1],
    a * a * Sigma1[2] + b * b * Sigma2[2],
  ];
  
  // Eigendecomposition -> ellipse axes
  const { lam1, lam2, angleRad } = eigen2x2(sigmaP0);
  const CC = Math.sqrt(chi2Inv(confidence));
  const semiMajor = Math.sqrt(Math.max(0, lam1)) * CC;
  const semiMinor = Math.sqrt(Math.max(0, lam2)) * CC;
  // Convert eigenvector angle (CCW from east, radians) back to Argos convention
  // (degrees CW from north)
  const orientationDeg = 90 - (angleRad * 180 / Math.PI);
  
  return { semiMajor, semiMinor, orientationDeg };
}

/**
 * Estimate pop-off location using the target-tag method.
 * 
 * Selection criteria from Nault et al. 2024 (applied by caller, not here):
 *   - P1: semiMajor < 2250 m
 *   - P2: semiMajor < 1250 m
 *   - 0.375 * t1 < t2 < t1  (where t1 = drift P0->P1, t2 = drift P1->P2)
 */
export function estimatePopoffLocation(
  p1: ArgosFix,
  p2: ArgosFix,
  popoffTime: number,
  confidence: number = 0.95  // BCEE default per Nault
): PopupEstimate {
  const driftT0 = (p1.time - popoffTime) / (1000 * 3600);
  const driftT  = (p2.time - p1.time)      / (1000 * 3600);
  
  // Linear extrapolation: P0 = P1 - (t0/t) * (P2 - P1)
  // Use local planar approximation (valid for distances << Earth radius)
  const scale = driftT0 / driftT;
  
  // Convert to local meters via approximate equirectangular projection at P1
  const latMean = p1.lat * Math.PI / 180;
  const METERS_PER_DEG_LAT = 111320;
  const metersPerDegLon = 111320 * Math.cos(latMean);
  
  const dLat = (p2.lat - p1.lat);
  const dLon = (p2.lon - p1.lon);
  
  const p0Lat = p1.lat - scale * dLat;
  const p0Lon = p1.lon - scale * dLon;
  
  // Silence unused-var linter while keeping conversions documented for future use
  void METERS_PER_DEG_LAT; void metersPerDegLon;
  
  const ellipse = computeEllipse(p1, p2, popoffTime, confidence);
  
  return {
    lat: p0Lat,
    lon: p0Lon,
    ellipseSemiMajor: ellipse.semiMajor,
    ellipseSemiMinor: ellipse.semiMinor,
    ellipseOrientation: ellipse.orientationDeg,
    driftTimeHours: driftT0,
  };
}

/**
 * Proxy-tag method: estimate pop-off location using a DIFFERENT tag's
 * drift segment (P1*, P2*) as a surrogate for the target tag's unknown
 * P0->P1 drift.
 *
 * Ported from Nault et al. 2024 Eq. (2):
 *   P0 = P1 - (t1 / t2*) * (P2* - P1*)
 *
 * Variance propagation (assuming independence across fixes):
 *   Sigma_P0 = Sigma_P1 + (t1/t2*)^2 * (Sigma_P1* + Sigma_P2*)
 *
 * Use this when drift time is long (>5 km drift error) and the target
 * tag's own P1->P2 vector is likely to be a poor surrogate for its
 * earlier P0->P1 drift (per the paper's discussion).
 *
 * @param p1         Target tag's first high-quality Argos fix
 * @param p1Proxy    Proxy tag's drift fix near the time of target's popoff
 * @param p2Proxy    Proxy tag's next drift fix after p1Proxy
 * @param popoffTime Target tag's release timestamp
 * @param confidence Probability contour (default 0.95 for BCEE)
 */
export function estimatePopoffLocationProxy(
  p1: ArgosFix,
  p1Proxy: ArgosFix,
  p2Proxy: ArgosFix,
  popoffTime: number,
  confidence: number = 0.95
): PopupEstimate {
  const t1      = (p1.time      - popoffTime)    / (1000 * 3600);  // unknown drift
  const t2proxy = (p2Proxy.time - p1Proxy.time)  / (1000 * 3600);  // proxy drift segment

  const scale = t1 / t2proxy;

  // Linear extrapolation: P0 = P1 - scale * (P2* - P1*)
  const dLat = p2Proxy.lat - p1Proxy.lat;
  const dLon = p2Proxy.lon - p1Proxy.lon;
  const p0Lat = p1.lat - scale * dLat;
  const p0Lon = p1.lon - scale * dLon;

  // Covariances
  const Sigma_P1      = ellipseToCovariance(p1.semiMajor,      p1.semiMinor,      p1.orientation);
  const Sigma_P1Proxy = ellipseToCovariance(p1Proxy.semiMajor, p1Proxy.semiMinor, p1Proxy.orientation);
  const Sigma_P2Proxy = ellipseToCovariance(p2Proxy.semiMajor, p2Proxy.semiMinor, p2Proxy.orientation);

  // Sigma_P0 = Sigma_P1 + scale^2 * (Sigma_P1* + Sigma_P2*)
  const k2 = scale * scale;
  const sigmaP0: Sigma2 = [
    Sigma_P1[0] + k2 * (Sigma_P1Proxy[0] + Sigma_P2Proxy[0]),
    Sigma_P1[1] + k2 * (Sigma_P1Proxy[1] + Sigma_P2Proxy[1]),
    Sigma_P1[2] + k2 * (Sigma_P1Proxy[2] + Sigma_P2Proxy[2]),
  ];

  const { lam1, lam2, angleRad } = eigen2x2(sigmaP0);
  const CC = Math.sqrt(chi2Inv(confidence));
  const semiMajor = Math.sqrt(Math.max(0, lam1)) * CC;
  const semiMinor = Math.sqrt(Math.max(0, lam2)) * CC;
  const orientationDeg = 90 - (angleRad * 180 / Math.PI);

  return {
    lat: p0Lat,
    lon: p0Lon,
    ellipseSemiMajor: semiMajor,
    ellipseSemiMinor: semiMinor,
    ellipseOrientation: orientationDeg,
    driftTimeHours: t1,
  };
}

/**
 * Check whether proxy-tag fixes meet Nault's automated selection criteria.
 *
 * Automated (strict):
 *   - P1  semi-major < 2000 m
 *   - P1* semi-major < 2000 m  AND  |P1*.time - popoffTime| <= 1 h
 *   - P2* semi-major < 2000 m  AND  |P2*.time - P1.time| <= 1 h
 *                              AND  great-circle(P2*, P1) <= 60 km
 *
 * Manual fallback (relaxed):
 *   - P1, P1* semi-major <= 3300 m
 *   - |P1*.time - popoffTime| <= 2.5 h
 *   - great-circle(P2*, P1) <= 67 km
 */
export function meetsNaultProxyCriteria(
  p1: ArgosFix,
  p1Proxy: ArgosFix,
  p2Proxy: ArgosFix,
  popoffTime: number,
  strict: boolean = true
): { ok: boolean; reason?: string } {
  const hours = (a: number, b: number) => Math.abs(a - b) / (1000 * 3600);

  const p1MaxErr       = strict ? 2000 : 3300;
  const p1ProxyMaxErr  = strict ? 2000 : 3300;
  const p2ProxyMaxErr  = strict ? 2000 : 3300;
  const p1ProxyTimeTol = strict ? 1.0  : 2.5;
  const p2ProxyTimeTol = strict ? 1.0  : 2.5;
  const distCapKm      = strict ? 60   : 67;

  if (p1.semiMajor      >= p1MaxErr)      return { ok: false, reason: `P1 semi-major ${p1.semiMajor}m >= ${p1MaxErr}m` };
  if (p1Proxy.semiMajor >= p1ProxyMaxErr) return { ok: false, reason: `P1* semi-major ${p1Proxy.semiMajor}m >= ${p1ProxyMaxErr}m` };
  if (p2Proxy.semiMajor >= p2ProxyMaxErr) return { ok: false, reason: `P2* semi-major ${p2Proxy.semiMajor}m >= ${p2ProxyMaxErr}m` };

  if (hours(p1Proxy.time, popoffTime) > p1ProxyTimeTol) {
    return { ok: false, reason: `|P1*.time - popoff| = ${hours(p1Proxy.time, popoffTime).toFixed(2)}h > ${p1ProxyTimeTol}h` };
  }
  if (hours(p2Proxy.time, p1.time) > p2ProxyTimeTol) {
    return { ok: false, reason: `|P2*.time - P1.time| = ${hours(p2Proxy.time, p1.time).toFixed(2)}h > ${p2ProxyTimeTol}h` };
  }

  const distKm = haversineKm(p2Proxy.lat, p2Proxy.lon, p1.lat, p1.lon);
  if (distKm > distCapKm) return { ok: false, reason: `P2*-P1 distance = ${distKm.toFixed(1)}km > ${distCapKm}km` };

  return { ok: true };
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371.0088;  // mean Earth radius, km
  const toRad = (d: number) => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Check whether a pair of fixes meets Nault's automated selection criteria
 * for the target-tag method.
 */
export function meetsNaultCriteria(
  p1: ArgosFix,
  p2: ArgosFix,
  popoffTime: number,
  strict: boolean = true
): { ok: boolean; reason?: string } {
  const t1 = (p1.time - popoffTime) / (1000 * 3600);
  const t2 = (p2.time - p1.time)     / (1000 * 3600);
  
  if (t1 <= 0) return { ok: false, reason: 'P1 is before popoff time' };
  if (t2 <= 0) return { ok: false, reason: 'P2 is before P1' };
  
  const p1MaxErr = strict ? 2250 : 3300;
  const p2MaxErr = strict ? 1250 : 3300;
  if (p1.semiMajor >= p1MaxErr) return { ok: false, reason: `P1 semi-major ${p1.semiMajor}m >= ${p1MaxErr}m threshold` };
  if (p2.semiMajor >= p2MaxErr) return { ok: false, reason: `P2 semi-major ${p2.semiMajor}m >= ${p2MaxErr}m threshold` };
  
  const tRatioLow  = strict ? 0.375 : 0.3;
  const tRatioHigh = strict ? 1.0   : 1.6;
  const ratio = t2 / t1;
  if (ratio < tRatioLow || ratio > tRatioHigh) {
    return { ok: false, reason: `t2/t1 = ${ratio.toFixed(2)} outside [${tRatioLow}, ${tRatioHigh}]` };
  }
  
  return { ok: true };
}
