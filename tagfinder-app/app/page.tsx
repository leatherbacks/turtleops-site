'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useEnvironment } from '@/hooks/useEnvironment';
import { useTidePhase } from '@/hooks/useTidePhase';
import { useWaterMatch } from '@/hooks/useWaterMatch';
import { analyzeTagState } from '@/analysis/tagState';
import { predictPassesInWindow } from '@/analysis/satPrediction';
import { analyzePassGeometry } from '@/analysis/passGeometry';
import { analyzeSatCoverage } from '@/analysis/satCoverage';
import { analyzeReceptionQuality } from '@/analysis/receptionQuality';
import { analyzeAntennaExposure } from '@/analysis/antennaExposure';
import { compareTemperatures } from '@/analysis/tempComparison';
import { analyzeBathymetry } from '@/analysis/bathymetry';
import { detectBurial } from '@/analysis/burialDetection';
import { landfallProbePath, findLandfall, type ProbeSample } from '@/analysis/landfall';
import { assessDriftForcing } from '@/analysis/driftForcing';
import type {
  SatCoverage,
  AntennaExposure,
  LandfallPrediction,
  DriftForcing,
  ForcingSample,
} from '@/lib/types';
import DropZone from '@/components/tagfinder/DropZone';
import FileList from '@/components/tagfinder/FileList';
import AnalysisPanel from '@/components/tagfinder/AnalysisPanel';
import PositionCard from '@/components/tagfinder/PositionCard';
import EnvironmentPanel from '@/components/tagfinder/EnvironmentPanel';
import PopoffEstimatePanel from '@/components/tagfinder/PopoffEstimatePanel';
import DiveProfilePanel from '@/components/tagfinder/DiveProfilePanel';
import SatCoveragePanel from '@/components/tagfinder/SatCoveragePanel';
import SearchBriefPanel from '@/components/tagfinder/SearchBriefPanel';
import MirrorCheckPanel from '@/components/tagfinder/MirrorCheckPanel';
import TransmissionHealthPanel from '@/components/tagfinder/TransmissionHealthPanel';
import TidePhasePanel from '@/components/tagfinder/TidePhasePanel';
import WaterMatchPanel from '@/components/tagfinder/WaterMatchPanel';
import ReceptionQualityPanel from '@/components/tagfinder/ReceptionQualityPanel';
import SkyChart from '@/components/tagfinder/SkyChart';
import UpcomingPassesPanel from '@/components/tagfinder/UpcomingPassesPanel';
import EmailGate from '@/components/tagfinder/EmailGate';
import FeedbackWidget from '@/components/tagfinder/FeedbackWidget';
import { useUpcomingPasses } from '@/hooks/useUpcomingPasses';
import { useTagFinderAuth } from '@/hooks/useTagFinderAuth';
import { RotateCcw, Loader2, Printer, Share2, Check } from 'lucide-react';

// Leaflet must be loaded client-side only
const TagMap = dynamic(() => import('@/components/tagfinder/TagMap'), {
  ssr: false,
  loading: () => (
    <div className="h-[500px] flex items-center justify-center bg-surface rounded-xl border border-border">
      <Loader2 className="w-8 h-8 animate-spin text-muted" />
    </div>
  ),
});

