import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseRouteClient } from '@/lib/supabase';
import { notifyAnalysis } from '@/lib/notifyAnalysis';

/**
 * Send one alert and report what Brevo said.
 *
 * GET /api/analyses/alert-test — signed-in session required, and only where
 * ALERT_INCLUDE_SELF=1 (the Preview environment). Exists because Vercel keeps
 * no runtime logs the CLI can read back, so the only way to learn why an
 * alert did not arrive was to make the send tell us directly.
 */
export async function GET(request: NextRequest) {
  if (process.env.ALERT_INCLUDE_SELF !== '1') {
    return NextResponse.json({ error: 'Not enabled in this environment' }, { status: 404 });
  }
  const response = NextResponse.next();
  const supabase = createSupabaseRouteClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Email verification required' }, { status: 401 });
  }
  const outcome = await notifyAnalysis({
    userEmail: user.email,
    ptt: 0,
    briefExcerpt: 'Alert path test from /api/analyses/alert-test — if you can read this, Brevo and the forward both work.',
    bestLat: null,
    bestLon: null,
    inputTokens: null,
    outputTokens: null,
  });
  return NextResponse.json(
    { keyConfigured: Boolean(process.env.BREVO_API_KEY), ...outcome },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
