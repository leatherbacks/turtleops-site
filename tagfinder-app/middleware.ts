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
  '/api/tide-extremes',
  '/api/water-temp',
  '/api/geocode',
  '/api/tles',
  '/api/forecast',
  '/api/bathymetry',
  '/api/drift-forcing',
];

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only rate-limit the API routes listed above
  if (!RATE_LIMITED_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.next();
  }

  // Client IP. request.ip and x-real-ip are set by the platform and cannot be
  // supplied by the client; the leftmost x-forwarded-for entry can be, and
  // keying the limit on it let anyone dodge the cap by rotating fake values.
  const ip =
    request.ip ||
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

// The matcher and RATE_LIMITED_ROUTES must list the same routes. They drifted
// once — two routes were listed above but never matched here, and three newer
// routes were added to neither — which silently exempted five of the ten.
export const config = {
  matcher: [
    '/api/elevation/:path*',
    '/api/weather/:path*',
    '/api/tides/:path*',
    '/api/tide-extremes/:path*',
    '/api/water-temp/:path*',
    '/api/geocode/:path*',
    '/api/tles/:path*',
    '/api/forecast/:path*',
    '/api/bathymetry/:path*',
    '/api/drift-forcing/:path*',
  ],
};
