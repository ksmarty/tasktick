#!/bin/sh
#
# TaskTick container entrypoint.
#
# Responsibilities, in order:
#   1. ensure BETTER_AUTH_SECRET exists, generating and persisting one if not;
#   2. apply pending migrations (retrying, so a slowly-starting Postgres is fine);
#   3. exec the server so it becomes PID 1 and receives SIGTERM/SIGINT directly.
#
# Any other command (e.g. `docker run -it tasktick sh`) is exec'd verbatim with
# no migrations, so the image stays usable as a normal container.
#
# The image carries no `tsx`, so migrations run through the CommonJS build the
# Dockerfile emits at /app/scripts/migrate.cjs (source: scripts/migrate.ts).
#
# `set -eu` only. POSIX sh has no `pipefail` and dash rejects it outright; busybox
# ash happens to accept it, which means it would work on Alpine and fail
# anywhere else. This script contains no pipelines, so it buys nothing either way.
set -eu

MIGRATE_SCRIPT="${MIGRATE_SCRIPT:-/app/scripts/migrate.cjs}"
# Postgres can still be booting even behind the compose healthcheck, so retry
# for roughly a minute before giving up: 30 attempts x 2s.
MIGRATE_MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-30}"
MIGRATE_SLEEP_SECONDS="${MIGRATE_SLEEP_SECONDS:-2}"

# Lives beside the SQLite file, inside the named volume, so it survives upgrades
# and container recreation.
SECRET_FILE="${SECRET_FILE:-/data/.better-auth-secret}"

is_app_command() {
  if [ "$#" -eq 0 ]; then
    return 0
  fi
  if [ "$1" != "node" ]; then
    return 1
  fi
  if [ "$#" -eq 1 ]; then
    return 0
  fi
  case "$2" in
    server.js | ./server.js | /app/server.js) return 0 ;;
  esac
  return 1
}

# BETTER_AUTH_SECRET signs session cookies and derives the AES key protecting
# stored CalDAV passwords. It must therefore be stable across restarts: losing it
# signs everyone out and makes saved calendar credentials undecryptable.
#
# Generating it here is what lets `docker compose up -d` work with no .env file
# at all. A value supplied by the environment always wins, so existing
# deployments are unaffected.
ensure_secret() {
  if [ -n "${BETTER_AUTH_SECRET:-}" ]; then
    return 0
  fi

  if [ -f "$SECRET_FILE" ] && [ -s "$SECRET_FILE" ]; then
    BETTER_AUTH_SECRET="$(cat "$SECRET_FILE")"
    export BETTER_AUTH_SECRET
    return 0
  fi

  # `node` is guaranteed present in this image, so there is no dependency on
  # openssl or on busybox having a particular applet.
  BETTER_AUTH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64"))')"

  mkdir -p "$(dirname "$SECRET_FILE")"
  # umask 077 so the file is owner-only from the moment it is created.
  ( umask 077; printf '%s' "$BETTER_AUTH_SECRET" > "$SECRET_FILE" )

  export BETTER_AUTH_SECRET

  # The secret itself is deliberately NOT logged: container logs are often
  # shipped somewhere less protected than the data volume.
  echo "[entrypoint] generated a new BETTER_AUTH_SECRET -> ${SECRET_FILE}"
  echo "[entrypoint] back this up with the rest of /data. Losing it invalidates"
  echo "[entrypoint] sessions and makes stored CalDAV passwords unreadable."
  echo "[entrypoint] to read it:  docker compose exec tasktick cat ${SECRET_FILE}"
}

run_migrations() {
  attempt=1
  while true; do
    if node "$MIGRATE_SCRIPT"; then
      return 0
    fi
    if [ "$attempt" -ge "$MIGRATE_MAX_ATTEMPTS" ]; then
      echo "[entrypoint] migrations failed after ${MIGRATE_MAX_ATTEMPTS} attempts, aborting" >&2
      return 1
    fi
    echo "[entrypoint] migration attempt ${attempt} failed, retrying in ${MIGRATE_SLEEP_SECONDS}s" >&2
    attempt=$((attempt + 1))
    sleep "$MIGRATE_SLEEP_SECONDS"
  done
}

if is_app_command "$@"; then
  ensure_secret

  run_migrations

  if [ "$#" -eq 0 ]; then
    set -- node server.js
  fi

  echo "[entrypoint] starting: $*"
  exec "$@"
fi

exec "$@"
