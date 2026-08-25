import { NextRequest, NextResponse } from 'next/server';
import {
  createSupabaseRouteClient,
  createSupabaseAdminClient,
} from '@/lib/supabase';

const REPORTS_PER_DAY = 20;
const MAX_BODY_BYTES = 300_000;
const ID_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // unambiguous chars
const ID_LENGTH = 8;

/**
 * Create a shareable snapshot of a tag analysis.
 *
 * POST /api/reports with { analysis, environment, brief, upcomingPasses }
 *
 * Returns: { id, url } where url is the public share link.
 *
 * Auth: requires a verified Supabase session (the creator).
 * Anyone with the resulting URL can view (no auth on the read side).
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.next();
  const supabase = createSupabaseRouteClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user || !user.email) {
    return NextResponse.json(
      { error: 'Email verification required' },
      { status: 401 }
    );
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: 'Payload too large for a report snapshot.' },
      { status: 413 }
    );
  }
  let body: {
    analysis?: unknown;
    environment?: unknown;
    brief?: string;
    upcomingPasses?: unknown;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.analysis || typeof body.analysis !== 'object') {
    return NextResponse.json(
      { error: 'Missing or invalid analysis payload' },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();

  // Per-email daily limit — prevent abuse / runaway sharing
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const { count: todayCount } = await admin
    .from('tag_reports')
    .select('id', { count: 'exact', head: true })
    .eq('created_by_email', user.email.toLowerCase())
    .gte('created_at', today.toISOString());
  if (todayCount !== null && todayCount >= REPORTS_PER_DAY) {
    return NextResponse.json(
      { error: `Daily share limit reached (${REPORTS_PER_DAY} reports/day).` },
      { status: 429 }
    );
  }

  const id = generateId();
  const ptt =
    typeof (body.analysis as { ptt?: unknown }).ptt === 'number'
      ? ((body.analysis as { ptt: number }).ptt)
      : null;

  const { error } = await admin.from('tag_reports').insert({
    id,
    ptt,
    created_by_email: user.email.toLowerCase(),
    analysis: body.analysis,
    environment: body.environment ?? null,
    brief: body.brief ?? null,
    upcoming_passes: body.upcomingPasses ?? null,
  });

  if (error) {
    console.error('report insert failed:', error.message);
    return NextResponse.json(
      { error: 'Failed to save report' },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id,
    url: `/r/${id}`,
  });
}

function generateId(): string {
  let out = '';
  const arr = new Uint8Array(ID_LENGTH);
  crypto.getRandomValues(arr);
  for (let i = 0; i < ID_LENGTH; i++) {
    out += ID_ALPHABET[arr[i] % ID_ALPHABET.length];
  }
  return out;
}
