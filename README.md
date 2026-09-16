<div align="center">

# TaskTick

**A self-hosted task manager, calendar and habit tracker with real two-way CalDAV sync.**
Installable as an iOS PWA. One container. Your data, your server.

[Quick start](#quick-start) · [Features](#features) · [Calendar sync](#calendar-sync) · [Configuration](#configuration) · [Deployment](#deployment) · [Development](#development)

</div>

---

## Why this exists

TickTick is good, and it is also somebody else's server. TaskTick is the same
shape of app — tasks, lists, tags, a real calendar, habits, a focus timer — with
two things that matter:

1. **Calendar sync that actually goes both ways.** Not an `.ics` export. A proper
   CalDAV client with ETag optimistic locking, RFC 6578 delta sync, soft-delete
   tombstones, and a deterministic, audited conflict policy.
2. **One container.** `docker compose up -d` and you are done. SQLite by default,
   Postgres if you want it, no external services, no message queue, no Redis.

And a third thing that is harder to quantify: the UI is built to feel like a
native iOS app when it is added to the Home Screen. Dynamic Island safe areas,
rubber-band scrolling, spring animations, the real system colour palette in both
appearances, sheets with grabbers, swipe actions, haptic-feeling press states.

---

## Quick start

```bash
git clone https://github.com/ksmarty/tasktick.git
cd tasktick
docker compose up -d
```

That is the entire setup. There is no `.env` to create, no secret to generate
ahead of time, and no database to provision — the container generates its own
signing secret on first boot and stores it in the data volume.

Open `http://localhost:3000`. **The first account you register becomes the
administrator** — there is no CLI step and no default password.

> **Reaching it from another machine?** Just browse to it. A private network
> address is accepted automatically, so `http://192.168.1.50:3000`,
> `http://nas:3000` and a Tailscale name all work without configuration. Setting
> `APP_URL` is still worth doing so subscription links point somewhere your phone
> can reach — see [Configuration](#configuration).

> **iOS install:** open the instance in Safari, tap Share → *Add to Home Screen*.
> This is not cosmetic — iOS only grants Web Push, standalone display and the
> full safe-area behaviour to installed PWAs.

Then head to **Settings → Calendars** to connect iCloud, Google, Fastmail or
Nextcloud. See [Calendar sync](#calendar-sync).

---

## Features

### Tasks

- Lists (projects) with colours and emoji, plus a permanent Inbox
- Nested subtasks, where a parent completes only when its children do
- Priorities, tags, time estimates, spent-time tracking, pinning
- **Natural-language quick add** — `Submit report tomorrow at 5pm #work !high @Office ~2h every week`
  becomes a task with a due date, time, tag, list, priority, estimate and repeat rule
- Recurrence with two modes: `due` (fixed cadence — "every Monday" stays Monday)
  and `completion` (cadence restarts when you tick it off)
- Per-task reminders at any offset before the due time
- Multi-select bulk actions, drag-to-reorder, swipe-to-complete/delete

### Calendar

- Month, week, day and agenda views with a mini-month
- **Tasks and events on the same grid**, visually distinguishable
- Drag-to-reschedule with 15-minute snapping, on touch and mouse
- Multi-day all-day events render as one continuous bar
- Recurring series edited once, expanded per view
- Read-only `webcal://` subscription feed for any calendar client

### Habits

- Boolean, counted (`8 glasses`) and duration (`30 minutes`) goals
- Daily, weekly, monthly or specific-weekday schedules
- **Streaks that skip non-scheduled days** — a Mon/Wed/Fri habit keeps its streak
  over the weekend, and the current period never breaks it until it is genuinely over
- 12-month GitHub-style heatmap, longest streak, completion rate

### Focus and insight

- Pomodoro timer wired to your real task list; completed sessions roll into
  each task's spent time
- Eisenhower priority matrix, derived from due date and priority
- Productivity stats: completions per day, focus minutes, current streak

### Platform

- **PWA** with a hand-written service worker: instant app-shell paint, offline
  fallback, update-on-reload prompt
- **Web Push** reminders (iOS 16.4+ once installed)
- Full dark mode using Apple's separately-tuned dark palette, not an inversion
- Configurable accent colour, week start, timezone, 12/24-hour clock
- Global search, keyboard shortcuts, CSV-free JSON export and ICS export
- Multi-user with per-user data isolation, invite-gated registration, and
  **optional OIDC single sign-on** for any standards-compliant provider
- Admin panel: invites, user management, last-admin protection

---

## Calendar sync

TaskTick speaks **CalDAV**, which means one integration covers iCloud, Google,
Fastmail, Nextcloud, Radicale, Baikal, Synology and anything else RFC-compliant.

| Provider | Server URL | Auth |
|---|---|---|
| iCloud | `https://caldav.icloud.com` | **App-specific password** (see below) |
| Google | `https://apidata.googleusercontent.com/caldav/v2` | App password |
| Fastmail | `https://caldav.fastmail.com` | App password |
| Nextcloud | `https://cloud.example.com/remote.php/dav` | Login password |
| Radicale | `https://radicale.example.com` | Login password |
| Baikal | `https://baikal.example.com/dav.php` | Login password |

> **iCloud requires an app-specific password.** Your Apple ID password will be
> rejected and, worse, may lock the account. Generate one at
> [appleid.apple.com](https://appleid.apple.com) → Sign-In and Security →
> App-Specific Passwords. Two-factor authentication must already be enabled.

### How the sync actually works

Most "sync" features are a copy in one direction with a hope. This one is a
replica protocol:

**Pulling.** Each collection keeps its RFC 6578 `sync-token`, so a routine sync
is a single `REPORT` that returns only what changed — not a full enumeration.
Servers that do not advertise `sync-collection` fall back to a `PROPFIND` +
`calendar-query` diff by ETag. A truncated result set is detected and re-run as
a full enumeration rather than silently losing items.

**Pushing.** Locally edited rows are flagged `dirty`; deletes become
`pending_delete` tombstones. The engine issues `PUT` with `If-Match: <etag>`, so
a write that raced another client fails with `412` instead of clobbering it.
Tombstones are purged after the delete has propagated.

**Conflicts** are only declared when both sides genuinely moved: the row is dirty
*and* the remote ETag differs from the one we last stored. Resolution is
deterministic and auditable:

- The newer side (local `updatedAt` against the remote `LAST-MODIFIED`) wins.
- Within 2 seconds it is treated as a concurrent edit and merged field-wise:
  the local value wins for fields the local side actually touched, the remote
  value fills in what the local side left empty.
- **Every resolution is recorded** in `sync_conflicts` with both snapshots, so
  you can always see exactly what the merge heuristic did on your behalf.

**Safety properties**

- One run per account at a time, enforced by a lock — two runs racing would
  duplicate objects.
- Failures are isolated per calendar: one broken collection cannot abort the run.
- Repeated auth failures back off exponentially (capped at 12 hours) rather than
  hammering the provider. iCloud in particular will lock you out.
- Discovery **never** deletes a local calendar the server stopped advertising.
- Passwords are encrypted at rest with AES-256-GCM, keyed by `BETTER_AUTH_SECRET`
  via HKDF, and are never returned by any API route or written to a log.

### Subscribing from another client

Settings → Subscriptions issues a revocable token URL:

```
https://your-host/api/ical/<token>          # subscribe in any calendar app
webcal://your-host/api/ical/<token>         # tap to add to Apple Calendar
```

Read-only by design, which is the correct model for a subscription.

---

## Configuration

Everything is environment-driven. See [`.env.example`](.env.example) for the
annotated list.

### Required

Nothing. `BETTER_AUTH_SECRET` is generated by the container on first boot and
persisted to the data volume, so it survives restarts and upgrades.

Set it yourself only when migrating an existing deployment, or when running from
source in production. It signs session cookies **and** derives the AES key that
encrypts stored CalDAV passwords, so it must stay stable: losing it signs
everyone out and makes saved calendar credentials unreadable. Back up `/data`
and you have backed up the secret.

```bash
# only if you need to set it explicitly
openssl rand -base64 32
```

The server warns loudly at boot if the secret is one of the placeholder values
published in this repository, or is shorter than 32 characters.

### Common

| Variable | Default | Notes |
|---|---|---|
| `APP_URL` | `http://localhost:3000` | Public origin. Used for OIDC redirect URIs and the `webcal://` links shown in Settings. Optional for reaching the app — a private-network origin is always accepted — but set it so subscription links point at an address your phone can reach. |
| `DATABASE_URL` | `file:/data/tasktick.db` | Or `postgres://user:pass@db:5432/tasktick` |
| `REGISTRATION_MODE` | `invite` | `open` · `invite` · `closed` |
| `SYNC_ENABLED` | `true` | Background CalDAV sync |
| `SYNC_TICK_SECONDS` | `60` | Scheduler resolution; per-account intervals are set in the UI |
| `DEFAULT_TIMEZONE` | `UTC` | Fallback when the browser cannot tell us |
| `CALDAV_ALLOW_INSECURE_TLS` | `false` | Only for self-signed certs on a LAN you control |
| `BETTER_AUTH_TRUSTED_ORIGINS` | *(unset)* | Extra origins allowed to make auth requests. Needed only for a **public** hostname behind a reverse proxy; LAN access is automatic. Comma separated, wildcards supported. |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy you control |

### Single sign-on (optional)

Any OIDC provider — Authentik, Keycloak, Pocket ID, Authelia, Zitadel, Entra ID,
Okta, Google Workspace. Register this redirect URI with your provider:

```
${APP_URL}/api/auth/oauth2/callback/oidc
```

```bash
OIDC_ISSUER=https://auth.example.com/application/o/tasktick/
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_PROVIDER_NAME=Single sign-on
OIDC_ALLOWED_DOMAINS=example.com     # optional allowlist
```

### Web Push (optional)

```bash
npx web-push generate-vapid-keys
```

``bash
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

The public key is handed to the browser through `/api/settings` at request time —
deliberately not through a `NEXT_PUBLIC_*` variable, because those are inlined at
build time and a container configured at runtime would send the browser an empty
key and push would silently stay disabled.

Without these the notification controls disable themselves and explain why,
rather than failing silently.

---

## Deployment

### Docker Compose (recommended)

```bash
docker compose up -d          # SQLite, one container, one volume
docker compose logs -f
```

Upgrades apply themselves: the entrypoint runs pending migrations before the
server starts, and Drizzle records what it has applied, so starting the container
is always safe.

**With Postgres:**

```bash
docker compose -f docker-compose.yml -f docker-compose.postgres.yml up -d
```

**Backups.** Everything lives in the `tasktick-data` volume.

```bash
# SQLite — safe while running, because WAL mode is enabled.
docker compose exec tasktick sh -c 'sqlite3 /data/tasktick.db ".backup /data/backup.db"'
docker compose cp tasktick:/data/backup.db ./tasktick-$(date +%F).db

# Postgres
docker compose exec db pg_dump -U tasktick tasktick | gzip > tasktick-$(date +%F).sql.gz
```

Also available: **Settings → Data → Export** for a complete JSON dump (tasks,
habits, completion history — everything) or an ICS export.

### HTTPS is required

Not optional, and not just for security:

- **Web Push** does not work on iOS without HTTPS.
- **PWA installation** and the service worker require a secure context.
- OIDC redirect URIs must be HTTPS in practice.

Put TaskTick behind the reverse proxy you already run. With Caddy it is two lines:

```caddy
tasks.example.com {
    reverse_proxy localhost:3000
}
```

Then set `APP_URL=https://tasks.example.com` and `TRUST_PROXY=true`.

### Image

Published to GHCR for `linux/amd64` and `linux/arm64` on every push to `main`,
on every `v*` tag, and on manual dispatch:

```
ghcr.io/ksmarty/tasktick:latest
ghcr.io/ksmarty/tasktick:1.2.3
ghcr.io/ksmarty/tasktick:sha-abc1234
```

The image runs as a non-root user, carries no build toolchain, exposes
`/healthz`, and writes only to `/data` and `/tmp`.

---

## Development

```bash
npm install
cp .env.example .env            # a dev secret is generated automatically
npm run db:migrate              # create data/tasktick.db
npm run db:seed                 # optional: demo account and realistic data
npm run dev
```

The seed prints the credentials it creates. Default: `demo@tasktick.local` /
`tasktick-demo-1234`.

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run build` | Production build (standalone output) |
| `npm run typecheck` | `tsc --noEmit` across the whole repo |
| `npm test` | Vitest |
| `npm run db:generate` | Generate SQLite migrations from the schema |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed a demo instance |
| `npm run icons` | Regenerate PWA icons and iOS splash screens |

### Architecture

```
src/
  app/
    (auth)/            login, register
    (app)/             today, tasks, calendar, habits, matrix, pomodoro, settings, search
    api/               39 route handlers, one file per resource
  components/
    ui/                the iOS component kit — no business logic
    app/               shell: sidebar, tab bar, safe-area frame
    tasks/ calendar/ habits/ settings/ pwa/ auth/
  lib/                 framework-free: types, dates, nlp, rrule, fractional, store, api-client
  server/
    db/                schema (SQLite + Postgres mirror), connection
    repos/             the only code that touches tables
    caldav/            transport: HTTP, WebDAV XML, iCalendar codec
    sync/              policy: pull, push, conflict resolution, scheduler
    services/          calendar aggregation, ICS feed, instance state
```

Three boundaries are load-bearing:

**Contracts are frozen and tested, not assumed.** `src/server/caldav/types.ts`
is the seam between the CalDAV transport and the sync policy, so the merge
heuristics can be tested against an in-memory fake with no network. The Postgres
schema is a mechanical mirror of the SQLite one, and
`tests/schema-parity.test.ts` fails the build if any table, column or JS type
drifts between them.

**Recurrence expands in exactly one place.** `src/server/caldav/ical.ts` is the
only implementation of RRULE, EXDATE, DST and timezone maths; the calendar API
returns already-expanded occurrences and already-computed overlap columns. The
client never ships a calendar engine, so there is no second answer to "when is
the next occurrence".

**The database is not the API.** Repositories return domain types from
`src/lib/types.ts`, and components consume wire types from `src/lib/view-types.ts`.
A column rename cannot silently change a component's props.

### Testing

542 tests across 32 files, with no network and no external services:

```bash
npm test
```

The CalDAV client is tested against an injected fake `fetch` — including an
iCloud-style discovery redirect, a delta sync with tombstones, and a `412`
precondition failure. The sync engine runs against a real temporary SQLite file
and a fake CalDAV server, covering conflict resolution and tombstone propagation.
The iCalendar codec round-trips timed, all-day, recurring and VTODO objects.

Beyond unit tests there are two end-to-end harnesses that run against a live
instance. They are what actually prove the pieces fit together:

```bash
npm run build && npm start          # in one shell
npm run smoke                       # in another
```

`scripts/smoke/api.mjs` walks 94 checks over the real HTTP surface with a real
session cookie: registration and the admin bootstrap, the first-run redirect,
task CRUD, **recurring-task roll-forward**, subtask parenting, filtering and
text search, reordering, bulk actions, habit check-ins and clearing, event
creation, server-side recurrence expansion of the calendar feed, overlap layout,
focus sessions, stats, settings validation, the ICS subscription lifecycle
including revocation, CalDAV account create/discover/sync/delete against an
unreachable host, export, invites, last-admin protection, tenant isolation,
signed-out refusals, and sign-out invalidation.

`scripts/smoke/pages.mjs` asserts all 13 routes server-render and that signed-out
access redirects.

`scripts/smoke/origins.mjs` is the regression guard for the auth origin policy:
23 cases covering LAN IPs, RFC1918 boundaries, CGNAT (Tailscale), IPv6 ULA and
link-local, `.local`, bare hostnames, and the two that matter most — a public
attacker origin that must still be refused, and `192.168.1.50.evil.com`, a public
hostname shaped like a private one. A fix that broke CSRF protection would fail
this suite just as loudly as one that broke LAN access.

```bash
npm run smoke:origins
```

> It creates accounts, so point it at a throwaway instance, or at one running
> with `REGISTRATION_MODE=open`.

Run them after any release. Several real bugs were caught this way and not by the
unit suite — including a recurring task that silently refused to advance.

A few tests encode non-obvious invariants and are worth reading before changing
the modules they cover:

- `tests/lib-core.test.ts` — ordering keys must compare identically under
  JavaScript, SQLite's BINARY collation and Postgres's locale collation. This is
  why the key alphabet is lowercase base-36 and `compareKeys` does not use
  `localeCompare`.
- `tests/lib-nlp.test.ts` — quick-add must never silently drop text it did not
  understand, and `\b` does not fire between a space and `!`.
- `tests/sync-merge.test.ts` — the exact conflict window and merge precedence.
- `tests/schema-parity.test.ts` — the SQLite/Postgres mirror invariant.

---

## Troubleshooting

**"Invalid origin" when signing in or registering.**

Fixed in 0.1.1 — a private-network origin is now accepted automatically, so
browsing to a LAN IP, a NAS hostname or a Tailscale name just works. If you are
behind a reverse proxy on a **public** hostname, that origin is not private, so
name it explicitly:

```bash
BETTER_AUTH_TRUSTED_ORIGINS=https://tasks.example.com
```

**Subscription links point at `localhost`.** Set `APP_URL` to the address you
actually browse to. This is the one thing `APP_URL` is genuinely needed for when
you are on a LAN.

**Forgot the generated signing secret.** It lives in the data volume:

```bash
docker compose exec tasktick cat /data/.better-auth-secret
```

**Notifications never arrive.** Web Push needs HTTPS and, on iOS, the app must be
installed to the Home Screen first. The settings screen states which precondition
is unmet rather than failing silently.

---

## Security

- Passwords hashed by **better-auth** (scrypt). No hand-rolled crypto anywhere.
- The signing secret is **generated per instance** on first boot, never shipped as
  a default. Container logs deliberately do not print it.
- CalDAV credentials sealed with **AES-256-GCM**, key derived via HKDF from
  `BETTER_AUTH_SECRET` with a distinct info string, so the encryption key and the
  session-signing key are independent.
- Session cookie is httpOnly, SameSite=Lax, `Secure` whenever `APP_URL` is HTTPS.
- Every repository query is scoped by `user_id`; cross-tenant reads are not
  reachable through the API surface.
- API responses are `Cache-Control: no-store, private` and are explicitly never
  cached by the service worker.
- ICS feed tokens are compared in constant time, are revocable, and carry
  `X-Robots-Tag: noindex`.
- Server internals are never returned to a client; unexpected errors are logged
  and replaced with a generic message.

Found a vulnerability? Please open a private security advisory rather than a
public issue.

---

## License

AGPL-3.0-or-later. Self-host it, modify it, share it — just keep it open.
