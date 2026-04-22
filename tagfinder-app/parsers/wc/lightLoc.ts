import type { LightCurve, LightLocType } from '@/lib/types';
import { parseWCDate } from './dates';

const NUM_SAMPLES = 17; // LL0..LL16

/** Parse Wildlife Computers LightLoc.csv */
export function parseLightLoc(rows: Record<string, string>[]): LightCurve[] {
  const curves: LightCurve[] = [];

  for (const row of rows) {
    const day = (row['Day'] || '').trim();
    const time = (row['Time'] || '').trim();
    if (!day || !time) continue;
    const date = parseWCDate(`${time} ${day}`);
    if (!date) continue;

    const typeRaw = (row['Type'] || '').trim() as LightLocType;
    const validTypes: LightLocType[] = ['Dawn', 'Dusk', 'Begin', 'End'];
    const type: LightLocType = validTypes.includes(typeRaw)
      ? typeRaw
      : 'Unknown';

    const lightSamples: number[] = [];
    const depthSamples: number[] = [];
    for (let i = 0; i < NUM_SAMPLES; i++) {
      const ll = parseFloat(row[`LL${i}`] || '');
      const depth = parseFloat(row[`Depth${i}`] || '');
      if (!isNaN(ll)) lightSamples.push(ll);
      if (!isNaN(depth)) depthSamples.push(depth);
    }

    curves.push({
      date,
      type,
      solarLat: parseNumOrNull(row['SolarLatitude']),
      solarLon: parseNumOrNull(row['SolarLongitude']),
      initLat: parseNumOrNull(row['InitLat']),
      initLon: parseNumOrNull(row['InitLon']),
      lightSamples,
      depthSamples,
      deltaSeconds: parseNumOrNull(row['Delta']),
      minDepth: parseNumOrNull(row['MinDepth']),
      maxDepth: parseNumOrNull(row['MaxDepth']),
      sstTemp: parseNumOrNull(row['SSTTemp']),
      sstDepth: parseNumOrNull(row['SSTDepth']),
      attenShallow: parseNumOrNull(row['AttenShallow']),
      attenDeep: parseNumOrNull(row['AttenDeep']),
    });
  }

  return curves.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function parseNumOrNull(s: string | undefined): number | null {
  if (s === undefined || s === null || s === '') return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}
