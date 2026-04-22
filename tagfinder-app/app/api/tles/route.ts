import { NextResponse } from 'next/server';

/**
 * Fetch TLE data for Argos constellation satellites from CelesTrak.
 * Cached server-side for 24 hours via Next.js fetch cache.
 *
 * Satellites tracked: NOAA-19, NOAA-20, METOP-B, METOP-C, SARAL
 */

const ARGOS_SATELLITES: Record<string, number> = {
  'NOAA-19': 33591,
  'NOAA-20': 43013,
  'METOP-B': 38771,
  'METOP-C': 43689,
  SARAL: 39086,
};

export async function GET() {
  const entries: { name: string; line1: string; line2: string }[] = [];

  for (const [name, noradId] of Object.entries(ARGOS_SATELLITES)) {
    try {
      const url = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${noradId}&FORMAT=TLE`;
      const res = await fetch(url, {
        signal: AbortSignal.timeout(6000),
        headers: { 'User-Agent': 'TurtleTag/1.0 (turtleops.org)' },
        next: { revalidate: 24 * 60 * 60 }, // Next.js cache: 24h
      });
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.trim().split('\n').map((l) => l.trim());
      if (lines.length >= 3) {
        entries.push({
          name: lines[0] || name,
          line1: lines[1],
          line2: lines[2],
        });
      }
    } catch {
      // skip this satellite
    }
  }

  return NextResponse.json(
    { entries },
    {
      headers: { 'Cache-Control': 'public, max-age=86400, s-maxage=86400' },
    }
  );
}