export default function TagFinderPage() {
  const { detectedFiles, result, archive, statuses, series, passes, dailySummaries, histograms, error, analyzing, analyze, reset } = useAnalysis();
  const { session, email, loading: authLoading, authRequired, signOut } = useTagFinderAuth();

  const [satCoverage, setSatCoverage] = useState<SatCoverage | null>(null);
  const [satCoverageUnavailable, setSatCoverageUnavailable] = useState<string | null>(null);
  const [antennaExposure, setAntennaExposure] = useState<AntennaExposure | null>(null);
  const [landfall, setLandfall] = useState<LandfallPrediction | null>(null);
  const [driftForcing, setDriftForcing] = useState<DriftForcing | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareId, setShareId] = useState<string | null>(null);
  const [shareViews, setShareViews] = useState<number | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareError, setShareError] = useState<string | null>(null);
  const [shareCopied, setShareCopied] = useState(false);

  // Fetch environment once we have a position
  const { data: envData, loading: envLoading, settled: envSettled } = useEnvironment(
    result?.bestLat ?? null,
    result?.bestLon ?? null
  );

  // Whether reception tracks the tide — tells a field team when to be standing
  // there with a receiver. Needs the position, so it runs after the analysis.
  const [passGeometry, setPassGeometry] =
    useState<import('@/lib/types').PassGeometryAnalysis | null>(null);

  const tidePhase = useTidePhase(
    passes,
    result?.bestLat ?? null,
    result?.bestLon ?? null
  );

  // Did the tag stop tracking water temperature, and when? Post-release
  // readings only — before release the sensor is on a diving animal, where
  // depth explains the temperature and a comparison against surface water
  // means nothing.
  const postReleaseTemps = useMemo(() => {
    const release = result?.summary?.releaseDate?.getTime() ?? null;
    return series
      .filter(
        (s) =>
          s.temperature !== null &&
          !isNaN(s.date.getTime()) &&
          (release === null || s.date.getTime() >= release)
      )
      .map((s) => ({ date: s.date, temperatureC: s.temperature as number }));
  }, [series, result?.summary?.releaseDate]);

  const waterMatch = useWaterMatch(
    postReleaseTemps,
    result?.bestLat ?? null,
    result?.bestLon ?? null
  );

  // Predict upcoming satellite passes over the tag's position (next 48h)
  const upcoming = useUpcomingPasses({
    lat: result?.bestLat ?? null,
    lon: result?.bestLon ?? null,
    hoursAhead: 48,
  });

  // How much sky the antenna can see, from the received passes alone. Unlike
  // satCoverage this needs no orbital elements, so it still works on a tag whose
  // transmissions ended months ago — which is every recovered tag.
  const receptionQuality = useMemo(() => {
    if (!result || passes.length === 0) return null;
    const located = result.allFixes.filter((f) => !f.isOutlier);
    return analyzeReceptionQuality(
      passes,
      located.length,
      located.map((f) => f.quality)
    );
  }, [result, passes]);

  // Re-run tag state classification with environment + series + sat coverage + fixes
  const fusedTagState = useMemo(() => {
    if (!result) return null;
    if (statuses.length === 0 && series.length === 0 && !result.summary) return null;
    return analyzeTagState(
      statuses,
      result.summary,
      envData,
      series,
      satCoverage,
      result.allFixes,
      receptionQuality
    );
  }, [result, statuses, series, envData, satCoverage, receptionQuality]);

  // Fetch TLEs and compute satellite coverage once we have a result
  useEffect(() => {
    // Deliberately does NOT require result.summary. Nothing below reads it, and
    // Lotek exports have no equivalent file — gating on it would silently
    // disable satellite coverage and antenna exposure for every Lotek dataset.
    if (!result || passes.length === 0) return;

    // Start at the first Argos fix, NOT deployDate. For a PSAT the tag is on a
    // diving animal for the whole deployment and cannot reach a satellite, so
    // counting those passes as "missed" tanks receptionRate and makes
    // interpretCoverage / antennaExposure report obstruction that isn't there.
    // Coverage and exposure are diagnostics about the tag's exposed period.
    const earliest = result.allFixes[0]?.date;
    const latest = result.allFixes[result.allFixes.length - 1]?.date;
    if (!earliest || !latest) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tles');
        if (!res.ok) {
          // These panels used to vanish without a trace when the element feed
          // failed, which hid the tool's best obstruction diagnostic — the sky
          // view that located a tag against a seawall — without telling anyone
          // it existed. Absence now says why.
          if (!cancelled)
            setSatCoverageUnavailable(
              res.status === 429
                ? 'Rate limit reached — satellite coverage and the sky view will return tomorrow.'
                : 'Orbital-element feed unreachable — satellite coverage and the sky view are unavailable until it recovers (usually a few hours). The Antenna Exposure panel below does not need it.'
            );
          return;
        }
        const data = await res.json();
        if (cancelled || !data.entries || data.entries.length === 0) return;

        const predicted = predictPassesInWindow(
          data.entries,
          result.bestLat,
          result.bestLon,
          earliest,
          latest
        );
        const coverage = analyzeSatCoverage(predicted, passes);
        if (!cancelled) {
          setSatCoverage(coverage);
          setAntennaExposure(analyzeAntennaExposure(coverage.passes));
          // Same TLEs, so this costs nothing extra: recover why each fix is as
          // good or bad as it is, and where its mirror solution actually lies.
          setPassGeometry(analyzePassGeometry(passes, data.entries));
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [result, passes]);

  // Walk the predicted drift path and find where it first meets land.
  // One batched elevation request — these routes are rate limited per IP, so
  // probing point-by-point would burn a user's daily budget in one analysis.
  useEffect(() => {
    const pred = result?.driftPrediction;
    if (!result || !pred) {
      setLandfall(null);
      return;
    }
    const path = landfallProbePath(pred, result.bestLat, result.bestLon);
    if (path.length === 0) {
      setLandfall(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const points = path.map((p) => `${p.lat.toFixed(5)},${p.lon.toFixed(5)}`).join('|');
        const res = await fetch(`/api/elevation?points=${encodeURIComponent(points)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.points)) return;

        const samples: ProbeSample[] = path.map((p, i) => ({
          ...p,
          elevationM:
            typeof data.points[i]?.meters === 'number' ? data.points[i].meters : null,
        }));

        const lastFix = result.allFixes[result.allFixes.length - 1];
        const hoursSinceLastFix = lastFix
          ? Math.max(0, (Date.now() - lastFix.date.getTime()) / 3_600_000)
          : 0;

        if (!cancelled) setLandfall(findLandfall(samples, pred, hoursSinceLastFix));
      } catch {
        // leave landfall null — the drift prediction still stands on its own
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [result]);

  // Cross-check the measured drift vector against modelled wind and current.
  // Validation only — never added to the vector, which already contains the
  // forcing that acted while the tag was moving.
  useEffect(() => {
    const pred = result?.driftPrediction;
    if (!result || !pred) {
      setDriftForcing(null);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/drift-forcing?lat=${result.bestLat}&lon=${result.bestLon}`
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !Array.isArray(data.hourly)) return;

        const samples: ForcingSample[] = data.hourly.map(
          (h: {
            time: string;
            windFromDeg: number | null;
            windSpeedMs: number | null;
            currentTowardDeg: number | null;
            currentKmH: number | null;
          }) => ({
            time: new Date(h.time),
            windFromDeg: h.windFromDeg,
            windSpeedMs: h.windSpeedMs,
            currentTowardDeg: h.currentTowardDeg,
            currentKmH: h.currentKmH,
          })
        );

        if (!cancelled) {
          setDriftForcing(assessDriftForcing(pred, samples, new Date(), 24));
        }
      } catch {
        // leave null — the measured vector stands on its own
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [result]);

  // Compute temperature comparison once environment loads (needs SST + air temp)
  const tempComparison = useMemo(() => {
    if (!result) return null;
    if (series.length === 0 && statuses.length === 0) return null;
    // Use most-recent SST from SST.csv if present, else envData.weather would be air temp only
    const latestSST =
      result.sst && result.sst.length > 0
        ? result.sst[result.sst.length - 1].temperature
        : null;
    return compareTemperatures(series, statuses, result.summary, {
      airTempC: envData.weather?.temperature ?? null,
      sstTempC: latestSST,
    });
  }, [result, series, statuses, envData]);

  // Compute bathymetry once GEBCO responds
  const bathymetry = useMemo(() => {
    if (!result) return null;
    if (!envData.bathymetry) return null;
    return analyzeBathymetry(
      {
        seabedDepthM: envData.bathymetry.seabedDepthM,
        source: 'gebco',
      },
      series,
      statuses,
      result.summary
    );
  }, [result, series, statuses, envData.bathymetry]);

  // Burial detection — diel temperature amplitude signature
  const burialDetection = useMemo(() => {
    if (!result) return null;
    if (series.length === 0 && statuses.length === 0) return null;
    const latestSST =
      result.sst && result.sst.length > 0
        ? result.sst[result.sst.length - 1].temperature
        : null;
    return detectBurial(
      series,
      statuses,
      result.summary,
      {
        airTempC: envData.weather?.temperature ?? null,
        sstTempC: latestSST,
      },
      dailySummaries,
      histograms
    );
  }, [result, series, statuses, envData.weather, dailySummaries, histograms]);

  // Merge fused tag state + satellite coverage into result for display
  const displayResult = useMemo(() => {
    if (!result) return null;
    const merged = { ...result };
    if (fusedTagState) merged.tagState = fusedTagState;
    if (satCoverage) merged.satCoverage = satCoverage;
    if (antennaExposure) merged.antennaExposure = antennaExposure;
    if (landfall) merged.landfall = landfall;
    if (driftForcing) merged.driftForcing = driftForcing;
    if (tempComparison) merged.tempComparison = tempComparison;
    if (bathymetry) merged.bathymetry = bathymetry;
    if (burialDetection) merged.burialDetection = burialDetection;
    return merged;
  }, [result, fusedTagState, satCoverage, antennaExposure, landfall, driftForcing, tempComparison, bathymetry, burialDetection]);

  // Fetch AI brief once environment + sat coverage are loaded.
  //
  // Bathymetry belongs in this gate and was missing from it. An elevation model
  // reports 0 m over open sea just as it does on a beach, so at a sea-level
  // coordinate the seabed depth is the field that decides water from shore —
  // the brief's own instructions say exactly that. Without it in the gate the
  // brief fired as soon as elevation returned 0, wrote "the environment fields
  // are empty, so I cannot tell you whether this sits in water or on shore",
  // and was then printed above a panel showing a 2.0 m seabed.
  //
  // Forecast is deliberately left out: it is displayed but never changes a
  // conclusion about where the tag is, so waiting on it would delay the brief
  // for nothing.
  // "All fetches finished" — NOT "none currently loading". The loading flags
  // initialize false, so at mount "not loading" meant "not started", and under
  // React 19's effect ordering the brief fired in that gap with an empty
  // environment, then printed above fully populated panels.
  const envReady = envSettled;

  const fetchBrief = async () => {
    if (!displayResult) return;
    setBriefLoading(true);
    setBriefError(null);
    try {
      // Slim the payload — only send fields the AI brief actually consumes.
      // Without this, tags with multi-year deployments (700+ days of SST/dive
      // readings, thousands of upcoming pass predictions with trackPoints)
      // can blow past Vercel's 4.5 MB request body limit.
      const slim = {
        ptt: displayResult.ptt,
        tagCategory: displayResult.tagCategory,
        summary: displayResult.summary,
        bestLat: displayResult.bestLat,
        bestLon: displayResult.bestLon,
        positionMethod: displayResult.positionMethod,
        primaryRadiusM: displayResult.primaryRadiusM,
        expandedRadiusM: displayResult.expandedRadiusM,
        validFixes: displayResult.validFixes?.map((f) => ({
          date: f.date,
          quality: f.quality,
          latitude: f.latitude,
          longitude: f.longitude,
        })) ?? [],
        allFixes: { length: displayResult.allFixes?.length ?? 0 },
        searchRadiusBasis: displayResult.searchRadiusBasis,
        driftState: displayResult.driftState,
        driftPrediction: displayResult.driftPrediction,
        landfall: displayResult.landfall,
        driftForcing: displayResult.driftForcing,
        tagState: displayResult.tagState,
        tidalIntrusion: displayResult.tidalIntrusion,
        satCoverage: stripTrackPoints(displayResult.satCoverage),
        mirrorCheck: displayResult.mirrorCheck,
        antennaExposure: displayResult.antennaExposure,
        popoff: displayResult.popoff,
        popoffSkipReason: displayResult.popoffSkipReason,
        bathymetry: displayResult.bathymetry,
        lightAnalysis: displayResult.lightAnalysis,
        tempComparison: displayResult.tempComparison,
        burialDetection: displayResult.burialDetection,
        transmissionHealth: displayResult.transmissionHealth,
        tidePhase: tidePhase.analysis,
        waterMatch: waterMatch.analysis
          ? { ...waterMatch.analysis, matched: waterMatch.analysis.matched.slice(-40) }
          : null,
        receptionQuality,
        waterStation: waterMatch.station,
        waterStationDistanceKm: waterMatch.stationDistanceKm,
        repetitionRate: displayResult.repetitionRate,
        passGeometry: passGeometry
          ? { ...passGeometry, fixes: passGeometry.fixes.slice(-20) }
          : null,
        // Class B/Z fixes are excluded from the position because they are
        // unreliable, but they still bound where the tag can be. Without them
        // the model sees a drift vector and nothing that contradicts it, and
        // will happily extrapolate a stopped tag across days of open water.
        recentFixesAnyQuality: displayResult.allFixes.slice(-8).map((f) => ({
          date: f.date,
          latitude: f.latitude,
          longitude: f.longitude,
          quality: f.quality,
          errorRadiusM: f.errorRadius || null,
          effectiveErrorM: f.effectiveError,
          excludedFromPosition: f.isOutlier || !['3', '2', '1', 'A'].includes(f.quality),
        })),
        trackerShed: displayResult.trackerShed,
        releaseInterpretation: displayResult.releaseInterpretation,
        crushDepthEvent: displayResult.crushDepthEvent,
        diveProfile: displayResult.diveProfile,
        dataQuality: displayResult.dataQuality,
        upcomingPasses: (upcoming.passes ?? []).slice(0, 12).map((p) => ({
          satelliteName: p.satelliteName,
          riseTime: p.riseTime,
          maxElevation: p.maxElevation,
          peakAzimuth: p.peakAzimuth,
          direction: p.direction,
        })),
      };

      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysis: slim, environment: envData }),
      });
      const data = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) {
        setBriefError(data.error || `Summary service returned HTTP ${res.status}`);
      } else if (data.brief) {
        setBrief(data.brief);
      } else {
        setBriefError('Summary service returned an empty response');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setBriefError(`Failed to reach the summary service: ${msg}`);
    } finally {
      setBriefLoading(false);
    }
  };

  function stripTrackPoints(sc: SatCoverage | null): SatCoverage | null {
    if (!sc) return sc;
    return {
      ...sc,
      // Per-pass sky trajectories are useful for the UI but huge in JSON.
      // The AI brief doesn't read them — strip before serializing.
      passes: sc.passes.map((p) => ({ ...p, trackPoints: [] })),
    };
  }

  useEffect(() => {
    if (!displayResult || !envReady || brief || briefLoading) return;
    // Also wait for upcoming passes unless that query errored or returned no data
    if (upcoming.loading) return;
    fetchBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [displayResult, envReady, upcoming.loading]);

  const handleFiles = async (newFiles: File[]) => {
    await analyze(newFiles);
  };

  const handleReset = () => {
    reset();
    setSatCoverage(null);
    setSatCoverageUnavailable(null);
    setAntennaExposure(null);
    setBrief(null);
    setBriefError(null);
    setShareUrl(null);
    setShareId(null);
    setShareViews(null);
    setShareError(null);
  };

  // Poll the report's view count every 30 seconds while a share is active
  useEffect(() => {
    if (!shareId) return;
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/reports/${shareId}?stats=1`, {
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && typeof data.viewCount === 'number') {
          setShareViews(data.viewCount);
        }
      } catch {
        // ignore polling errors
      }
    };
    const interval = setInterval(tick, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [shareId]);

  const handleShareReport = async () => {
    if (!displayResult) return;
    setSharing(true);
    setShareError(null);
    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis: displayResult,
          environment: envData,
          brief,
          tidePhase: tidePhase.analysis,
          waterMatch: waterMatch.analysis,
          upcomingPasses: upcoming.passes,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setShareError(data.error || 'Failed to create share link');
        return;
      }
      const fullUrl = `${window.location.origin}${data.url}`;
      setShareUrl(fullUrl);
      setShareId(data.id);
      setShareViews(0);
      // Try the native share sheet first; fall back to clipboard
      const nav = typeof navigator !== 'undefined' ? navigator : null;
      if (nav && typeof nav.share === 'function') {
        try {
          await nav.share({
            title: `TurtleTag${displayResult.ptt ? ` ${displayResult.ptt}` : ''} — Recovery report`,
            url: fullUrl,
          });
        } catch {
          // user cancelled — that's fine, link is still on screen
        }
      } else if (nav && nav.clipboard) {
        await nav.clipboard.writeText(fullUrl);
        setShareCopied(true);
        setTimeout(() => setShareCopied(false), 2000);
      }
    } catch {
      setShareError('Failed to reach the report service');
    } finally {
      setSharing(false);
    }
  };

  const copyShareUrl = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopied(true);
      setTimeout(() => setShareCopied(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen">
      {/* Header */}
      <header className="border-b border-border bg-surface/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              <span className="text-primary">TurtleTag</span> Recovery
            </h1>
            <p className="text-xs text-muted">
              Pop-up archival tag recovery
            </p>
          </div>
          {result && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  // Browsers use document.title as the default Save-As-PDF
                  // filename. Temporarily set a descriptive title so the
                  // saved PDF is named with PTT + date, then restore after
                  // the print dialog closes.
                  const originalTitle = document.title;
                  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
                  const pttPart = result.ptt ? `PTT-${result.ptt}-` : '';
                  document.title = `TurtleTag-Recovery-${pttPart}${today}`;
                  window.print();
                  // Restore after the dialog closes. Use a short delay so the
                  // PDF engine has captured the title.
                  setTimeout(() => {
                    document.title = originalTitle;
                  }, 1000);
                }}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-surface-elevated transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Print report
              </button>
              <button
                onClick={handleShareReport}
                disabled={sharing}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50"
              >
                {sharing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : shareCopied ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  <Share2 className="w-3.5 h-3.5" />
                )}
                {shareUrl ? 'Re-share' : 'Share with team'}
              </button>
              <button
                onClick={handleReset}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-surface-elevated transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                New analysis
              </button>
            </div>
          )}
        </div>
        {(shareUrl || shareError) && (
          <div className="max-w-7xl mx-auto px-6 pb-3">
            {shareUrl && (
              <div className="flex items-center gap-2 text-xs bg-success/10 border border-success/30 rounded-lg px-3 py-2">
                <Check className="w-3.5 h-3.5 text-success flex-shrink-0" />
                <span className="text-muted">Shareable link:</span>
                <a
                  href={shareUrl}
                  target="_blank"
                  rel="noopener"
                  className="font-mono text-primary hover:underline truncate"
                >
                  {shareUrl}
                </a>
                {shareViews !== null && (
                  <span
                    className="text-muted ml-2 flex-shrink-0"
                    title="Updated every 30 seconds"
                  >
                    · {shareViews} view{shareViews === 1 ? '' : 's'}
                  </span>
                )}
                <button
                  onClick={copyShareUrl}
                  className="ml-auto flex items-center gap-1 px-2 py-1 rounded hover:bg-surface-elevated"
                >
                  {shareCopied ? (
                    <Check className="w-3 h-3 text-success" />
                  ) : (
                    <>
                      <Share2 className="w-3 h-3" />
                      Copy
                    </>
                  )}
                </button>
              </div>
            )}
            {shareError && (
              <div className="text-xs bg-error/10 border border-error/30 rounded-lg px-3 py-2 text-error">
                {shareError}
              </div>
            )}
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Idle state: show upload (after email verification) */}
        {!result && !analyzing && !archive && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold mb-3 tracking-tight">
                Find your popped-off archival tag
              </h2>
              <p className="text-muted text-lg">
                Upload whatever the deployment gave you &mdash; Wildlife Computers or
                Lotek PSAT+, decoded CSVs, raw Argos dumps, even the logs off a
                recovered tag. Get a position with an honest search radius, whether
                the tag is drifting, ashore or buried &mdash; and when that changed
                &mdash; plus satellite pass windows and an AI-drafted recovery brief.
              </p>
              <p className="text-sm text-muted mt-3">
                Field-tested: recent recoveries found their tags within 200&nbsp;m of
                the estimate.
              </p>
            </div>

            {!authLoading && !session && authRequired ? (
              <EmailGate />
            ) : (
              <>
                <DropZone onFiles={handleFiles} disabled={analyzing} />

                {error && (
                  <div className="mt-4 p-4 rounded-lg bg-error/10 border border-error/20 text-error text-sm">
                    {error}
                  </div>
                )}

                {email && (
                  <div className="mt-4 flex items-center justify-center gap-2 text-xs text-muted">
                    <span>Signed in as {email}</span>
                    <button
                      onClick={signOut}
                      className="underline hover:text-foreground"
                    >
                      Sign out
                    </button>
                  </div>
                )}
              </>
            )}

            <div className="mt-8 text-center text-xs text-muted space-y-1">
              <p>Your data stays in your browser. Only computed coordinates are sent to APIs for environmental context.</p>
              <p>Currently supports Wildlife Computers tags. More formats coming soon.</p>
            </div>
          </div>
        )}

        {archive && !result && (
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="bg-surface rounded-xl border border-border p-5">
              <h2 className="text-xl font-bold tracking-tight mb-1">
                Recovered-tag archive
              </h2>
              <p className="text-sm text-muted">
                {archive.profile.totalReadings.toLocaleString()} archived readings,{' '}
                {archive.from.toLocaleDateString()} &ndash; {archive.to.toLocaleDateString()}
                {archive.basicSamples > 0 &&
                  ` · basic log ${archive.basicSamples.toLocaleString()} samples`}
                {archive.anchorMethod === 'day' &&
                  ' · dated to the day (±12 h) — add the Lotek Dive Log CSV for exact times'}
              </p>
              <p className="text-xs text-muted mt-2">
                No Argos positions in this upload, so there is no search to plan —
                position, drift and recovery analyses need a CLS export or raw Argos
                file alongside. The archive itself is below.
              </p>
            </div>

            <DiveProfilePanel profile={archive.profile} />

            {archive.dayRecords.length > 0 && (
              <div className="bg-surface rounded-xl border border-border p-5">
                <h3 className="font-semibold mb-2">Day log — onboard geolocation</h3>
                <p className="text-xs text-muted mb-3">
                  Latitude from the tag&apos;s own light geolocation (longitude is not
                  decodable from the offload). Sunrise/sunset UTC as the tag measured them.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm font-mono">
                    <thead>
                      <tr className="text-left text-xs text-muted uppercase">
                        <th className="pr-4 pb-1">Date</th>
                        <th className="pr-4 pb-1">Lat °N</th>
                        <th className="pr-4 pb-1">SST °C</th>
                        <th className="pr-4 pb-1">Sunrise</th>
                        <th className="pb-1">Sunset</th>
                      </tr>
                    </thead>
                    <tbody>
                      {archive.dayRecords.map((d) => {
                        const hm = (m: number | null) =>
                          m === null
                            ? '—'
                            : `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
                        return (
                          <tr key={d.date.toISOString()} className="border-t border-border/50">
                            <td className="pr-4 py-1">{d.date.toISOString().slice(0, 10)}</td>
                            <td className="pr-4 py-1">{d.latitudeNorth?.toFixed(2) ?? 'no fix'}</td>
                            <td className="pr-4 py-1">{d.sstC?.toFixed(1) ?? '—'}</td>
                            <td className="pr-4 py-1">{hm(d.sunriseMinutesUtc)}</td>
                            <td className="py-1">{hm(d.sunsetMinutesUtc)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="text-center">
              <button
                onClick={handleReset}
                className="text-sm text-muted hover:text-primary underline underline-offset-2"
              >
                Analyze different files
              </button>
            </div>
          </div>
        )}

        {/* Analyzing state */}
        {analyzing && (
          <div className="flex flex-col items-center justify-center py-20">
            <Loader2 className="w-10 h-10 animate-spin text-primary mb-4" />
            <p className="text-lg font-medium">Analyzing tag data...</p>
            {detectedFiles.length > 0 && (
              <div className="mt-4">
                <FileList files={detectedFiles} />
              </div>
            )}
          </div>
        )}

        {/* Results state */}
        {displayResult && !analyzing && (
          <div className="space-y-6">
            {/* Print-only report header */}
            <div className="hidden print:block print-only border-b-2 border-black pb-3 mb-4">
              <h1 className="text-2xl font-bold">TurtleTag Recovery Report</h1>
              <div className="text-sm text-gray-700 mt-1">
                {displayResult.ptt && (
                  <span>
                    <strong>PTT:</strong> {displayResult.ptt} &nbsp;·&nbsp;
                  </span>
                )}
                <strong>Generated:</strong>{' '}
                {new Date().toLocaleString(undefined, {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}{' '}
                &nbsp;·&nbsp;
                <strong>Position:</strong>{' '}
                {Math.abs(displayResult.bestLat).toFixed(4)}°
                {displayResult.bestLat >= 0 ? 'N' : 'S'},{' '}
                {Math.abs(displayResult.bestLon).toFixed(4)}°
                {displayResult.bestLon >= 0 ? 'E' : 'W'}
              </div>
              <div className="text-xs text-gray-600 mt-2">
                Generated by TurtleTag Recovery —{' '}
                <strong>tagfinder.turtleops.org</strong>
              </div>
              <div className="text-xs text-gray-700 mt-3 pt-2 border-t border-gray-300">
                Users of this tool are asked to cite it in any publication, report, or presentation that uses its results.
                <br />
                <em>Cite as:</em> Johnson, C. (2026). TurtleTag Recovery. TurtleOps. tagfinder.turtleops.org
              </div>
            </div>

            {/* Tag category banner */}
            {displayResult.tagCategory.category === 'tracker' &&
              displayResult.trackerShed?.verdict !== 'separated' && (
                <div className="flex items-start gap-3 p-4 rounded-lg bg-info/10 border border-info/20">
                  <div className="text-info text-xl">🛰️</div>
                  <div className="text-sm">
                    <div className="font-semibold text-info mb-0.5">Live tracker mode</div>
                    <div className="text-muted">
                      Detected a non-PSAT tag ({displayResult.tagCategory.instrument || 'type unknown'}). Showing animal
                      tracking analysis. Popoff estimation is skipped since there&apos;s no release event.
                    </div>
                  </div>
                </div>
              )}

            {/* Tracker has been removed / shed — switched to recovery mode */}
            {displayResult.trackerShed?.verdict === 'separated' && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-warning/10 border border-warning/30">
                <div className="text-warning text-xl">🎯</div>
                <div className="text-sm">
                  <div className="font-semibold text-warning mb-0.5">
                    Tracker tag stopped moving — recovery mode
                  </div>
                  <div className="text-muted">
                    {displayResult.trackerShed.reasoning} Map and analyzers
                    scoped to the stationary period only; historic animal track
                    is hidden to keep the recovery target visible.
                  </div>
                </div>
              </div>
            )}

            {/* Hero position — the single answer recovery teams come here for */}
            <PositionCard result={displayResult} hero />

            {/* File list */}
            <FileList files={detectedFiles} />

            {/* Map + Analysis side by side on desktop */}
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
              {/* Map (takes 3/5 on desktop) */}
              <div className="lg:col-span-3 space-y-4">
                <TagMap result={displayResult} />

                {/* Map legend */}
                <div className="flex flex-wrap gap-4 mt-3 justify-center text-xs text-muted">
                  <LegendItem color="#d32f2f" label="Best estimate" />
                  {displayResult.popoff && <LegendItem color="#fbc02d" label="Popoff (P₀)" />}
                  <LegendItem color="#1565c0" label="Q3 fix" />
                  <LegendItem color="#0097a7" label="Q2 fix" />
                  <LegendItem color="#7b1fa2" label="Q1/A fix" />
                  {displayResult.outlierFixes.length > 0 && (
                    <LegendItem color="#999999" label="Outlier" />
                  )}
                </div>

                {/* Environment panel below the map */}
                <EnvironmentPanel data={envData} loading={envLoading} />

                {/* Dive profile (if we have Series data) */}
                {displayResult.diveProfile && (
                  <DiveProfilePanel
                    profile={displayResult.diveProfile}
                    releaseDate={displayResult.summary?.releaseDate}
                  />
                )}

                {/* Satellite coverage (if we have Argos passes) */}
                {displayResult.satCoverage && (
                  <SatCoveragePanel coverage={displayResult.satCoverage} />
                )}
                {!displayResult.satCoverage && satCoverageUnavailable && (
                  <div className="bg-surface rounded-xl border border-border p-5 text-sm text-muted">
                    <h3 className="font-semibold text-foreground mb-1">
                      Satellite Coverage &amp; Sky View
                    </h3>
                    {satCoverageUnavailable}
                  </div>
                )}

                {/* Sky chart — per-pass azimuth/elevation visualization */}
                {displayResult.satCoverage &&
                  displayResult.satCoverage.passes.length > 0 && (
                    <SkyChart
                      passes={displayResult.satCoverage.passes}
                      exposure={displayResult.antennaExposure}
                    />
                  )}

                {/* Upcoming passes — when will the next transmission likely happen */}
                {result && (
                  <UpcomingPassesPanel
                    passes={upcoming.passes}
                    loading={upcoming.loading}
                    error={upcoming.error}
                    exposure={displayResult.antennaExposure}
                  />
                )}
              </div>

              {/* Analysis panels (2/5 on desktop) */}
              <div className="lg:col-span-2 space-y-4">
                <SearchBriefPanel
                  brief={brief}
                  loading={briefLoading}
                  error={briefError}
                  onRetry={fetchBrief}
                />
                {displayResult.mirrorCheck && (
                  <MirrorCheckPanel mirror={displayResult.mirrorCheck} />
                )}
                {displayResult.transmissionHealth && (
                  <TransmissionHealthPanel health={displayResult.transmissionHealth} />
                )}

                {/* How much sky the antenna can see, from received passes alone */}
                {receptionQuality && receptionQuality.verdict !== 'insufficient' && (
                  <ReceptionQualityPanel quality={receptionQuality} />
                )}

                {/* Did the tag stop tracking the water, and when */}
                {waterMatch.analysis?.available && (
                  <WaterMatchPanel
                    analysis={waterMatch.analysis}
                    station={waterMatch.station}
                    stationDistanceKm={waterMatch.stationDistanceKm}
                  />
                )}

                {/* Does reception track the tide — when to be there with a receiver */}
                {tidePhase.analysis && (
                  <TidePhasePanel
                    analysis={tidePhase.analysis}
                    station={tidePhase.station}
                    stationDistanceKm={tidePhase.stationDistanceKm}
                  />
                )}
                <AnalysisPanel result={displayResult} skipPositionCard />
                {displayResult.tagCategory.category === 'psat' && (
                  displayResult.popoff ? (
                    <PopoffEstimatePanel popoff={displayResult.popoff} />
                  ) : displayResult.popoffSkipReason ? (
                    <div className="bg-surface rounded-xl border border-border p-4 text-sm">
                      <div className="text-muted text-xs font-semibold uppercase tracking-wide mb-1">
                        Popoff estimate unavailable
                      </div>
                      <div className="text-muted text-xs">{displayResult.popoffSkipReason}</div>
                    </div>
                  ) : null
                )}

                {/* Feedback widget — bottom of right column, only after brief has loaded */}
                {brief && !briefLoading && (
                  <FeedbackWidget result={displayResult} />
                )}
              </div>
            </div>

            {/* Print-only CTA footer — encourages the report's recipients to
             *  try the tool themselves. Goes on the last page of the PDF. */}
            <div className="hidden print:block mt-8 pt-6 border-t-2 border-black text-center">
              <div className="text-base font-semibold text-gray-900">
                Found this useful? Analyze another tag — free, client-side, no signup.
              </div>
              <div className="text-lg font-mono font-bold text-gray-900 mt-1">
                tagfinder.turtleops.org
              </div>
              <div className="text-xs text-gray-600 mt-2">
                A TurtleOps tool by Chris Johnson · Florida Leatherbacks Inc.
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border mt-16 py-6 text-center text-xs text-muted">
        <p>
          TurtleTag Recovery &mdash; a{' '}
          <a href="https://turtleops.org" className="text-primary hover:underline">
            TurtleOps
          </a>{' '}
          tool by Chris Johnson &mdash; Florida Leatherbacks Inc.
        </p>
        <p className="mt-1">
          Popoff estimation: Nault et al. 2024, Animal Biotelemetry 12:7.
          Argos errors: Boyd &amp; Brightsmith 2013.
        </p>
        <p className="mt-1">
          Recovery methods:{' '}
          <a
            href="https://animalbiotelemetry.biomedcentral.com/articles/10.1186/s40317-017-0137-8"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            Fisher et al. 2017, Animal Biotelemetry 5:21
          </a>
          {' '}(CLS RXG-134 goniometer + RG-58 antenna, ~3.6 km detection range).{' '}
          <a
            href="https://academic.oup.com/icesjms/article/77/7-8/2890/5923787"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            Gatti et al. 2020, ICES J. Mar. Sci. 77:2890
          </a>
          {' '}(large-scale PSAT recovery program, 75% rate).
        </p>
        <p className="mt-1">
          Sand burial signature:{' '}
          <a
            href="https://pmc.ncbi.nlm.nih.gov/articles/PMC12240679/"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            Booth et al.
          </a>
          {' '}and{' '}
          <a
            href="https://www.researchgate.net/publication/232691738"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            DeGregorio &amp; Williard
          </a>
          {' '}on sea turtle nest thermal loggers;{' '}
          <a
            href="https://www.nature.com/articles/s41598-025-93054-w"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            sand thermal properties (Sci. Rep. 2025)
          </a>
          .
        </p>
        <p className="mt-1">
          Predation &amp; post-release interpretation:{' '}
          <a
            href="https://doi.org/10.3354/esr01165"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            Hall &amp; James 2021, Endang. Species Res. 46:279&ndash;291
          </a>
          . Satellite passes: SGP4 via{' '}
          <a
            href="https://github.com/shashwatak/satellite-js"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            satellite.js
          </a>
          {' '}(Vallado et al. 2006, AIAA 2006-6753). Solar position: Astronomical
          Almanac low-precision algorithm. Tag configuration &amp; release logic:
          Lotek PSAT+ User Manual rev. 02 (2026). Lotek binary log and Argos
          payload layouts reverse-engineered for this tool.
        </p>
        <p className="mt-1">
          Data: weather &amp; ocean forcing by{' '}
          <a
            href="https://open-meteo.com"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            Open-Meteo.com
          </a>
          {' '}(CC BY 4.0). Geocoding &copy;{' '}
          <a
            href="https://www.openstreetmap.org/copyright"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            OpenStreetMap contributors
          </a>
          {' '}via Nominatim, and U.S. Census Bureau. Bathymetry:{' '}
          <a
            href="https://doi.org/10.5285/a29c5465-b138-234d-e053-6c86abc040b9"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            GEBCO 2020 Grid
          </a>
          . Tides &amp; water temperature: NOAA CO-OPS. Orbital elements:{' '}
          <a
            href="https://celestrak.org"
            target="_blank"
            rel="noopener"
            className="hover:text-primary underline underline-offset-2"
          >
            CelesTrak
          </a>
          {' '}(T. S. Kelso). Elevation: Open-Elevation. Basemap: Esri, Maxar,
          Earthstar Geographics, and the GIS User Community.
        </p>
        <p className="mt-2">
          If this tool informed your recovery or research, please cite: TurtleTag Recovery (Johnson, 2026) — tagfinder.turtleops.org
        </p>
      </footer>
    </div>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="w-2.5 h-2.5 rounded-full border-2 border-white/60"
        style={{ backgroundColor: color }}
      />
      <span>{label}</span>
    </div>
  );
}
