/**
 * Security headers. The app had none, which meant no clickjacking protection
 * on an email-gated tool and no restriction on where scripts could load from.
 *
 * The CSP allows exactly what the app actually uses and nothing else:
 *   script   self + Vercel Analytics (plus Next's own inline bootstrap —
 *            'unsafe-inline' is the cost of not running a nonce pipeline)
 *   connect  self (all external data goes through our own /api proxies) +
 *            Supabase for auth/session
 *   img      self + Esri tile servers + data/blob for Leaflet markers
 *   frames   none, in either direction
 *
 * If a new external origin is ever added client-side, it must be added here or
 * it will be silently blocked — check the browser console before assuming an
 * integration is broken.
 */
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').origin;
  } catch {
    return 'https://*.supabase.co';
  }
})();

const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://va.vercel-scripts.com",
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ${supabaseOrigin}`,
  "img-src 'self' data: blob: https://server.arcgisonline.com",
  "font-src 'self' data:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  'upgrade-insecure-requests',
].join('; ');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // This app renders no <Image> and serves no optimized images, so the
  // optimizer endpoint is pure attack surface — it is also where sharp (and
  // its libvips CVEs) would be reachable. Off entirely.
  images: { unoptimized: true },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=()',
          },
        ],
      },
    ];
  },
};

export default nextConfig;
