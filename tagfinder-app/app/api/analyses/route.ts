import { NextRequest, NextResponse } from 'next/server';
import {
  createSupabaseRouteClient,
  createSupabaseAdminClient,
} from '@/lib/supabase';
import { notifyAnalysis } from '@/lib/notifyAnalysis';

/** A compact record is a few KB; anything larger is not one. */
const MAX_BODY_BYTES = 60_000;

/**
 * Record that an analysis ran.
 *
 * POST /api/analyses with { analysis, fileTypes }
 * Returns { id } for the page to hand to /api/summarize, which marks the row
 * when a brief is generated.
 *
 * Until now the only trace of a user running the tool was an email alert
 * that fired from the brief route and, it turned out, had never been
 * received. A row in tag_analyses (supabase/tag_analyses.sql) is the record:
 * who, when, which tag, which files, what the tool concluded — and later,
 * filled in by hand, whether the tag was found and how far from the estimate.
 *
 * Stores the same computed summary the brief already sends off-site and
 * nothing from the uploaded files. Failure here must never affect the
 * analysis the user is looking at, so the page fires this and forgets it.
 */
export async function POST(request: NextRequest) {
  const response = NextResponse.next();
  const supabase = createSupabaseRouteClient(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    return NextResponse.json({ error: 'Email verification required' }, { status: 401 });
  }

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'Payload too large for an analysis record.' }, { status: 413 });
  }
  let body: { analysis?: Record<string, unknown>; fileTypes?: unknown };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const a = body.analysis;
  if (!a || typeof a !== 'object') {
    return NextResponse.json({ error: 'Missing analysis' }, { status: 400 });
  }

  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const str = (v: unknown) => (typeof v === 'string' && v.length <= 80 ? v : null);
  const when = (v: unknown) => {
    if (typeof v !== 'string') return null;
    const t = new Date(v);
    return isNaN(t.getTime()) ? null : t.toISOString();
  };
  const fileTypes = Array.isArray(body.fileTypes)
    ? body.fileTypes.filter((t): t is string => typeof t === 'string' && t.length <= 40).slice(0, 40)
    : [];

  const row = {
    user_email: user.email.toLowerCase(),
    ptt: num(a.ptt),
    manufacturer: str(a.manufacturer),
    tag_category: str(a.tagCategory),
    file_types: fileTypes,
    fix_count: num(a.fixCount),
    last_fix_at: when(a.lastFixAt),
    release_at: when(a.releaseAt),
    release_category: str(a.releaseCategory),
    drift_recent: str(a.driftRecent),
    drift_medium: str(a.driftMedium),
    drift_all_time: str(a.driftAllTime),
    drift_speed_kmh: num(a.driftSpeedKmH),
    drift_heading_deg: num(a.driftHeadingDeg),
    best_lat: num(a.bestLat),
    best_lon: num(a.bestLon),
    position_method: str(a.positionMethod),
    primary_radius_m: num(a.primaryRadiusM),
    tag_state: str(a.tagState),
    summary: a,
  };

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.from('tag_analyses').insert(row).select('id').single();
  if (error) {
    console.error('tag_analyses insert failed:', error.message);
    return NextResponse.json({ error: 'Failed to record analysis' }, { status: 500 });
  }

  // The email alert moved here from the brief route: one notice per analysis,
  // whether or not a brief follows. Optional, and no longer silent when it is
  // not configured — see notifyAnalysis.
  notifyAnalysis({
    userEmail: user.email,
    ptt: row.ptt,
    briefExcerpt: null,
    bestLat: row.best_lat,
    bestLon: row.best_lon,
    inputTokens: null,
    outputTokens: null,
  }).catch(() => {});

  return NextResponse.json({ id: data.id }, { headers: { 'Cache-Control': 'no-store' } });
}
