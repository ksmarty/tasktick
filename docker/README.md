# TaskTick in Docker

The image is a single container running the Next.js 15 standalone server on
`node:22-alpine` as uid 1000 (`node`), with the database on the `/data` volume.

## Quick start

```sh
docker compose up -d
```

Then open `http://localhost:3000` (the first account created becomes the
administrator). Check the container with `docker compose logs -f tasktick` and
`docker compose ps` — the healthcheck comes from the image and polls `/healthz`.

There is no `.env` to create. `docker-compose.yml` supplies a working default for
every setting and the container generates its own signing secret on first boot
(see below). Create a `.env` only to override something — Compose reads it if it
is there and does not care if it is not.

## The signing secret

`BETTER_AUTH_SECRET` signs session cookies **and** derives the AES key that
encrypts stored CalDAV passwords, so it must be stable across restarts and
upgrades. `scripts/docker-entrypoint.sh` therefore:

1. uses `$BETTER_AUTH_SECRET` if the environment provides one;
2. otherwise reuses `/data/.better-auth-secret` if it exists;
3. otherwise generates 32 random bytes and stores them there, mode 600.

The secret is deliberately **not** printed to the container log — logs are often
shipped somewhere less protected than the data volume. To read it:

```sh
docker compose exec tasktick cat /data/.better-auth-secret
```

Because it lives in the data volume, backing up `/data` backs up the secret.
Losing it signs everyone out and makes stored CalDAV credentials unreadable,
which is why it is not regenerated on every boot.

Set it explicitly only when migrating an existing deployment. The server warns at
startup if the value is a placeholder published in this repository, or is
shorter than 32 characters.

## What happens on start

`scripts/docker-entrypoint.sh` runs migrations and then `exec`s the server as
PID 1, so `docker stop` sends SIGTERM straight to Next.js (graceful shutdown).

Only the default command (`node server.js`, or no command) is preceded by a
migration run. Overriding the command bypasses it:

```sh
docker compose run --rm tasktick sh                 # no migrations, just a shell
docker compose run --rm tasktick node scripts/migrate.cjs   # migrations on demand
```

Migrations are idempotent — a second run reports `database is up to date`. The
runner is `scripts/migrate.ts`, compiled to `/app/scripts/migrate.cjs` during
the image build because the runtime image deliberately ships no `tsx`
(`npm run db:migrate` keeps using the TypeScript source during development).
It picks the migrations folder from `DATABASE_URL`:

| `DATABASE_URL`                    | Driver           | Migrations      |
| --------------------------------- | ---------------- | --------------- |
| `file:/data/tasktick.db` (default) | better-sqlite3   | `drizzle/sqlite` |
| `postgres://…`                     | `pg`             | `drizzle/pg`     |

For Postgres the folder must exist in the image
(`npx drizzle-kit generate --config drizzle.pg.config.ts`); the entrypoint
retries for about 60 seconds so a slow database does not abort the boot.

## Postgres instead of SQLite

```sh
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

The overlay adds a `postgres:17-alpine` service with its own named volume, makes
the app wait for `service_healthy`, and presets
`DATABASE_URL=postgres://tasktick:…@db:5432/tasktick`. The `/data` volume still
holds the signing secret. Both services read the same
`${POSTGRES_PASSWORD:-tasktick}` default, so they always agree — set it in one
place if you change it.

Back up Postgres with:

```sh
docker compose -f docker-compose.yml -f docker-compose.postgres.yml \
  exec -T db pg_dump -U tasktick tasktick > tasktick-$(date +%F).sql
```

## HTTPS is not optional for the PWA

Installation to the iOS Home Screen and Web Push both require a secure context:
over plain HTTP the browser refuses to register the service worker and no push
subscription can be created. Terminate TLS in front of this container, e.g.

```sh
caddy reverse-proxy --from tasks.example.com --to 127.0.0.1:3000
```

…or nginx/Traefik with the usual `X-Forwarded-Proto`/`X-Forwarded-For` headers.
Then set `TRUST_PROXY=true`, set `APP_URL=https://tasks.example.com`, and add
`BETTER_AUTH_TRUSTED_ORIGINS=https://tasks.example.com` — a public hostname is
neither `APP_URL` nor a private address, so the auth origin check needs to be
told about it explicitly. (LAN access needs none of this.) Stop publishing port
3000 to the outside world in that setup
(`ports: ["127.0.0.1:${PORT:-3000}:3000"]`). CalDAV/ICS clients keep working
over HTTP, but reminders by push do not.

## Backup and restore (SQLite volume)

The SQLite file lives on the named volume `tasktick-data` (Compose prefixes it
with the project name — usually the checkout directory). WAL files sit next to
it, so stop the container before copying:

```sh
# backup
docker compose stop tasktick
docker run --rm -v tasktick-data:/data -v "$PWD":/backup alpine \
  tar czf /backup/tasktick-$(date +%F).tgz -C /data .
docker compose start tasktick

# restore
docker compose stop tasktick
docker run --rm -v tasktick-data:/data -v "$PWD":/backup alpine \
  sh -c 'rm -f /data/*.db /data/*.db-wal /data/*.db-shm && tar xzf /backup/tasktick-YYYY-MM-DD.tgz -C /data'
docker compose start tasktick
```

Prefer your own path instead of a named volume? Replace the volume with
`- ./data:/data` in `docker-compose.yml`, but make sure the directory is
writable by uid 1000 (`chown 1000:1000 data`).

## Building the image yourself

```sh
docker build -t tasktick .                 # or uncomment `build: .` in compose
docker buildx build --platform linux/amd64,linux/arm64 -t tasktick .
```

No native compilation of `better-sqlite3` binaries ends up in the runtime stage,
but the **deps stage does install a C++ toolchain**. `better-sqlite3` ships a
`binding.gyp` and no `install` script, so npm applies its default and runs
`node-gyp rebuild` during `npm ci` — prebuilds are only consulted later, at
`require()` time. Without `python3 make g++` the build fails with
`not found: make`; CI masked this because `ubuntu-latest` has a toolchain already.
The toolchain stays in the build stage, so the runtime image has no compiler.
The runtime stage installs nothing: it copies `.next/standalone`, `drizzle/`,
`scripts/` and `public/`.
