/**
 * Next.js configuration.
 *
 * Plain `.mjs` rather than `.ts` on purpose: with a TypeScript config, Next has
 * to keep the TypeScript compiler reachable at runtime, which pulls ~9 MB of
 * `typescript` into the standalone bundle and pays a config-compile cost on
 * every cold start. Nothing here needs types.
 */

import { createRequire } from 'node:module';

/**
 * The version the user can read back in Settings.
 *
 * Read from `package.json` here and inlined by `env`, rather than read at
 * runtime: the standalone bundle does not ship `package.json`, so a runtime read
 * would work in development and fail in the image — the one place the question
 * "which version am I running" is actually asked.
 */
const require = createRequire(import.meta.url);
const { version: APP_VERSION } = require('./package.json');

/** Set by the Docker build. Only the container consumes standalone output. */
const wantsStandalone = process.env.BUILD_STANDALONE === '1';

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: { APP_VERSION },
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
   * (86 MB -> 64 MB) and the published image with it. Be conservative: anything
   * the server might import at runtime must stay.
   *
   * Note there is deliberately NO `outputFileTracingRoot` here. Setting it to
   * `process.cwd()` looked harmless and was not: in the Docker builder that is
   * `/app`, which contains `.next/cache` — hundreds of megabytes of webpack
   * cache. Rooting the trace there made it walk that cache, and on the emulated
   * arm64 leg of the multi-arch build that turned a ~16 minute image build into
   * one that ran past 35 minutes without finishing. Next's auto-detected root
   * already excludes the build output, so it is left alone.
   */
  outputFileTracingExcludes: {
    '*': [
      /*
       * Nothing here excludes `./.next/**`.
       *
       * That looked like an obvious belt-and-braces entry and it silently broke
       * the build: the tracer is what emits the Next server build into
       * `standalone/`, so excluding `.next` pruned `.next/server/chunks`
       * entirely. The bundle still built, and was 20 MB smaller, and every route
       * returned 500 — missing chunks, not a compile error. Only caught by
       * running it.
       */
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
      './node_modules/@opentelemetry/**',
    ],
  },

  eslint: { ignoreDuringBuilds: true },

  /*
   * Keep the instrumentation hook's node-only imports out of the edge compiler.
   *
   * The hook is compiled twice in development, and only in development: Next's
   * dev entry handler adds it to the node server compiler *and* to the edge
   * compiler, while `next build` deletes the edge copy whenever there is no
   * middleware (`createEntrypoints` in Next's `build/entries.js`). The hook's
   * graph is node-only — it reaches `web-push` (`https-proxy-agent` ->
   * `agent-base` -> `require('http')`), the SQLite/PG layer and
   * `bonjour-service` — so the edge copy cannot resolve a dozen node builtins
   * and *every* route in `next dev` answers 500 with
   * `Module not found: Can't resolve 'http'`, blaming `src/instrumentation.ts`.
   *
   * These three modules are excluded through `externals` rather than
   * `resolve.alias` on purpose: externals match the request before the resolver
   * runs, so the `@/*` paths from `tsconfig.json` cannot claim them first.
   *
   * Safe by construction: `register()` returns immediately unless
   * `NEXT_RUNTIME === 'nodejs'`, so the edge copy of the hook is a stub that
   * never runs. The node compiler — the one that does run, in development and in
   * the image — is left exactly as it is.
   */
  webpack(config, { nextRuntime }) {
    if (nextRuntime !== 'edge') return config;

    const nodeOnlyModules = [
      '@/server/services/reminder-scheduler',
      '@/server/services/scheduler',
      '@/server/mdns',
    ];

    config.externals = [
      ...(Array.isArray(config.externals) ? config.externals : []),
      Object.fromEntries(nodeOnlyModules.map((module) => [module, '{}'])),
    ];

    return config;
  },

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
