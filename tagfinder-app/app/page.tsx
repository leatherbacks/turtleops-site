'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import { useAnalysis } from '@/hooks/useAnalysis';
import { useEnvironment } from '@/hooks/useEnvironment';
import { analyzeTagState } from '@/analysis/tagState';
import { predictPassesInWindow } from '@/analysis/satPrediction';
import { analyzeSatCoverage } from '@/analysis/satCoverage';
import { analyzeAntennaExposure } from '@/analysis/antennaExposure';
import { compareTemperatures } from '@/analysis/tempComparison';
import { analyzeBathymetry } from '@/analysis/bathymetry';
import type { SatCoverage, AntennaExposure } from '@/lib/types';
import DropZone from '@/components/tagfinder/DropZone';
import FileList from '@/components/tagfinder/FileList';
import AnalysisPanel from '@/components/tagfinder/AnalysisPanel';
import EnvironmentPanel from '@/components/tagfinder/EnvironmentPanel';
import PopoffEstimatePanel from '@/components/tagfinder/PopoffEstimatePanel';
import DiveProfilePanel from '@/components/tagfinder/DiveProfilePanel';
import SatCoveragePanel from '@/components/tagfinder/SatCoveragePanel';
import SearchBriefPanel from '@/components/tagfinder/SearchBriefPanel';
import MirrorCheckPanel from '@/components/tagfinder/MirrorCheckPanel';
import TransmissionHealthPanel from '@/components/tagfinder/TransmissionHealthPanel';
import SkyChart from '@/components/tagfinder/SkyChart';
import UpcomingPassesPanel from '@/components/tagfinder/UpcomingPassesPanel';
import EmailGate from '@/components/tagfinder/EmailGate';
import FeedbackWidget from '@/components/tagfinder/FeedbackWidget';
import { useUpcomingPasses } from '@/hooks/useUpcomingPasses';
import { useTagFinderAuth } from '@/hooks/useTagFinderAuth';
import { RotateCcw, Loader2, Printer } from 'lucide-react';

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
  const { detectedFiles, result, statuses, series, passes, error, analyzing, analyze, reset } = useAnalysis();
  const { session, email, loading: authLoading, signOut } = useTagFinderAuth();

  const [satCoverage, setSatCoverage] = useState<SatCoverage | null>(null);
  const [antennaExposure, setAntennaExposure] = useState<AntennaExposure | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);

  // Fetch environment once we have a position
  const { data: envData, loading: envLoading } = useEnvironment(
    result?.bestLat ?? null,
    result?.bestLon ?? null
  );

  // Predict upcoming satellite passes over the tag's position (next 48h)
  const upcoming = useUpcomingPasses({
    lat: result?.bestLat ?? null,
    lon: result?.bestLon ?? null,
    hoursAhead: 48,
  });

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
      result.allFixes
    );
  }, [result, statuses, series, envData, satCoverage]);

  // Fetch TLEs and compute satellite coverage once we have a result
  useEffect(() => {
    if (!result || passes.length === 0 || !result.summary) return;

    const earliest = result.summary.deployDate || result.allFixes[0]?.date;
    const latest = result.allFixes[result.allFixes.length - 1]?.date;
    if (!earliest || !latest) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/tles');
        if (!res.ok) return;
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
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [result, passes]);

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

  // Merge fused tag state + satellite coverage into result for display
  const displayResult = useMemo(() => {
    if (!result) return null;
    const merged = { ...result };
    if (fusedTagState) merged.tagState = fusedTagState;
    if (satCoverage) merged.satCoverage = satCoverage;
    if (antennaExposure) merged.antennaExposure = antennaExposure;
    if (tempComparison) merged.tempComparison = tempComparison;
    if (bathymetry) merged.bathymetry = bathymetry;
    return merged;
  }, [result, fusedTagState, satCoverage, antennaExposure, tempComparison, bathymetry]);

  // Fetch AI brief once environment + sat coverage are loaded
  const envReady =
    !envLoading.elevation &&
    !envLoading.weather &&
    !envLoading.tides &&
    !envLoading.location;

  const fetchBrief = async () => {
    if (!displayResult) return;
    setBriefLoading(true);
    setBriefError(null);
    try {
      const res = await fetch('/api/summarize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          analysis: {
            ...displayResult,
            upcomingPasses: upcoming.passes,
          },
          environment: envData,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBriefError(data.error || 'Failed to generate brief');
      } else {
        setBrief(data.brief);
      }
    } catch {
      setBriefError('Failed to reach the summary service');
    } finally {
      setBriefLoading(false);
    }
  };

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
    setAntennaExposure(null);
    setBrief(null);
    setBriefError(null);
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
                onClick={() => window.print()}
                className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg border border-border hover:bg-surface-elevated transition-colors"
              >
                <Printer className="w-3.5 h-3.5" />
                Print report
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
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Idle state: show upload (after email verification) */}
        {!result && !analyzing && (
          <div className="max-w-2xl mx-auto">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold mb-3 tracking-tight">
                Find your popped-off archival tag
              </h2>
              <p className="text-muted text-lg">
                Upload Wildlife Computers CSVs from your MiniPAT or PSAT deployment.
                Get instant position estimates, drift predictions, and AI-drafted
                recovery briefs.
              </p>
            </div>

            {!authLoading && !session ? (
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
                Generated by TurtleTag Recovery — turtleops.org
              </div>
              <div className="text-xs text-gray-700 mt-3 pt-2 border-t border-gray-300">
                Users of this tool are asked to cite it in any publication, report, or presentation that uses its results.
                <br />
                <em>Cite as:</em> Johnson, C. (2026). TurtleTag Recovery. TurtleOps. tagfinder.turtleops.org
              </div>
            </div>

            {/* Tag category banner */}
            {displayResult.tagCategory.category === 'tracker' && (
              <div className="flex items-start gap-3 p-4 rounded-lg bg-info/10 border border-info/20">
                <div className="text-info text-xl">🛰️</div>
                <div className="text-sm">
                  <div className="font-semibold text-info mb-0.5">
                    Live tracker mode
                  </div>
                  <div className="text-muted">
                    Detected a non-PSAT tag ({displayResult.tagCategory.instrument || 'type unknown'}). Showing animal
                    tracking analysis. Popoff estimation is skipped since there&apos;s no release event.
                  </div>
                </div>
              </div>
            )}

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
                <AnalysisPanel result={displayResult} />
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
