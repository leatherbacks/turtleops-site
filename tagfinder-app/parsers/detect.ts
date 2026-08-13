import type { Manufacturer, FileSource, FileType, DetectedFile } from '@/lib/types';
import { looksLikeArgosDS } from '@/parsers/argos/ds';
import { ARGOS_MESSAGES_REQUIRED } from '@/parsers/argos/messages';

interface HeaderPattern {
  fileType: FileType;
  source: FileSource;
  manufacturer: Manufacturer | 'unknown';
  required: string[];
}

/** Header patterns that identify Wildlife Computers file types.
 *  Order matters: more specific patterns first so Series doesn't match as Locations.
 */
const WC_BASE: { fileType: FileType; required: string[] }[] = [
  // Most specific first
  { fileType: 'summary', required: ['PercentDecoded', 'Passes', 'ReleaseDate'] },
  { fileType: 'series', required: ['Day', 'Time', 'Depth', 'DRange'] },
  { fileType: 'sst', required: ['DepthSensor', 'Depth', 'Temperature', 'Source'] },
  { fileType: 'minmaxdepth', required: ['MinDepth', 'MaxDepth', 'MinAccuracy'] },
  { fileType: 'dailydata', required: ['MinTemp', 'MaxTemp', 'DeltaLight'] },
  { fileType: 'histos', required: ['HistType', 'NumBins', 'Bin1', 'Bin72'] },
  { fileType: 'corrupt', required: ['Reason', 'Possible Type'] },
  { fileType: 'lightloc', required: ['LL0', 'Depth0', 'SolarLongitude', 'SolarLatitude'] },
  { fileType: 'argos', required: ['MsgCount', 'Satellite', 'Duplicates'] },
  { fileType: 'status', required: ['DepthSensor', 'Instr', 'SW', 'RTC'] },
  { fileType: 'locations', required: ['Quality', 'Latitude', 'Longitude', 'Error radius'] },
];

const WC_PATTERNS: HeaderPattern[] = WC_BASE.map((p) => ({
  ...p,
  source: 'wildlife_computers',
  manufacturer: 'wildlife_computers',
}));

/** Lotek PSAT exports. `TimeS` leads both files and appears in no WC format. */
const LOTEK_PATTERNS: HeaderPattern[] = [
  {
    fileType: 'lotek_daylog',
    source: 'lotek',
    manufacturer: 'lotek',
    required: ['TimeS', 'MaxPress', 'MinPress', 'TFLatN', 'TFLonN'],
  },
  {
    fileType: 'lotek_divelog',
    source: 'lotek',
    manufacturer: 'lotek',
    required: ['TimeS', 'ExtTemp', 'Pressure'],
  },
];

/**
 * CLS Argos/Kinéis per-message export. Manufacturer-agnostic like the DS dump:
 * a Lotek tag and a Wildlife Computers tag produce the same columns.
 */
const CLS_PATTERNS: HeaderPattern[] = [
  {
    fileType: 'argos_messages',
    source: 'argos_cls',
    manufacturer: 'unknown',
    required: ARGOS_MESSAGES_REQUIRED,
  },
];

/**
 * Exact, case-insensitive header match.
 *
 * This used to be a substring test, which was one column away from misfiring:
 * Lotek's `TimeS` contains "Time" and its `SST2Depth` contains "Depth", so a
 * Lotek Day Log already satisfied two of the four fields the WC `series`
 * pattern looks for and was saved only by `Day` and `DRange` being absent.
 */
function hasAll(headers: string[], required: string[]): boolean {
  const set = new Set(headers.map((h) => h.trim().toLowerCase()));
  return required.every((r) => set.has(r.toLowerCase()));
}

/**
 * Detect source and file type from CSV headers.
 * Primary detection: header patterns. Fallback: filename patterns.
 */
