import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Produces .next/standalone — a self-contained server bundle we copy into the
  // runtime Docker stage so the final image carries no node_modules install step.
  output: 'standalone',
  reactStrictMode: true,
  poweredByHeader: false,
  // better-sqlite3 and pg are native/CJS: keep them external to the server bundle.
  serverExternalPackages: ['better-sqlite3', 'pg', 'web-push'],
  eslint: { ignoreDuringBuilds: true },
  async headers() {
    return [
      {
        // The service worker must never be served stale, or clients pin an old
        // shell forever and never pick up a new deploy.
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        source: '/manifest.webmanifest',
        headers: [{ key: 'Cache-Control', value: 'no-cache' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
