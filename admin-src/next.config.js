/** @type {import('next').NextConfig} */
const nextConfig = {
  // Only use static export for production builds (GitHub Pages)
  // In development, we need dynamic routes to work
  ...(process.env.NODE_ENV === 'production' && { output: 'export' }),
  basePath: '/admin',          // All routes prefixed with /admin
  trailingSlash: true,         // GitHub Pages compatibility
  images: { unoptimized: true }, // Required for static export
  // Use .next for dev, ../admin for production build
  distDir: process.env.NODE_ENV === 'production' ? '../admin' : '.next',
};

module.exports = nextConfig;
