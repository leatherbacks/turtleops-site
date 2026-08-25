import { useState, useCallback } from 'react';
import type {
  AnalysisResult,
  DetectedFile,
  ArgosFix,
  DeploySummary,
  PopoffResult,
} from '@/lib/types';
import { parseCSV } from '@/parsers/csv';
import { detectFile, detectTextFile, detectSpreadsheet } from '@/parsers/detect';
import { parseArgosDS, type ArgosDSResult } from '@/parsers/argos/ds';
import { parseArgosMessages, type ArgosMessagesResult } from '@/parsers/argos/messages';
import {
  parseLotekHealthMessages,
  type LotekHealthResult,
} from '@/parsers/lotek/healthMessage';
import { parseLotekDayLog } from '@/parsers/lotek/dayLog';
import {
  detectOffloadKind,
  parseLotekOffload,
  mergeOffloads,
  anchorActivityEpoch,
  offloadSeries,
  type LotekOffloadResult,
} from '@/parsers/lotek/offload';
import { parseLotekDiveLog } from '@/parsers/lotek/diveLog';
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
import { parseHistos } from '@/parsers/wc/histos';
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
import { detectTrackerShed } from '@/analysis/trackerShed';
import { analyzeTransmissionHealth } from '@/analysis/transmissionHealth';
import { estimateRepetitionRate } from '@/analysis/repetitionRate';
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
  histograms: import('@/lib/types').HistogramSet | null;
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
  const [histogramsState, setHistogramsState] = useState<import('@/lib/types').HistogramSet | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);

  const analyze = useCallback(async (files: File[]) => {
    setAnalyzing(true);
    setError(null);
    setResult(null);

    try {
      // 1. Parse and detect all files.
      //    CSVs go through Papa Parse and header matching. Anything else is
      //    sniffed from its content first — the Argos DS dump is whitespace
      //    delimited with hex continuation lines and would not survive a CSV
      //    parse, so it never reaches header detection.
      const detected: DetectedFile[] = [];
      const parsedData: Record<string, Record<string, string>[]> = {};
      let argosDS: ArgosDSResult | null = null;
      const offloadParses: LotekOffloadResult[] = [];

      for (const file of files) {
        // Classify from content, never from the extension. Wildlife Computers
        // and Lotek both ship .csv, CLS ships .txt, and users rename files.
        const magic = new Uint8Array(await file.slice(0, 16).arrayBuffer());
        const spreadsheet = detectSpreadsheet(file, magic);
        if (spreadsheet) {
          detected.push(spreadsheet);
          continue;
        }

        // Lotek recovered-tag offload — binary, so it must be caught before
        // anything tries to read it as text. These only exist for a tag
        // physically in hand, which is exactly when the archive matters most.
        if (detectOffloadKind(magic)) {
          const bytes = new Uint8Array(await file.arrayBuffer());
          const parsed = parseLotekOffload(bytes);
          if (parsed) {
            offloadParses.push(parsed);
            const parts: string[] = [];
            if (parsed.activity) parts.push(`activity ${parsed.activity.records.length} records`);
            if (parsed.day) parts.push(`day log ${parsed.day.records.length} days`);
            if (parsed.basic) parts.push(`basic ${parsed.basic.samples.length} samples`);
            detected.push({
              file,
              manufacturer: 'lotek',
              source: 'lotek',
              fileType: 'lotek_offload',
              warning: parts.length
                ? undefined
                : 'Recognised as a Lotek offload but no record stream was found.',
            });
          }
          continue;
        }

        const head = await file.slice(0, 64 * 1024).text();

        const asText = detectTextFile(file, head);
        if (asText) {
          argosDS = parseArgosDS(await file.text());
          detected.push({
            ...asText,
            warning:
              argosDS.fixes.length === 0
                ? 'Argos file recognised but contained no resolved positions.'
                : undefined,
          });
          continue;
        }

        try {
          const { headers, rows } = await parseCSV(file);
          const det = detectFile(file, headers);
          detected.push(det);
          if (det.fileType !== 'unknown') {
            parsedData[det.fileType] = rows;
          }
        } catch {
          detected.push({
            file,
            manufacturer: 'unknown',
            source: 'unknown',
            fileType: 'unknown',
            warning: 'Could not be read as a tag export.',
          });
        }
      }

      // 1b. CLS per-message export. Parsed here rather than inline above
      //     because it arrives as an ordinary CSV and so only becomes
      //     identifiable after header detection.
      let argosMessages: ArgosMessagesResult | null = null;
      let lotekHealth: LotekHealthResult | null = null;
      if (parsedData.argos_messages) {
        argosMessages = parseArgosMessages(parsedData.argos_messages);
        // Lotek activity-health records ride inside the same payloads. Decoding
        // them here is the only way to get post-release temperature, light and
        // depth: the Day Log and Dive Log stop when the archive schedule ends,
        // which can be days before the tag releases.
        const health = parseLotekHealthMessages(parsedData.argos_messages);
        if (health.records.length > 0) lotekHealth = health;
        const d = detected.find((f) => f.fileType === 'argos_messages');
        if (d && argosMessages.fixes.length === 0) {
          d.warning =
            'Argos message export recognised but contained no resolved positions.';
        }
      }

      // 2. Lotek sensor exports. Both refuse to parse rather than guess when a
      //    file's date order is ambiguous, so surface that on the file itself.
      const lotekDive = parsedData.lotek_divelog
        ? parseLotekDiveLog(parsedData.lotek_divelog)
        : null;
      const lotekDay = parsedData.lotek_daylog
        ? parseLotekDayLog(parsedData.lotek_daylog)
        : null;

      for (const d of detected) {
        if (d.fileType === 'lotek_divelog' && lotekDive && !lotekDive.dateOrder) {
          d.warning = lotekDive.dateNote;
        }
        if (d.fileType === 'lotek_daylog' && lotekDay && !lotekDay.dateOrder) {
          d.warning = lotekDay.dateNote;
        }
      }

      setDetectedFiles(detected);

      // 3. Positions can come from a Wildlife Computers Locations export or
      //    from the CLS DS dump, which carries no manufacturer of its own.
      if (!parsedData.locations && !argosDS && !argosMessages) {
        setError(
          'No Argos positions found. Include a Wildlife Computers Locations CSV, ' +
            'or the raw Argos file from CLS.'
        );
        setAnalyzing(false);
        return;
      }

      // 4. Parse typed data, preferring whichever source carries real per-fix
      //    error. Wildlife Computers Locations has full ellipses; the CLS
      //    message export has a reported error radius; the DS dump has neither
      //    and falls back to per-class averages, so it ranks last.
      const fixes = parsedData.locations
        ? parseLocations(parsedData.locations)
        : argosMessages?.fixes ?? argosDS?.fixes ?? [];
      let summary: DeploySummary | null = parsedData.summary
        ? parseSummary(parsedData.summary)
        : null;

      // A PSAT only transmits once it has released, so its first activity-health
      // message bounds the release from above. Lotek ships no Summary.csv, and
      // without a release date tag state, temperature environment and burial
      // detection all refuse to run — they cannot tell the animal's dive record
      // from the tag's current situation. Deriving it here unblocks all three
      // from data we already hold, and it is marked derived rather than read.
      if (!summary && lotekHealth && lotekHealth.records.length > 0) {
        summary = {
          deployId: '',
          ptt: argosMessages?.ptt ?? 0,
          instrument: '',
          software: '',
          percentDecoded: 0,
          passes: 0,
          releaseDate: lotekHealth.records[0].date,
          earliestXmit: lotekHealth.records[0].date,
          latestData: null,
          inferredReleaseDate: null,
          releaseType: '',
          deployDate: null,
        };
      }
      const parsedStatuses = parsedData.status ? parseStatus(parsedData.status) : [];
      const passes = parsedData.argos
        ? parseArgos(parsedData.argos)
        : argosMessages?.passes ?? argosDS?.passes ?? [];
      // Health-message readings are post-release by construction, so they are
      // the ONLY series that describes the tag's current situation rather than
      // the animal's dive record. Without them tag state, burial detection and
      // the seabed comparison all report "no depth data" while the depth,
      // temperature and light they need sit decoded in the same upload.
      const healthSeries = (lotekHealth?.records ?? []).map((r) => ({
        date: r.date,
        depth: r.depthM,
        depthRange: null,
        temperature: r.temperatureC,
        temperatureRange: null,
      }));
      // A recovered tag's offloaded archive, when present and dateable, is the
      // fullest series available — on the reference deployment 7,888 records
      // against the 3,225 that survived Argos. Anchored exactly against the
      // manufacturer's Dive Log CSV when both are uploaded; to the day log's
      // first date (±half a day, kept away from anything diel) otherwise.
      const offload = offloadParses.length ? mergeOffloads(offloadParses) : null;
      const offloadAnchor = offload?.activity?.records.length
        ? anchorActivityEpoch(offload.activity, lotekDive?.readings ?? null, offload.day)
        : null;
      const archiveSeries =
        offload?.activity && offloadAnchor
          ? offloadSeries(offload.activity, offloadAnchor)
          : null;
      for (const d of detected) {
        if (d.fileType !== 'lotek_offload') continue;
        d.warning = !offload?.activity?.records.length
          ? d.warning
          : !offloadAnchor
            ? 'Archive decoded but undated: its clock is relative. Upload the Lotek Dive Log CSV or Day Log alongside to date it.'
            : offloadAnchor.method === 'day'
              ? `Archive dated to the day (±12 h) from the day log. Upload the Lotek Dive Log CSV for exact times.`
              : undefined;
      }

      const seriesReadings = archiveSeries
        ? [...archiveSeries, ...healthSeries].sort(
            (a, b) => a.date.getTime() - b.date.getTime()
          )
        : parsedData.series
          ? parseSeries(parsedData.series)
          : lotekDive && lotekDive.readings.length > 0
            ? [...lotekDive.readings, ...healthSeries].sort(
                (a, b) => a.date.getTime() - b.date.getTime()
              )
            : healthSeries;
      // Health-message temperatures are post-release by construction and are
      // the tag's own external sensor, so they are the right input for the
      // temperature-environment check. Prefer a real SST export where one
      // exists; fall back to the Day Log only when neither is available.
      const healthSst = (lotekHealth?.records ?? []).map((r) => ({
        date: r.date,
        depth: r.depthM,
        temperature: r.temperatureC,
        source: 'lotek_health',
      }));
      const sstReadings = parsedData.sst
        ? parseSST(parsedData.sst)
        : healthSst.length > 0
          ? healthSst
          : lotekDay?.sst ?? [];
      const dailyDives = parsedData.minmaxdepth
        ? parseMinMaxDepth(parsedData.minmaxdepth)
        : lotekDay?.dailyDives ?? [];
      const corruptMsgs = parsedData.corrupt ? parseCorrupt(parsedData.corrupt) : [];
      const lightCurves = parsedData.lightloc ? parseLightLoc(parsedData.lightloc) : [];
      const dailySummaries = parsedData.dailydata ? parseDailyData(parsedData.dailydata) : [];
      const histograms = parsedData.histos ? parseHistos(parsedData.histos) : null;
      setStatuses(parsedStatuses);
      setSeries(seriesReadings);
      setPassesState(passes);
      setDailySummariesState(dailySummaries);
      setHistogramsState(histograms);

      if (fixes.length === 0) {
        setError('No valid Argos fixes found in the Locations file.');
        setAnalyzing(false);
        return;
      }

      // Detect tag category early so we know whether to look for tracker
      // separation (a live tracker tag that has been removed from the animal
      // and is now sitting in a fixed location, behaving like a PSAT popoff).
      const datasetManufacturer =
        detected.find((d) => d.manufacturer !== 'unknown')?.manufacturer ?? 'unknown';
      const tagCategory = detectTagCategory(summary, datasetManufacturer);

      // For tracker tags, check if the tag has stopped moving — i.e. been
      // shed, removed, or recovered. When this fires we narrow the working
      // fix set to just the stationary period so downstream analyzers
      // (drift, outliers, position, mirror check, etc.) see the tag as
      // stationary instead of being thrown off by the 700+ days of historic
      // animal movement.
      const trackerShed =
        tagCategory.category === 'tracker' && (fixes.length >= 5 || parsedStatuses.length > 0)
          ? detectTrackerShed(fixes, parsedStatuses)
          : null;

      let workingFixes = fixes;
      if (trackerShed?.verdict === 'separated' && trackerShed.separatedSinceISO) {
        const cutoff = new Date(trackerShed.separatedSinceISO).getTime();
        workingFixes = fixes.filter((f) => f.date.getTime() >= cutoff);
      }

      // 4. Preliminary drift classification (before outlier removal)
      const prelimDrift = classifyDrift(workingFixes);

      // 5. Mark outliers based on drift state
      const effectiveLabel =
        prelimDrift.recent !== 'insufficient' ? prelimDrift.recent : prelimDrift.allTime;
      markOutliers(workingFixes, effectiveLabel === 'insufficient' ? 'stuck' : effectiveLabel);

      // 6. Final drift classification (after outlier removal)
      const driftState = classifyDrift(workingFixes);

      // 7. Compute position
      const finalLabel =
        driftState.recent !== 'insufficient' ? driftState.recent : driftState.allTime;
      const pos = computePosition(workingFixes, finalLabel === 'insufficient' ? 'stuck' : finalLabel);

      // 8. Drift prediction (only for drifting tags). Computed before the
      //    search radius because the radius depends on how far the tag could
      //    have travelled since the last fix.
      const driftPrediction =
        finalLabel === 'drifting' ? predictDrift(workingFixes) : null;

      // 9. Search radius — fix precision, widened by drift since the last fix
      const {
        primaryM,
        expandedM,
        basis: searchRadiusBasis,
      } = computeSearchRadius(workingFixes, {
        driftLabel: finalLabel,
        speedKmH: driftPrediction?.speedKmH ?? null,
      });

      // tagCategory already detected above (before tracker-shed check)

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
      // For separated trackers, scope the map + fix table to the stationary
      // period (workingFixes) — otherwise we'd render thousands of historic
      // points and obscure the actual recovery target.
      const reportedFixes = trackerShed?.verdict === 'separated' ? workingFixes : fixes;
      const validFixes = reportedFixes.filter((f) => !f.isOutlier);
      const outlierFixes = reportedFixes.filter((f) => f.isOutlier);

      // Post-release sensor data decoded from the raw payloads.

      setResult({
        summary,
        ptt: summary?.ptt || null,
        tagCategory,
        allFixes: reportedFixes,
        validFixes,
        outlierFixes,
        bestLat: pos.lat,
        bestLon: pos.lon,
        positionMethod: pos.method,
        driftState,
        driftPrediction,
        landfall: null, // computed async in the page once elevations resolve
        driftForcing: null, // computed async once wind/current resolve
        primaryRadiusM: primaryM,
        expandedRadiusM: expandedM,
        searchRadiusBasis,
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
        // How often the tag transmits, measured from its own timestamps. The
        // number a field team needs to tell "wrong place" from "not yet", and
        // one that rarely appears in any manufacturer export.
        repetitionRate: estimateRepetitionRate(
          argosMessages?.messageTimes ?? argosDS?.messageTimes ?? []
        ),
        lotekHealth: lotekHealth?.records ?? null,
        lotekHealthStatusChanged: lotekHealth?.statusChanged ?? false,
        burialDetection: null, // computed async in the page after environment fetch
        trackerShed,
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
    setHistogramsState(null);
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
    histograms: histogramsState,
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
