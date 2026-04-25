import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase';

/**
 * Fetch a public shared report by ID.
 *
 * GET /api/reports/[id] — no auth required.
 * Returns the snapshot the creator saved.
 * Increments view_count on each fetch.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  if (!/^[a-z0-9]{6,16}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid report ID' }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('tag_reports')
    .select(
      'id, ptt, created_by_email, created_at, expires_at, view_count, analysis, environment, brief, upcoming_passes'
    )
    .eq('id', id)
    .maybeSingle();

  if (error) {
    return NextResponse.json(
      { error: 'Failed to fetch report', detail: error.message },
      { status: 500 }
    );
  }
  if (!data) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 });
  }
  if (data.expires_at && new Date(data.expires_at) < new Date()) {
    return NextResponse.json({ error: 'Report expired' }, { status: 410 });
  }

  // Best-effort view counter increment (don't block the response)
  admin
    .from('tag_reports')
    .update({ view_count: (data.view_count ?? 0) + 1 })
    .eq('id', id)
    .then(() => {});

  return NextResponse.json(
    {
      id: data.id,
      ptt: data.ptt,
      createdAt: data.created_at,
      expiresAt: data.expires_at,
      viewCount: (data.view_count ?? 0) + 1,
      analysis: data.analysis,
      environment: data.environment,
      brief: data.brief,
      upcomingPasses: data.upcoming_passes,
      // Note: created_by_email intentionally NOT exposed to viewers (PII)
    },
    {
      headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' },
    }
  );
}
