import { NextResponse } from 'next/server';

/**
 * Fetch TLE data for Argos constellation satellites from CelesTrak.
 * Cached server-side for 24 hours via Next.js fetch cache.
 *
 * Two sources:
 *  - Legacy platforms, one request each by catalog number.
 *  - Kinéis, 25 nanosats fetched in a single NAME= query. As of 2026 these
 *    carry the majority of Argos traffic — a recent deployment will show most
 *    of its passes against Kinéis, so omitting them makes reception rates
 *    (satCoverage / antennaExposure) read far worse than reality.
 *
 * CelesTrak names the Kinéis birds KINEIS-1A … KINEIS-5E, which matches the
 * two-character satellite codes that appear in Argos data verbatim.
 */

const LEGACY_SATELLITES: Record<string, number> = {
  'NOAA-19': 33591,
  'NOAA-20': 43013,
  'METOP-B': 38771,
  'METOP-C': 43689,
  SARAL: 39086,
  'OCEANSAT-3': 54361,
};

const FETCH_OPTS = {
  signal: AbortSignal.timeout(8000),
  headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
  next: { revalidate: 24 * 60 * 60 }, // Next.js cache: 24h
} as const;

interface TLEEntry {
  name: string;
  line1: string;
  line2: string;
}

/** Parse CelesTrak 3-line TLE text into entries. Tolerates trailing blank lines. */
function parseTLE(text: string): TLEEntry[] {
  const lines = text
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const out: TLEEntry[] = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const [name, line1, line2] = [lines[i], lines[i + 1], lines[i + 2]];
    if (!line1.startsWith('1 ') || !line2.startsWith('2 ')) break;
    out.push({ name, line1, line2 });
  }
  return out;
}

export async function GET() {
  const urls: string[] = [
    // All 25 Kinéis nanosats in one request
    'https://celestrak.org/NORAD/elements/gp.php?NAME=KINEIS&FORMAT=TLE',
    ...Object.values(LEGACY_SATELLITES).map(
      (id) => `https://celestrak.org/NORAD/elements/gp.php?CATNR=${id}&FORMAT=TLE`
    ),
  ];

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const res = await fetch(url, FETCH_OPTS);
      if (!res.ok) throw new Error(`${res.status}`);
      return parseTLE(await res.text());
    })
  );

  // Dedupe by name — a satellite could appear in both the group and a CATNR query
  const byName = new Map<string, TLEEntry>();
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const e of r.value) {
      if (!byName.has(e.name)) byName.set(e.name, e);
    }
  }

  return NextResponse.json(
    { entries: Array.from(byName.values()) },
    { headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' } }
  );
}
