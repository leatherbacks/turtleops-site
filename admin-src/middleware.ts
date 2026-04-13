import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Only run auth checks on routes that need them (dashboard + login).
  // All other pages pass through instantly — no Supabase roundtrip.
  const needsAuth = pathname.startsWith('/dashboard') || pathname === '/login';
  if (!needsAuth) {
    return NextResponse.next();
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Refresh session token if needed
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Unauthenticated users trying to access dashboard → redirect to login
  if (!user && pathname.startsWith('/dashboard')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('error', 'unauthorized');
    return NextResponse.redirect(url);
  }

  // Authenticated users on login page → redirect to dashboard
  if (user && pathname === '/login') {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  // Server-side subscriber + admin check for dashboard routes
  if (user && pathname.startsWith('/dashboard')) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role, is_subscriber, is_active, org_id')
      .eq('id', user.id)
      .single();

    // No profile, not admin, not subscriber, or disabled → block access
    if (!profile || profile.role !== 'admin' || !profile.is_subscriber || !profile.is_active) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('error', 'subscriber_required');
      return NextResponse.redirect(url);
    }

    // No org assigned → block access
    if (!profile.org_id) {
      const url = request.nextUrl.clone();
      url.pathname = '/login';
      url.searchParams.set('error', 'no_organization');
      return NextResponse.redirect(url);
    }
  }

  // Security headers
  supabaseResponse.headers.set('X-Frame-Options', 'DENY');
  supabaseResponse.headers.set('X-Content-Type-Options', 'nosniff');
  supabaseResponse.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  supabaseResponse.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Only match dashboard and login routes — skip static assets entirely
    '/dashboard/:path*',
    '/login',
  ],
};
