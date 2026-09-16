# TaskTick in Docker

The image is a single container running the Next.js 15 standalone server on
`node:22-alpine` as uid 1000 (`node`), with the database on the `/data` volume.

## Quick start

```sh
cp .env.example .env          # required: docker compose refuses to start without it
openssl rand -base64 32       # paste the output into BETTER_AUTH_SECRET in .env
docker compose up -d
```

Then open `http://localhost:3000` (the first account created becomes the
administrator). Check the container with `docker compose logs -f tasktick` and
`docker compose ps` — the healthcheck polls `/healthz`.

`BETTER_AUTH_SECRET` is **required** in production: `src/lib/env.ts` refuses to
boot without it, and it both signs session cookies and derives the AES key that
encrypts stored CalDAV passwords. Rotating it invalidates all sessions and
forces users to re-enter their calendar credentials.

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
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

The overlay adds a `postgres:17-alpine` service with its own named volume, makes
the app wait for `service_healthy`, and presets
`DATABASE_URL=postgres://tasktick:…@db:5432/tasktick` (it overrides `.env`).
The `/data` volume is unused in that setup.

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
Then set `APP_URL=https://tasks.example.com` and `TRUST_PROXY=true` in `.env`,
and stop publishing port 3000 to the outside world
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

No native compilation takes place: `better-sqlite3` ships prebuilt binaries for
glibc and musl on both architectures, which is also why arm64 builds work under
emulation. The runtime stage installs nothing — it copies `.next/standalone`,
`drizzle/`, `scripts/` and `public/`.
