import { useState, useCallback } from 'react';
import type {
  AnalysisResult,
  DetectedFile,
  ArgosFix,
  DeploySummary,
  PopoffResult,
} from '@/lib/types';
import { parseCSV } from '@/parsers/csv';
import { detectFile } from '@/parsers/detect';
import { parseLocations } from '@/parsers/wc/locations';
import { parseSummary } from '@/parsers/wc/summary';
import { parseStatus } from '@/parsers/wc/status';
import { parseArgos } from '@/parsers/wc/argos';
import { parseSeries } from '@/parsers/wc/series';
import { parseSST } from '@/parsers/wc/sst';
import { parseMinMaxDepth } from '@/parsers/wc/minMaxDepth';
import { parseCorrupt } from '@/parsers/wc/corrupt';
import { parseLightLoc } from '@/parsers/wc/lightLoc';
import { parseDailyData } from '@/parsers/wc/dailyData';
import { classifyDrift } from '@/analysis/drift';
import { markOutliers } from '@/analysis/outliers';
import { computePosition } from '@/analysis/position';
import { computeSearchRadius } from '@/analysis/searchRadius';
import { predictDrift } from '@/analysis/driftPredict';
import { analyzeTagState } from '@/analysis/tagState';
import { analyzeDataQuality } from '@/analysis/dataQuality';
import { detectTagCategory } from '@/analysis/tagCategory';
import { buildDiveProfile } from '@/analysis/diveProfile';
import { analyzeTidalIntrusion } from '@/analysis/tidalIntrusion';
import { checkMirrorSolutions } from '@/analysis/mirrorCheck';
import { interpretReleaseType } from '@/analysis/releaseType';
import { detectCrushDepthEvent } from '@/analysis/crushDepth';
import { analyzeLightLevel } from '@/analysis/lightLevel';
import { analyzeTransmissionHealth } from '@/analysis/transmissionHealth';
import {
  estimatePopoffLocation,
  meetsNaultCriteria,
  type ArgosFix as NaultFix,
} from '@/analysis/popupLocation';

interface UseAnalysisReturn {
  detectedFiles: DetectedFile[];
  result: AnalysisResult | null;
  statuses: import('@/lib/types').TagStatus[];
  series: import('@/lib/types').SeriesReading[];
  passes: import('@/lib/types').ArgosPass[];
  dailySummaries: import('@/lib/types').DailySummary[];
  error: string | null;
  analyzing: boolean;
  analyze: (files: File[]) => Promise<void>;
  reset: () => void;
}

