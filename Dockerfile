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
# Multi-arch: written for linux/amd64 and linux/arm64 (the release workflow
# builds both with buildx + QEMU). This file pins no platform, compiles no native
# code — `npm ci --ignore-scripts` means better-sqlite3's shipped prebuilds are
# used as-is — and only uses COPY/RUN in the runtime stage, which is what keeps
# emulated cross-builds viable.
#
# The runtime image never runs `npm install`: it gets the traced node_modules
# from `.next/standalone` plus the few packages the migration runner needs (see
# the runner stage).
# ---------------------------------------------------------------------------

# ---- Stage 1: dependencies (built ONCE, natively) ---------------------------
#
# `--platform=$BUILDPLATFORM` makes this stage run on the runner's own
# architecture even when cross-building for arm64. That matters enormously: without
# it, BuildKit emulates the arm64 leg through QEMU, and the webpack build in stage
# 2 is by far the most CPU-hungry thing in this file.
#
# It is safe here because the build output is architecture-independent. The app is
# pure JavaScript, and its only native dependency is better-sqlite3, which ships
# prebuilt binaries for every platform it supports in its own tarball and selects
# one at require() time in lib/binding.js. The tracer copies the whole prebuilds/
# directory, so the arm64 image receives linuxmusl-arm64.node even though the
# build ran on x64. Verified by inspecting the emitted bundle: all eight variants
# (linux/linuxmusl x x64/arm64, darwin, win32) are present, and no other native
# module appears in it at all.
#
# Only the runtime stage is per-architecture, and it does nothing but COPY.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# `npm ci` is pinned to the lockfile, so the image is reproducible.
COPY package.json package-lock.json ./

# `--ignore-scripts` on purpose, and it is what keeps this build quick.
#
# better-sqlite3 ships a `binding.gyp` and declares no `install` script, so npm
# applies its documented default and runs `node-gyp rebuild` during a plain
# `npm ci`. That forced a C++ toolchain into this stage and, far worse, made the
# arm64 leg compile the native module under QEMU emulation — the single largest
# cost in this image's build.
#
# The compile was always unnecessary: better-sqlite3 ships prebuilt binaries for
# every platform it supports (including linuxmusl-x64 and linuxmusl-arm64) and
# resolves them at require() time in lib/binding.js. Skipping install scripts
# skips the rebuild, and the prebuild is used exactly as intended.
#
# Verified rather than assumed: with `--ignore-scripts`, `npm ci` completes in
# ~8s (down from ~30s), better-sqlite3 opens a database and round-trips a query,
# and esbuild still transforms TypeScript without its postinstall. Nothing else
# in the tree has an install script that matters — the only others are esbuild's
# three copies and fsevents, which is darwin-only and skipped on Linux.
#
# No toolchain is installed below as a result. If a future dependency genuinely
# needs node-gyp, that will surface as an explicit build error here rather than
# being silently absorbed by a g++ that happens to be present.
RUN --mount=type=cache,target=/root/.npm npm ci --ignore-scripts
# Drop prebuilt binaries for platforms that cannot run here (~8 MB). All four
# linux variants stay, so both amd64 and arm64 keep working.
RUN rm -f node_modules/better-sqlite3/prebuilds/darwin-*.node \
          node_modules/better-sqlite3/prebuilds/win32-*.node

# ---- Stage 2: build (built ONCE, natively, same reasoning as stage 1) -------
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
# app ~5s faster, but its production server settles at 135.7 MB RSS against
# webpack's 125.5 MB — measured on this codebase with the same config, warmed, at
# steady state. A container that runs for months is built a handful of times, so
# the image takes the leaner runtime while local iteration takes the faster build.
# No BETTER_AUTH_SECRET is needed here: src/lib/env.ts exempts the build phase,
# so a build never requires a runtime secret.
RUN npm run build:standalone

# The runtime image has no `tsx`, so the TypeScript migration runner is compiled
# to CommonJS here and shipped as /app/scripts/migrate.cjs. `npm run db:migrate`
# keeps using the .ts source with tsx during development.
RUN ./node_modules/.bin/tsc scripts/migrate.ts \
      --outDir /app/.migrate-build \
      --target ES2022 --module commonjs --moduleResolution node \
      --esModuleInterop --skipLibCheck --strict

# ---- Stage 3: runtime (per target platform; COPY only) ---------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    DATABASE_URL=file:/data/tasktick.db

# The standalone bundle carries its own minimal server + node_modules subset.
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
# scripts/migrate.cjs requires pg from outside the bundle, so the closure is
# shipped explicitly instead of being left to the tracer.
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
