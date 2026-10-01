import { NextResponse } from 'next/server';
import { BUILD_ID } from '@/lib/buildCheck';

/**
 * Which build is the server running? Compared by the client against the
 * build it loaded, so a tab left open across a deployment reloads itself
 * before analysing the next tag instead of running last week's code on it.
 */
export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json({ build: BUILD_ID }, { headers: { 'Cache-Control': 'no-store' } });
}
