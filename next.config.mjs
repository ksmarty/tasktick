/**
 * Next.js configuration.
 *
 * Plain `.mjs` rather than `.ts` on purpose: with a TypeScript config, Next has
 * to keep the TypeScript compiler reachable at runtime, which pulls ~9 MB of
 * `typescript` into the standalone bundle and pays a config-compile cost on
 * every cold start. Nothing here needs types.
 */

/** Set by the Docker build. Only the container consumes standalone output. */
const wantsStandalone = process.env.BUILD_STANDALONE === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  /*
   * Standalone output is gated on an env var.
   *
   * `output: 'standalone'` costs ~12 seconds of build time: the file tracer has
   * to resolve and emit the full runtime file set. Only the Docker image
   * consumes that output — the standalone directory is not used by `next start`,
   * by the test suite, or by anything in CI — so local and CI builds skip it and
   * the Dockerfile opts in with BUILD_STANDALONE=1.
   *
   * The trade is that a local build no longer exercises the shipped artefact.
   * The publish workflow builds and pushes the image on every push to main, so
   * that path stays covered.
   */
  output: wantsStandalone ? 'standalone' : undefined,

  reactStrictMode: true,
  poweredByHeader: false,

  /*
   * Type checking is a separate, explicit step (`npm run typecheck`), which CI
   * runs before the build. Doing it again inside `next build` doubles the cost
   * of every build for no extra safety — it is the same `tsc` over the same
   * files — and it is the second-largest phase after file tracing.
   */
  typescript: { ignoreBuildErrors: true },

  // better-sqlite3 and pg are native/CJS: keep them external to the server bundle.
  serverExternalPackages: ['better-sqlite3', 'pg', 'web-push'],

  /*
   * Bound the file tracer and keep it honest.
   *
   * Most of what it would otherwise consider is build-time-only tooling that can
   * never be `require`d at runtime. Excluding it shrinks the emitted bundle
   * (86 MB -> 66 MB) and the published image with it. Be conservative: anything
   * the server might import at runtime must stay.
   */
  outputFileTracingRoot: process.cwd(),
  outputFileTracingExcludes: {
    '*': [
      // Image optimisation. Nothing here uses next/image — every icon is an
      // inline SVG — so the sharp/libvips binaries are dead weight.
      './node_modules/@img/**',
      './node_modules/sharp/**',
      // Reached only via autoprefixer, at build time.
      './node_modules/caniuse-lite/**',
      // Schema generation, bundlers, the test runner: all build-time only.
      './node_modules/drizzle-kit/**',
      './node_modules/@rolldown/**',
      './node_modules/rollup/**',
      './node_modules/vite/**',
      './node_modules/vitest/**',
      './node_modules/@vitest/**',
      './node_modules/@esbuild/**',
      './node_modules/@esbuild-kit/**',
      './node_modules/esbuild/**',
      './node_modules/lightningcss*/**',
      './node_modules/@tailwindcss/**',
      './node_modules/tailwindcss/**',
      './node_modules/@opentelemetry/**',
    ],
  },

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
