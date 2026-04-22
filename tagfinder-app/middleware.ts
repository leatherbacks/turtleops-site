import { NextRequest, NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rateLimit';

/**
 * IP-based rate limiting for environment/support API routes.
 * Per IP: 60 requests per day across these routes (plenty for normal use,
 * limits bots).
 *
 * /api/summarize has its own per-email rate limit (handled inside the route).
 */

const IP_MAX_PER_DAY = 60;

const RATE_LIMITED_ROUTES = [
  '/api/elevation',
  '/api/weather',
  '/api/tides',
  '/api/geocode',
  '/api/tles',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only rate-limit the API routes listed above
  if (!RATE_LIMITED_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Derive client IP from Vercel/proxy headers
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';

  try {
    const result = await checkRateLimit({
      key: `ip:${ip}`,
      maxPerDay: IP_MAX_PER_DAY,
    });

    if (!result.allowed) {
      return NextResponse.json(
        {
          error: 'Rate limit exceeded. Please try again tomorrow.',
          resetAt: result.resetAt.toISOString(),
        },
        { status: 429 }
      );
    }

    const response = NextResponse.next();
    response.headers.set('X-RateLimit-Remaining', String(result.remaining));
    return response;
  } catch {
    // If rate limit check fails (e.g., Supabase unreachable), fail open so the tool still works
    return NextResponse.next();
  }
}

export const config = {
  matcher: [
    '/api/elevation/:path*',
    '/api/weather/:path*',
    '/api/tides/:path*',
    '/api/geocode/:path*',
    '/api/tles/:path*',
  ],
};