export function useAnalysis(): UseAnalysisReturn {
  const [detectedFiles, setDetectedFiles] = useState<DetectedFile[]>([]);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [statuses, setStatuses] = useState<import('@/lib/types').TagStatus[]>([]);
  const [series, setSeries] = useState<import('@/lib/types').SeriesReading[]>([]);
  const [passesState, setPassesState] = useState<import('@/lib/types').ArgosPass[]>([]);
  const [dailySummariesState, setDailySummariesState] = useState<import('@/lib/types').DailySummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const analyze = useCallback(async (files: File[]) => {
    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      // 1. Parse and detect all files
      const detected: DetectedFile[] = [];
      const parsedData: Record<string, Record<string, string>[]> = {};

      for (const file of files) {
        if (!file.name.endsWith('.csv')) continue;
        const { headers, rows } = await parseCSV(file);
        const det = detectFile(file, headers);
        detected.push(det);
        if (det.fileType !== 'unknown') {
          parsedData[det.fileType] = rows;
        }
      }

      setDetectedFiles(detected);

      // 2. Must have Locations at minimum
      if (!parsedData.locations) {
        setError('No Locations file detected. Please include a Locations CSV with Argos fixes.');
        setAnalyzing(false);
        return;
      }

      // 3. Parse typed data
      const fixes = parseLocations(parsedData.locations);
      const summary: DeploySummary | null = parsedData.summary
        ? parseSummary(parsedData.summary)
        : null;
      const parsedStatuses = parsedData.status ? parseStatus(parsedData.status) : [];
      const passes = parsedData.argos ? parseArgos(parsedData.argos) : [];
      const seriesReadings = parsedData.series ? parseSeries(parsedData.series) : [];
      const sstReadings = parsedData.sst ? parseSST(parsedData.sst) : [];
      const dailyDives = parsedData.minmaxdepth ? parseMinMaxDepth(parsedData.minmaxdepth) : [];
      const corruptMsgs = parsedData.corrupt ? parseCorrupt(parsedData.corrupt) : [];
      const lightCurves = parsedData.lightloc ? parseLightLoc(parsedData.lightloc) : [];
      const dailySummaries = parsedData.dailydata ? parseDailyData(parsedData.dailydata) : [];
      setStatuses(parsedStatuses);
      setSeries(seriesReadings);
      setPassesState(passes);
      setDailySummariesState(dailySummaries);

      if (fixes.length === 0) {
        setError('No valid Argos fixes found in the Locations file.');
        setAnalyzing(false);
        return;
      }

      // 4. Preliminary drift classification (before outlier removal)
      const prelimDrift = classifyDrift(fixes);

      // 5. Mark outliers based on drift state
      const effectiveLabel =
        prelimDrift.recent !== 'insufficient' ? prelimDrift.recent : prelimDrift.allTime;
      markOutliers(fixes, effectiveLabel === 'insufficient' ? 'stuck' : effectiveLabel);

      // 6. Final drift classification (after outlier removal)
      const driftState = classifyDrift(fixes);

      // 7. Compute position
      const finalLabel =
        driftState.recent !== 'insufficient' ? driftState.recent : driftState.allTime;
      const pos = computePosition(fixes, finalLabel === 'insufficient' ? 'stuck' : finalLabel);

      // 8. Search radius
      const { primaryM, expandedM } = computeSearchRadius(fixes);

      // 9. Drift prediction (only for drifting tags)
      const driftPrediction =
        finalLabel === 'drifting' ? predictDrift(fixes) : null;

      // Detect tag category (PSAT vs Tracker)
      const tagCategory = detectTagCategory(summary);

      // 10. Popoff estimation — only for PSAT tags
      let popoff: PopoffResult | null = null;
      let popoffSkipReason: string | null = null;
      if (tagCategory.category !== 'psat') {
        popoffSkipReason = null; // Not applicable — don't show skip reason
      } else if (!summary?.releaseDate) {
        popoffSkipReason = 'Summary.csv missing or no ReleaseDate';
      } else {
        const validFixes = fixes
          .filter((f) => !f.isOutlier && f.date.getTime() > summary.releaseDate!.getTime())
          .sort((a, b) => a.date.getTime() - b.date.getTime());

        if (validFixes.length < 2) {
          popoffSkipReason = 'Fewer than 2 valid fixes after release date';
        } else {
          const p1 = toNaultFix(validFixes[0]);
          const p2 = toNaultFix(validFixes[1]);
          const popoffTime = summary.releaseDate.getTime();

          const criteria = meetsNaultCriteria(p1, p2, popoffTime);
          if (criteria.ok) {
            const est = estimatePopoffLocation(p1, p2, popoffTime, 0.95);
            popoff = {
              lat: est.lat,
              lon: est.lon,
              method: 'target-tag',
              driftTimeHours: est.driftTimeHours,
              ellipseSemiMajorM: est.ellipseSemiMajor,
              ellipseSemiMinorM: est.ellipseSemiMinor,
              ellipseOrientationDeg: est.ellipseOrientation,
            };
          } else {
            popoffSkipReason = `Nault criteria not met: ${criteria.reason}`;
          }
        }
      }

      // 11. Tag state (from Status.csv + Series.csv) and data quality (from Argos.csv)
      // Note: tagState here is preliminary — will be re-computed with environment data in the page
      const tagState =
        parsedStatuses.length > 0 || summary || seriesReadings.length > 0
          ? analyzeTagState(parsedStatuses, summary, null, seriesReadings)
          : null;
      const dataQuality = passes.length > 0 ? analyzeDataQuality(passes) : null;
      const diveProfile = seriesReadings.length > 0 ? buildDiveProfile(seriesReadings) : null;
      const tidalIntrusion =
        tagCategory.category === 'psat'
          ? analyzeTidalIntrusion(seriesReadings, parsedStatuses, summary)
          : null;
      const mirrorCheck = passes.length > 0 ? checkMirrorSolutions(passes) : null;
      const releaseInterpretation = interpretReleaseType(summary);
      const crushDepthEvent = detectCrushDepthEvent(
        seriesReadings,
        dailyDives.length > 0 ? dailyDives : null,
        summary
      );
      const lightAnalysis = lightCurves.length > 0 ? analyzeLightLevel(lightCurves, summary) : null;
      const transmissionHealth = passes.length > 0 ? analyzeTransmissionHealth(passes, summary) : null;

      // 12. Build result
      const validFixes = fixes.filter((f) => !f.isOutlier);
      const outlierFixes = fixes.filter((f) => f.isOutlier);

      setResult({
        summary,
        ptt: summary?.ptt || null,
        tagCategory,
        allFixes: fixes,
        validFixes,
        outlierFixes,
        bestLat: pos.lat,
        bestLon: pos.lon,
        positionMethod: pos.method,
        driftState,
        driftPrediction,
        primaryRadiusM: primaryM,
        expandedRadiusM: expandedM,
        popoff,
        popoffSkipReason,
        tagState,
        dataQuality,
        diveProfile,
        sst: sstReadings.length > 0 ? sstReadings : null,
        dailyDives: dailyDives.length > 0 ? dailyDives : null,
        corruptCount: corruptMsgs.length,
        tidalIntrusion,
        satCoverage: null, // computed async in the page after TLE fetch
        mirrorCheck,
        antennaExposure: null, // computed async in the page after TLE fetch
        releaseInterpretation,
        crushDepthEvent,
        lightAnalysis,
        tempComparison: null, // computed async in the page after environment fetch
        bathymetry: null, // computed async in the page after environment fetch
        transmissionHealth,
        burialDetection: null, // computed async in the page after environment fetch
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed');
    } finally {
      setAnalyzing(false);
    }
  }, []);

  const reset = useCallback(() => {
    setDetectedFiles([]);
    setResult(null);
    setStatuses([]);
    setSeries([]);
    setPassesState([]);
    setDailySummariesState([]);
    setError(null);
    setAnalyzing(false);
  }, []);

  return {
    detectedFiles,
    result,
    statuses,
    series,
    passes: passesState,
    dailySummaries: dailySummariesState,
    error,
    analyzing,
    analyze,
    reset,
  };
}

/** Convert our ArgosFix to the Nault module's ArgosFix format */
function toNaultFix(fix: ArgosFix): NaultFix {
  return {
    lat: fix.latitude,
    lon: fix.longitude,
    time: fix.date.getTime(),
    semiMajor: fix.semiMajor > 0 ? fix.semiMajor : fix.effectiveError,
    semiMinor: fix.semiMinor > 0 ? fix.semiMinor : fix.effectiveError * 0.5,
    orientation: fix.orientation,
  };
}