export function detectFile(file: File, headers: string[]): DetectedFile {
  for (const pattern of [...CLS_PATTERNS, ...WC_PATTERNS, ...LOTEK_PATTERNS]) {
    if (hasAll(headers, pattern.required)) {
      return {
        file,
        manufacturer: pattern.manufacturer,
        source: pattern.source,
        fileType: pattern.fileType,
      };
    }
  }

  // Fallback: filename pattern (e.g., "123456-Locations.csv")
  const name = file.name.toLowerCase();
  const wc = (fileType: FileType): DetectedFile => ({
    file,
    manufacturer: 'wildlife_computers',
    source: 'wildlife_computers',
    fileType,
  });

  if (name.includes('message'))
    return { file, manufacturer: 'unknown', source: 'argos_cls', fileType: 'argos_messages' };

  if (name.includes('day log') || name.includes('day_log'))
    return { file, manufacturer: 'lotek', source: 'lotek', fileType: 'lotek_daylog' };
  if (name.includes('dive log') || name.includes('dive_log'))
    return { file, manufacturer: 'lotek', source: 'lotek', fileType: 'lotek_divelog' };

  if (name.includes('summary')) return wc('summary');
  if (name.includes('seriesrange'))
    return { file, manufacturer: 'unknown', source: 'unknown', fileType: 'unknown' }; // not yet supported
  if (name.includes('series')) return wc('series');
  if (name.includes('sst')) return wc('sst');
  if (name.includes('minmaxdepth')) return wc('minmaxdepth');
  if (name.includes('dailydata')) return wc('dailydata');
  if (name.includes('histos')) return wc('histos');
  if (name.includes('corrupt')) return wc('corrupt');
  if (name.includes('lightloc')) return wc('lightloc');
  if (name.includes('location') && !name.includes('lightloc')) return wc('locations');
  if (name.includes('argos') && !name.includes('raw')) return wc('argos');
  if (name.includes('status')) return wc('status');

  return { file, manufacturer: 'unknown', source: 'unknown', fileType: 'unknown' };
}

/**
 * Detect non-CSV files from their content, before any CSV parsing is attempted.
 *
 * The Argos DS dump is whitespace-delimited with hex continuation lines and
 * will not survive Papa Parse, so it has to be recognised here instead. It is a
 * CLS product rather than a manufacturer one, so manufacturer stays 'unknown'
 * and is resolved from whatever else was uploaded alongside it.
 */
export function detectTextFile(file: File, text: string): DetectedFile | null {
  if (looksLikeArgosDS(text)) {
    return { file, manufacturer: 'unknown', source: 'argos_cls', fileType: 'argos_ds' };
  }
  return null;
}

/**
 * Recognise spreadsheet containers from their magic bytes so we can say
 * "export this as CSV" instead of failing with a parse error. Covers .xlsx /
 * .ods (a zip, "PK\x03\x04") and legacy .xls (an OLE2 compound file).
 *
 * Worth handling explicitly: the CLS Doppler export — the one product that
 * carries a continuous per-fix error radius — is distributed as .xlsx.
 */
export function detectSpreadsheet(file: File, magic: Uint8Array): DetectedFile | null {
  const is = (...bytes: number[]) => bytes.every((b, i) => magic[i] === b);
  const zip = is(0x50, 0x4b, 0x03, 0x04);
  const ole2 = is(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
  if (!zip && !ole2) return null;
  return {
    file,
    manufacturer: 'unknown',
    source: 'unknown',
    fileType: 'unknown',
    warning:
      'Spreadsheet files are not read directly. If this is a Lotek activity-health ' +
      'log, you do not need it — the same records are decoded straight from the ' +
      'CLS per-message export, and that recovers more of them. Otherwise save it ' +
      'as CSV and upload that.',
  };
}

/** PTT from a filename, e.g. "PSAT+-NNNNN_Day Log.csv" or "RAW_ID_0NNNNN_...txt". */
export function pttFromFilename(name: string): number | null {
  const m = name.match(/(?:ID[_-]?)?0*(\d{4,7})/);
  if (!m) return null;
  const v = parseInt(m[1], 10);
  return Number.isFinite(v) ? v : null;
}
