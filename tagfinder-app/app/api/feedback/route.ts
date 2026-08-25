import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseRouteClient, createSupabaseAdminClient } from '@/lib/supabase';

/**
 * Submit feedback on a recovery brief.
 * POST /api/feedback with { rating: -1 | 1, comment?: string, analysisSnapshot?: object }
 *
 * Protected by Supabase session (must have verified email).
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
  if (raw.length > 100_000) {
    return NextResponse.json({ error: 'Payload too large.' }, { status: 413 });
  }
  let body: {
    rating?: number;
    comment?: string;
    analysisSnapshot?: unknown;
    pageUrl?: string;
  };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof body.comment === 'string' && body.comment.length > 5000) {
    body.comment = body.comment.slice(0, 5000);
  }

  const rating = body.rating;
  if (rating !== -1 && rating !== 1) {
    return NextResponse.json(
      { error: 'rating must be -1 or 1' },
      { status: 400 }
    );
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin.from('tag_feedback').insert({
    user_id: user.id,
    email: user.email,
    rating,
    comment: body.comment?.trim() || null,
    analysis_snapshot: body.analysisSnapshot || null,
    page_url: body.pageUrl || null,
  });

  if (error) {
    return NextResponse.json(
      { error: `Failed to save feedback: ${error.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
