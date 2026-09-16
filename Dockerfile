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
# builds both with buildx + QEMU). This file pins no platform, compiles no
# native code — better-sqlite3 13 ships prebuilt binaries for both libc flavours
# — and only uses COPY/RUN in the runtime stage, which keeps emulated
# cross-builds viable.
#
# The runtime image never runs `npm install`: it gets the traced node_modules
# from `.next/standalone` plus the few packages the migration runner needs (see
# the runner stage).
# ---------------------------------------------------------------------------

# ---- Stage 1: dependencies ------------------------------------------------
FROM node:22-alpine AS deps
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false

# `npm ci` is pinned to the lockfile, so the image is reproducible.
COPY package.json package-lock.json ./
# No `apk add python3 make g++` here on purpose: better-sqlite3 13 ships
# prebuilds/linuxmusl-{x64,arm64}.node in the published tarball and
# lib/binding.js loads `prebuilds/<platform>-<arch>.node` at runtime, so the
# native module is never compiled. (Compiling it would also make the arm64
# build crawl under QEMU.) Keep any toolchain out of the image: nothing needs it.
RUN --mount=type=cache,target=/root/.npm npm ci
# Drop prebuilt binaries for platforms that cannot run here (~8 MB). All four
# linux variants stay, so both amd64 and arm64 keep working.
RUN rm -f node_modules/better-sqlite3/prebuilds/darwin-*.node \
          node_modules/better-sqlite3/prebuilds/win32-*.node

# ---- Stage 2: build -------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next needs public/ to exist even when the checkout only tracks it as an empty
# directory.
RUN mkdir -p public

# `next build` evaluates src/lib/env.ts, which throws without
# BETTER_AUTH_SECRET in production. The throwaway value below only satisfies the
# build; it is a build-stage ARG-less env var and never reaches the runtime image.
RUN BETTER_AUTH_SECRET=build-time-placeholder-not-a-real-secret npm run build

# The runtime image has no `tsx`, so the TypeScript migration runner is compiled
# to CommonJS here and shipped as /app/scripts/migrate.cjs. `npm run db:migrate`
# keeps using the .ts source with tsx during development.
RUN ./node_modules/.bin/tsc scripts/migrate.ts \
      --outDir /app/.migrate-build \
      --target ES2022 --module commonjs --moduleResolution node \
      --esModuleInterop --skipLibCheck --strict

# ---- Stage 3: runtime -----------------------------------------------------
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
