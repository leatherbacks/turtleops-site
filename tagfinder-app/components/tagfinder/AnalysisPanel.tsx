'use client';

import type {
  AnalysisResult,
  TagStateInfo,
  DataQuality,
  TagPhase,
  TidalIntrusion,
  ReleaseInterpretation,
  LightAnalysis,
  TempComparison,
  Bathymetry,
  BurialDetection,
} from '@/lib/types';
import {
  Wind,
  Anchor,
  Clock,
  Waves,
  Thermometer,
  Radio,
  Droplet,
  Unlink,
  AlertTriangle,
  Sun,
  Mountain,
} from 'lucide-react';
import PositionCard from './PositionCard';

interface AnalysisPanelProps {
  result: AnalysisResult;
  /** When true, omit PositionCard (it's already rendered as a hero at the top
   *  of the results page). Defaults to false for backward compatibility. */
  skipPositionCard?: boolean;
}

export default function AnalysisPanel({ result, skipPositionCard = false }: AnalysisPanelProps) {
  const isTracker = result.tagCategory.category === 'tracker';

  return (
    <div className="space-y-4">
      {!skipPositionCard && <PositionCard result={result} />}
      {result.releaseInterpretation && !isTracker && (
        <ReleaseTypeCard
          release={result.releaseInterpretation}
          crushDepth={result.crushDepthEvent}
        />
      )}
      {result.tagState && <TagStateCard tagState={result.tagState} isTracker={isTracker} />}
      {result.lightAnalysis && <LightAnalysisCard light={result.lightAnalysis} />}
      {result.tempComparison && <TempComparisonCard temp={result.tempComparison} />}
      {result.burialDetection && <BurialDetectionCard burial={result.burialDetection} />}
      {result.bathymetry && <BathymetryCard bathy={result.bathymetry} />}
      {result.tidalIntrusion && <TidalIntrusionCard tidal={result.tidalIntrusion} />}
      <DriftCard result={result} isTracker={isTracker} />
      {result.driftPrediction && <PredictionCard result={result} isTracker={isTracker} />}
      {result.dataQuality && (
        <DataQualityCard
          dataQuality={result.dataQuality}
          corruptCount={result.corruptCount}
        />
      )}
      <FixTable result={result} />
    </div>
  );
}

