import type { Manufacturer, FileType, DetectedFile } from '@/lib/types';

/** Header patterns that identify Wildlife Computers file types.
 *  Order matters: more specific patterns first so Series doesn't match as Locations.
 */
const WC_PATTERNS: { fileType: FileType; required: string[] }[] = [
  // Most specific first
  {
    fileType: 'summary',
    required: ['PercentDecoded', 'Passes', 'ReleaseDate'],
  },
  {
    fileType: 'series',
    required: ['Day', 'Time', 'Depth', 'DRange'],
  },
  {
    fileType: 'sst',
    required: ['DepthSensor', 'Depth', 'Temperature', 'Source'],
  },
  {
    fileType: 'minmaxdepth',
    required: ['MinDepth', 'MaxDepth', 'MinAccuracy'],
  },
  {
    fileType: 'corrupt',
    required: ['Reason', 'Possible Type'],
  },
  {
    fileType: 'lightloc',
    required: ['LL0', 'Depth0', 'SolarLongitude', 'SolarLatitude'],
  },
  {
    fileType: 'argos',
    required: ['MsgCount', 'Satellite', 'Duplicates'],
  },
  {
    fileType: 'status',
    required: ['DepthSensor', 'Instr', 'SW', 'RTC'],
  },
  {
    fileType: 'locations',
    required: ['Quality', 'Latitude', 'Longitude', 'Error radius'],
  },
];

/**
 * Detect manufacturer and file type from CSV headers.
 * Primary detection: header patterns. Fallback: filename patterns.
 */
export function detectFile(file: File, headers: string[]): DetectedFile {
  const normalizedHeaders = headers.map((h) => h.trim());

  // Try Wildlife Computers header patterns
  for (const pattern of WC_PATTERNS) {
    const allPresent = pattern.required.every((req) =>
      normalizedHeaders.some((h) => h.includes(req))
    );
    if (allPresent) {
      return { file, manufacturer: 'wildlife_computers', fileType: pattern.fileType };
    }
  }

  // Fallback: filename pattern (e.g., "285932-Locations.csv")
  const name = file.name.toLowerCase();
  if (name.includes('summary')) return { file, manufacturer: 'wildlife_computers', fileType: 'summary' };
  if (name.includes('seriesrange')) return { file, manufacturer: 'unknown', fileType: 'unknown' }; // not yet supported
  if (name.includes('series')) return { file, manufacturer: 'wildlife_computers', fileType: 'series' };
  if (name.includes('sst')) return { file, manufacturer: 'wildlife_computers', fileType: 'sst' };
  if (name.includes('minmaxdepth')) return { file, manufacturer: 'wildlife_computers', fileType: 'minmaxdepth' };
  if (name.includes('corrupt')) return { file, manufacturer: 'wildlife_computers', fileType: 'corrupt' };
  if (name.includes('lightloc')) return { file, manufacturer: 'wildlife_computers', fileType: 'lightloc' };
  if (name.includes('location') && !name.includes('lightloc')) return { file, manufacturer: 'wildlife_computers', fileType: 'locations' };
  if (name.includes('argos') && !name.includes('raw')) return { file, manufacturer: 'wildlife_computers', fileType: 'argos' };
  if (name.includes('status')) return { file, manufacturer: 'wildlife_computers', fileType: 'status' };

  return { file, manufacturer: 'unknown', fileType: 'unknown' };
}
