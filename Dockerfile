# syntax=docker/dockerfile:1.7
#
# TaskTick — single-container image (Next.js 15 standalone server).
#
#   docker build -t tasktick .
#   docker run -d --name tasktick -p 3000:3000 -v tasktick-data:/data \
#     -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" tasktick
#
# Compose users: see docker-compose.yml / docker-compose.postgres.yml.
#
# ---------------------------------------------------------------------------
# Multi-arch strategy
# ---------------------------------------------------------------------------
#
# The first two stages are pinned to `$BUILDPLATFORM` — the machine running the
# build — and only the final stage is per-target-architecture.
#
# That is the single biggest lever on this image's build time. `next build` under
# QEMU emulation was the dominant cost: successful multi-arch publishes were
# taking 15-30 minutes and some hit the workflow's 60-minute timeout. Building
# natively once and assembling per architecture cuts that to roughly the native
# build time, and buildx shares the native stages between both targets.
#
# This is safe because the output is architecture-independent, which was checked
# rather than assumed. The standalone bundle contains exactly eight native
# binaries and they are all better-sqlite3 prebuilds — every platform's, because
# the published tarball ships all of them and lib/binding.js picks the right one
# at require() time. `@swc` resolves to `helpers` and `env` only (pure JS), there
# is no `@next/swc-*` binary in the tree, and sharp/libvips, esbuild,
# lightningcss and the Tailwind oxide binaries are excluded from tracing. So the
# only architecture-sensitive artefact the runtime needs is the one that ships
# for all architectures anyway.
# ---------------------------------------------------------------------------

# ---- Stage 1: dependencies (native) ---------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# `npm ci` is pinned to the lockfile, so the image is reproducible.
COPY package.json package-lock.json ./

# `--ignore-scripts` on purpose.
#
# better-sqlite3 ships a `binding.gyp` and declares no `install` script, so a
# plain `npm ci` applies npm's documented default and runs `node-gyp rebuild` for
# it. That needs a C++ toolchain and — far worse — made the arm64 leg compile the
# native module under QEMU. The compile was always pointless: better-sqlite3
# ships prebuilt binaries for every platform it supports and resolves them at
# require() time in lib/binding.js. Skipping install scripts skips the rebuild.
#
# Verified: with the flag, `npm ci` finishes in about 8 seconds instead of about
# 30, better-sqlite3 opens a database and round-trips a query, and esbuild still
# transforms TypeScript without its postinstall. The only other packages with
# install scripts are esbuild's three copies and fsevents, which is darwin-only
# and skipped on Linux. No toolchain is installed anywhere as a result.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts

# Drop prebuilt binaries for platforms that cannot run here. All four Linux
# variants stay, so both amd64 and arm64 keep working.
RUN rm -f node_modules/better-sqlite3/prebuilds/darwin-*.node \
          node_modules/better-sqlite3/prebuilds/win32-*.node

# ---- Stage 2: build (native) ----------------------------------------------
FROM --platform=$BUILDPLATFORM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next needs public/ to exist even when the checkout only tracks it as an empty
# directory.
RUN mkdir -p public

# `build:standalone` rather than `build`: the standalone output is the only thing
# this image consumes, and generating it costs ~12s of file tracing that local and
# CI builds have no use for.
#
# It also runs webpack rather than turbopack deliberately. Turbopack compiles the
# app ~5s faster, but its production server settles ~10 MB higher in resident
# memory (measured back to back on this codebase, warmed, at steady state). A
# container that runs for months is built a handful of times, so the image takes
# the leaner runtime while local iteration takes the faster build.
#
# No BETTER_AUTH_SECRET is needed: src/lib/env.ts exempts the build phase, so a
# build never requires a runtime secret.
RUN npm run build:standalone

# The runtime image has no `tsx`, so the TypeScript migration runner is compiled
# to CommonJS here and shipped as /app/scripts/migrate.cjs. `npm run db:migrate`
# keeps using the .ts source with tsx during development.
RUN ./node_modules/.bin/tsc scripts/migrate.ts \
      --outDir /app/.migrate-build \
      --target ES2022 --module commonjs --moduleResolution node \
      --esModuleInterop --skipLibCheck --strict

# ---- Stage 3: runtime (per target architecture) ---------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/data/tasktick.db

# The standalone bundle carries its own minimal server + node_modules subset, and
# is architecture-independent (see the note at the top of this file).
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/public ./public
# Migration SQL and helper scripts live outside the Next bundle on purpose.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle
COPY --from=builder --chown=node:node /app/scripts ./scripts
COPY --from=builder --chown=node:node /app/.migrate-build/migrate.js ./scripts/migrate.cjs

# Two packages the file tracer cannot deliver:
#   * better-sqlite3 — lib/binding.js builds its prebuild path from
#     process.platform/arch at runtime, so `prebuilds/*.node` is never traced;
#   * drizzle-orm — webpack bundles it into the server chunks instead of leaving
#     it in node_modules, but scripts/migrate.cjs requires the migrator directly.
COPY --from=deps --chown=node:node /app/node_modules/better-sqlite3 ./node_modules/better-sqlite3
COPY --from=deps --chown=node:node /app/node_modules/drizzle-orm ./node_modules/drizzle-orm
# `pg` and its transitive runtime deps (pg-cloudflare, pg-connection-string,
# pg-int8, pg-pool, pg-protocol, pg-types, pgpass) plus pg-types' own deps
# (postgres-*, split2). The tracer normally delivers these for the server, but
# scripts/migrate.cjs requires pg from outside the bundle.
COPY --from=deps --chown=node:node /app/node_modules/pg* ./node_modules/
COPY --from=deps --chown=node:node /app/node_modules/postgres-* ./node_modules/
COPY --from=deps --chown=node:node /app/node_modules/split2 ./node_modules/split2

# /data holds the SQLite file; the named volume inherits this ownership.
RUN mkdir -p /data && chown node:node /data
# Next may write its own runtime caches under .next; everything else stays
# read-only for the unprivileged user.
RUN chown -R node:node /app/.next && chmod 755 /app/scripts/docker-entrypoint.sh

# Non-root, uid 1000 (the `node` user of the official image).
USER node

VOLUME /data

EXPOSE 3000

# Uses Node's built-in fetch, so no curl/wget is needed in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Runs pending migrations, then execs the server as PID 1.
ENTRYPOINT ["/app/scripts/docker-entrypoint.sh"]
CMD ["node", "server.js"]