function ReleaseTypeCard({
  release,
  crushDepth,
}: {
  release: ReleaseInterpretation;
  crushDepth: AnalysisResult['crushDepthEvent'];
}) {
  const severityColors = {
    info: 'text-info bg-info/10 border-info/20',
    warning: 'text-warning bg-warning/10 border-warning/20',
    alert: 'text-error bg-error/10 border-error/20',
  };
  const Icon = release.severity === 'alert' ? AlertTriangle : Unlink;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-5 h-5 text-primary" />
        <h3 className="font-semibold">Release Type</h3>
      </div>

      <div className="mb-3">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${severityColors[release.severity]}`}
        >
          {release.label.toUpperCase()}
        </span>
      </div>

      <p className="text-sm text-muted">{release.implication}</p>

      {crushDepth?.detected && (
        <div className="mt-3 p-3 rounded-lg bg-error/10 border border-error/20">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle className="w-3.5 h-3.5 text-error" />
            <span className="text-xs font-semibold uppercase tracking-wide text-error">
              Crush-depth event detected
            </span>
          </div>
          <p className="text-xs text-muted">{crushDepth.reasoning}</p>
        </div>
      )}
    </div>
  );
}

function TidalIntrusionCard({ tidal }: { tidal: TidalIntrusion }) {
  // Only show card if there's something meaningful to report
  if (tidal.wetPct === 0 && !tidal.detected) return null;

  const badgeColor = tidal.detected
    ? 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20'
    : 'text-muted bg-surface-elevated border-border';

  const label = tidal.detected
    ? tidal.confidence >= 0.7
      ? 'TIDALLY FLOODED'
      : 'LIKELY TIDAL'
    : 'ABOVE TIDE LINE';

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Droplet className="w-5 h-5 text-cyan-400" />
        <h3 className="font-semibold">Tidal Exposure</h3>
      </div>

      <div className="mb-2">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${badgeColor}`}
        >
          {label}
        </span>
      </div>

      <p className="text-sm text-muted mb-3">{tidal.reasoning}</p>

      <div className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Wet time</div>
          <div className="font-mono font-medium">{tidal.wetPct.toFixed(0)}%</div>
        </div>
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Max depth</div>
          <div className="font-mono font-medium">{tidal.maxPostReleaseDepth.toFixed(1)}m</div>
        </div>
        {tidal.cyclePeriodHours && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wide">Cycle</div>
            <div className="font-mono font-medium">
              {tidal.cyclePeriodHours.toFixed(1)}h
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TagStateCard({ tagState, isTracker }: { tagState: TagStateInfo; isTracker: boolean }) {
  // Labels differ for tracker (live animal) vs PSAT modes
  const psatLabels: Record<TagPhase, { label: string; color: string }> = {
    pre_popoff: {
      label: 'Pre-popoff',
      color: 'text-info bg-info/10 border-info/20',
    },
    likely_recovered: {
      label: 'Likely recovered by person',
      color: 'text-primary bg-primary/10 border-primary/20',
    },
    buried: {
      label: 'Buried',
      color: 'text-error bg-error/10 border-error/20',
    },
    stranded_on_land: {
      label: 'Stranded on land',
      color: 'text-warning bg-warning/10 border-warning/20',
    },
    surface: {
      label: 'At surface',
      color: 'text-warning bg-warning/10 border-warning/20',
    },
    partially_submerged: {
      label: 'Partially submerged',
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    },
    submerged: {
      label: 'Submerged',
      color: 'text-info bg-info/10 border-info/20',
    },
    unknown: {
      label: 'Unknown',
      color: 'text-muted bg-surface-elevated border-border',
    },
  };

  const trackerLabels: Record<TagPhase, { label: string; color: string }> = {
    pre_popoff: {
      label: 'Active',
      color: 'text-info bg-info/10 border-info/20',
    },
    likely_recovered: {
      label: 'Likely recovered by person',
      color: 'text-primary bg-primary/10 border-primary/20',
    },
    buried: {
      label: 'Buried',
      color: 'text-error bg-error/10 border-error/20',
    },
    stranded_on_land: {
      label: 'On land',
      color: 'text-warning bg-warning/10 border-warning/20',
    },
    surface: {
      label: 'Surfacing',
      color: 'text-warning bg-warning/10 border-warning/20',
    },
    partially_submerged: {
      label: 'Near surface',
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    },
    submerged: {
      label: 'Diving',
      color: 'text-info bg-info/10 border-info/20',
    },
    unknown: {
      label: 'Unknown',
      color: 'text-muted bg-surface-elevated border-border',
    },
  };

  const phaseLabels = isTracker ? trackerLabels : psatLabels;
  const info = phaseLabels[tagState.phase];
  const sectionTitle = isTracker ? 'Animal State' : 'Tag State';

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Waves className="w-5 h-5 text-cyan-400" />
        <h3 className="font-semibold">{sectionTitle}</h3>
      </div>

      <div className="mb-3">
        <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${info.color}`}>
          {info.label.toUpperCase()}
        </span>
        <p className="text-sm text-muted mt-2">{tagState.reasoning}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        {tagState.lastDepth !== null && (
          <div>
            <span className="text-muted">Depth:</span>{' '}
            <span className="font-mono font-medium">{tagState.lastDepth.toFixed(1)} m</span>
            {tagState.depthVariability !== null && tagState.depthVariability > 0 && (
              <span className="text-xs text-muted ml-1">
                (±{tagState.depthVariability.toFixed(1)})
              </span>
            )}
          </div>
        )}
        {tagState.lastTemperature !== null && (
          <div className="flex items-center gap-1">
            <Thermometer className="w-3.5 h-3.5 text-muted" />
            <span className="font-mono font-medium">{tagState.lastTemperature.toFixed(1)}°C</span>
            {tagState.tempRange && tagState.tempRange.max > tagState.tempRange.min && (
              <span className="text-xs text-muted ml-1">
                ({tagState.tempRange.min.toFixed(1)}–{tagState.tempRange.max.toFixed(1)})
              </span>
            )}
          </div>
        )}
        <div className="col-span-2 text-xs text-muted">
          Based on {tagState.reportCount} status report{tagState.reportCount !== 1 ? 's' : ''}
        </div>
      </div>
    </div>
  );
}

function DataQualityCard({
  dataQuality,
  corruptCount,
}: {
  dataQuality: DataQuality;
  corruptCount: number;
}) {
  const dq = dataQuality;
  const healthColor =
    dq.corruptPct < 2 ? 'text-success' : dq.corruptPct < 10 ? 'text-warning' : 'text-error';

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Radio className="w-5 h-5 text-muted" />
        <h3 className="font-semibold">Data Quality</h3>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted">Satellite passes:</span>{' '}
          <span className="font-medium">{dq.totalPasses}</span>
        </div>
        <div>
          <span className="text-muted">Total messages:</span>{' '}
          <span className="font-medium">{dq.totalMessages}</span>
        </div>
        <div>
          <span className="text-muted">Avg per pass:</span>{' '}
          <span className="font-medium">{dq.avgMsgPerPass.toFixed(1)}</span>
        </div>
        <div>
          <span className="text-muted">Corrupted:</span>{' '}
          <span className={`font-medium ${healthColor}`}>
            {dq.corruptPct.toFixed(1)}%
          </span>
        </div>
        {corruptCount > 0 && (
          <div className="col-span-2">
            <span className="text-muted">Rejected messages:</span>{' '}
            <span className="font-medium">{corruptCount}</span>
          </div>
        )}
        {dq.nominalFrequencyMHz !== null && (
          <div className="col-span-2 pt-2 mt-1 border-t border-border">
            <div className="flex items-baseline justify-between">
              <div>
                <span className="text-muted text-xs uppercase tracking-wide">
                  Transmit frequency
                </span>
                <div className="font-mono font-medium text-lg">
                  {dq.nominalFrequencyMHz.toFixed(3)} MHz
                </div>
              </div>
              <span className="text-xs text-muted">For RDF / recovery gear</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function DriftCard({ result, isTracker }: { result: AnalysisResult; isTracker: boolean }) {
  const { driftState } = result;

  const labelColors: Record<string, string> = {
    stuck: 'text-warning bg-warning/10 border-warning/20',
    drifting: 'text-info bg-info/10 border-info/20',
    insufficient: 'text-muted bg-surface-elevated border-border',
  };

  // Relabel for tracker mode: stuck → stationary, drifting → moving
  const relabel = (label: string): string => {
    if (!isTracker) return label;
    if (label === 'stuck') return 'stationary';
    if (label === 'drifting') return 'moving';
    return label;
  };

  const sectionTitle = isTracker ? 'Movement' : 'Drift State';

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Anchor className="w-5 h-5 text-info" />
        <h3 className="font-semibold">{sectionTitle}</h3>
      </div>

      <p className="text-lg font-medium mb-3">{driftState.pattern}</p>

      <div className="grid grid-cols-3 gap-2">
        {(['recent', 'medium', 'allTime'] as const).map((window) => (
          <div key={window} className="text-center">
            <div className="text-xs text-muted mb-1">
              {window === 'recent' ? 'Last 24h' : window === 'medium' ? 'Last 72h' : 'All time'}
            </div>
            <span
              className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold border ${labelColors[driftState[window]]}`}
            >
              {relabel(driftState[window]).toUpperCase()}
            </span>
            <div className="text-xs text-muted mt-1">
              {window === 'recent'
                ? `${driftState.recentSpreadKm.toFixed(1)} km`
                : window === 'medium'
                ? `${driftState.mediumSpreadKm.toFixed(1)} km`
                : `${driftState.allTimeSpreadKm.toFixed(1)} km`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PredictionCard({ result, isTracker }: { result: AnalysisResult; isTracker: boolean }) {
  const pred = result.driftPrediction;
  if (!pred) return null;

  const headingLabel = degToCompass(pred.headingDeg);
  const sectionTitle = isTracker ? 'Movement Prediction' : 'Drift Prediction';
  const verb = isTracker ? 'Moving' : 'Drifting';

  return (
    <div className="bg-surface rounded-xl border border-info/20 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Wind className="w-5 h-5 text-info" />
        <h3 className="font-semibold">{sectionTitle}</h3>
      </div>

      <p className="text-sm text-muted mb-3">
        {verb} {headingLabel} at ~{pred.speedKmH.toFixed(1)} km/h
      </p>

      <div className="space-y-2">
        {pred.predictions.map((p) => (
          <div key={p.hoursAhead} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Clock className="w-3.5 h-3.5 text-muted" />
              <span>+{p.hoursAhead}h</span>
            </div>
            <span className="font-mono text-xs">
              {Math.abs(p.lat).toFixed(4)}°{p.lat >= 0 ? 'N' : 'S'},{' '}
              {Math.abs(p.lon).toFixed(4)}°{p.lon >= 0 ? 'E' : 'W'}
            </span>
            <span className="text-muted text-xs">
              ±{p.uncertaintyRadiusKm.toFixed(1)} km
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function FixTable({ result }: { result: AnalysisResult }) {
  const qualityColors: Record<string, string> = {
    '3': 'bg-marker-q3/20 text-blue-400',
    '2': 'bg-marker-q2/20 text-cyan-400',
    '1': 'bg-marker-q1a/20 text-purple-400',
    'A': 'bg-marker-q1a/20 text-purple-400',
    'B': 'bg-gray-700 text-gray-400',
    '0': 'bg-gray-700 text-gray-400',
  };

  return (
    <div className="bg-surface rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-3 border-b border-border">
        <h3 className="font-semibold">Argos Fixes ({result.allFixes.length})</h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted uppercase tracking-wide border-b border-border">
              <th className="px-4 py-2">Date (UTC)</th>
              <th className="px-4 py-2">Quality</th>
              <th className="px-4 py-2">Latitude</th>
              <th className="px-4 py-2">Longitude</th>
              <th className="px-4 py-2">Error (m)</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {result.allFixes.map((fix, i) => (
              <tr
                key={i}
                className={`border-b border-border/50 ${fix.isOutlier ? 'opacity-40 line-through' : ''}`}
              >
                <td className="px-4 py-2 font-mono text-xs">
                  {fix.date.toISOString().replace('T', ' ').slice(0, 19)}
                </td>
                <td className="px-4 py-2">
                  <span className={`px-1.5 py-0.5 rounded text-xs font-bold ${qualityColors[fix.quality] || ''}`}>
                    Q{fix.quality}
                  </span>
                </td>
                <td className="px-4 py-2 font-mono">{fix.latitude.toFixed(4)}</td>
                <td className="px-4 py-2 font-mono">{fix.longitude.toFixed(4)}</td>
                <td className="px-4 py-2 font-mono">{fix.effectiveError.toFixed(0)}</td>
                <td className="px-4 py-2">
                  {fix.isOutlier && (
                    <span className="text-xs text-error">Outlier</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LightAnalysisCard({ light }: { light: LightAnalysis }) {
  const patternLabels: Record<string, { label: string; color: string }> = {
    normal_diurnal: {
      label: 'Normal day/night cycle',
      color: 'text-info bg-info/10 border-info/20',
    },
    buried: {
      label: 'Buried',
      color: 'text-error bg-error/10 border-error/20',
    },
    shaded: {
      label: 'Shaded',
      color: 'text-warning bg-warning/10 border-warning/20',
    },
    indoor: {
      label: 'Indoor / artificial light',
      color: 'text-primary bg-primary/10 border-primary/20',
    },
    fully_dark: {
      label: 'Fully dark',
      color: 'text-error bg-error/10 border-error/20',
    },
    insufficient: {
      label: 'Insufficient data',
      color: 'text-muted bg-surface-elevated border-border',
    },
    unknown: {
      label: 'Unknown',
      color: 'text-muted bg-surface-elevated border-border',
    },
  };

  const info = patternLabels[light.pattern] ?? patternLabels.unknown;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Sun className="w-5 h-5 text-amber-400" />
        <h3 className="font-semibold">Light Environment</h3>
      </div>
      <div className="mb-2">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${info.color}`}
        >
          {info.label.toUpperCase()}
        </span>
      </div>
      <p className="text-sm text-muted mb-3">{light.reasoning}</p>
      <div className="grid grid-cols-3 gap-3 text-sm">
        {light.meanDaytimeLight !== null && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wide">Day peak</div>
            <div className="font-mono font-medium">{light.meanDaytimeLight.toFixed(0)}</div>
          </div>
        )}
        {light.meanNighttimeLight !== null && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wide">Night min</div>
            <div className="font-mono font-medium">{light.meanNighttimeLight.toFixed(0)}</div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Curves</div>
          <div className="font-mono font-medium">{light.postReleaseCurveCount}</div>
        </div>
      </div>
    </div>
  );
}

function TempComparisonCard({ temp }: { temp: TempComparison }) {
  const envLabels: Record<string, { label: string; color: string }> = {
    in_water: {
      label: 'In water',
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    },
    in_air_exposed: {
      label: 'In air (exposed)',
      color: 'text-warning bg-warning/10 border-warning/20',
    },
    in_air_insulated: {
      label: 'Insulated / indoors',
      color: 'text-primary bg-primary/10 border-primary/20',
    },
    air_conditioned: {
      label: 'Air-conditioned / cooler',
      color: 'text-info bg-info/10 border-info/20',
    },
    anomalous_hot: {
      label: 'Anomalously hot',
      color: 'text-error bg-error/10 border-error/20',
    },
    insufficient: {
      label: 'Insufficient data',
      color: 'text-muted bg-surface-elevated border-border',
    },
    unknown: {
      label: 'Unknown',
      color: 'text-muted bg-surface-elevated border-border',
    },
  };

  const info = envLabels[temp.environment] ?? envLabels.unknown;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Thermometer className="w-5 h-5 text-orange-400" />
        <h3 className="font-semibold">Temperature Environment</h3>
      </div>
      <div className="mb-2">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${info.color}`}
        >
          {info.label.toUpperCase()}
        </span>
      </div>
      <p className="text-sm text-muted mb-3">{temp.reasoning}</p>
      <div className="grid grid-cols-2 gap-3 text-sm">
        {temp.tagTempRange && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wide">Tag range</div>
            <div className="font-mono font-medium">
              {temp.tagTempRange.min.toFixed(1)}–{temp.tagTempRange.max.toFixed(1)}°C
            </div>
          </div>
        )}
        {temp.sstTempC !== null && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wide">SST</div>
            <div className="font-mono font-medium">
              {temp.sstTempC.toFixed(1)}°C
              {temp.tagMinusSST !== null && (
                <span className="text-xs text-muted ml-1">
                  (Δ{temp.tagMinusSST > 0 ? '+' : ''}
                  {temp.tagMinusSST.toFixed(1)})
                </span>
              )}
            </div>
          </div>
        )}
        {temp.airTempC !== null && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wide">Air</div>
            <div className="font-mono font-medium">
              {temp.airTempC.toFixed(1)}°C
              {temp.tagMinusAir !== null && (
                <span className="text-xs text-muted ml-1">
                  (Δ{temp.tagMinusAir > 0 ? '+' : ''}
                  {temp.tagMinusAir.toFixed(1)})
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BurialDetectionCard({ burial }: { burial: BurialDetection }) {
  const verdictMeta: Record<string, { label: string; color: string }> = {
    buried_in_sand: {
      label: 'Buried in sand',
      color: 'text-error bg-error/10 border-error/20',
    },
    surface_exposed: {
      label: 'Surface exposed',
      color: 'text-warning bg-warning/10 border-warning/20',
    },
    insulated_indoor: {
      label: 'Insulated / indoor',
      color: 'text-primary bg-primary/10 border-primary/20',
    },
    in_water: {
      label: 'In water',
      color: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
    },
    insufficient: {
      label: 'Insufficient data',
      color: 'text-muted bg-surface-elevated border-border',
    },
    unknown: {
      label: 'Unknown',
      color: 'text-muted bg-surface-elevated border-border',
    },
  };

  const info = verdictMeta[burial.verdict] ?? verdictMeta.unknown;

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Mountain className="w-5 h-5 text-amber-700" />
        <h3 className="font-semibold">Burial Signature</h3>
      </div>
      <div className="mb-2">
        <span
          className={`inline-block px-3 py-1 rounded-full text-xs font-semibold border ${info.color}`}
        >
          {info.label.toUpperCase()}
        </span>
      </div>
      <p className="text-sm text-muted mb-3">{burial.reasoning}</p>
      <div className="grid grid-cols-3 gap-3 text-sm">
        {burial.medianDielAmplitudeC !== null && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wide">Diel Δ</div>
            <div className="font-mono font-medium">
              {burial.medianDielAmplitudeC.toFixed(1)}°C
            </div>
          </div>
        )}
        {burial.medianTempC !== null && (
          <div>
            <div className="text-xs text-muted uppercase tracking-wide">Median</div>
            <div className="font-mono font-medium">{burial.medianTempC.toFixed(1)}°C</div>
          </div>
        )}
        <div>
          <div className="text-xs text-muted uppercase tracking-wide">Days</div>
          <div className="font-mono font-medium">{burial.windowsAnalyzed}</div>
        </div>
      </div>
    </div>
  );
}

function BathymetryCard({ bathy }: { bathy: Bathymetry }) {
  if (bathy.source === 'unavailable' && bathy.seabedDepthM === null) {
    // Only show "on land per GEBCO" message, not generic unavailable
    if (!bathy.interpretation.toLowerCase().includes('land')) return null;
  }

  return (
    <div className="bg-surface rounded-xl border border-border p-5">
      <div className="flex items-center gap-2 mb-3">
        <Mountain className="w-5 h-5 text-info" />
        <h3 className="font-semibold">Seabed</h3>
      </div>
      {bathy.tagOnSeabed && (
        <div className="mb-2">
          <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold border text-warning bg-warning/10 border-warning/20">
            TAG ON SEABED
          </span>
        </div>
      )}
      <p className="text-sm text-muted mb-2">{bathy.interpretation}</p>
      {bathy.seabedDepthM !== null && (
        <div className="text-sm">
          <span className="text-muted text-xs uppercase tracking-wide">Seabed depth:</span>{' '}
          <span className="font-mono font-medium">{bathy.seabedDepthM.toFixed(0)} m</span>
          <span className="text-xs text-muted ml-2">(GEBCO 2020)</span>
        </div>
      )}
    </div>
  );
}

function degToCompass(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}
