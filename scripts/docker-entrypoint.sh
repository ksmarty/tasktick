#!/bin/sh
#
# TaskTick container entrypoint.
#
# The image carries no `tsx`, so migrations run through the CommonJS build the
# Dockerfile emits at /app/scripts/migrate.cjs (source: scripts/migrate.ts).
#
# Behaviour:
#   * `node server.js` (the image CMD) or no command at all -> apply pending
#     migrations first, then exec the server so it becomes PID 1 and receives
#     SIGTERM/SIGINT directly;
#   * any other command (e.g. `docker run -it tasktick sh`, or a one-off
#     `node scripts/...`) -> exec'd verbatim, no migrations.
#
# Alpine's /bin/sh is busybox ash, which supports `pipefail`.
set -euo pipefail

MIGRATE_SCRIPT="${MIGRATE_SCRIPT:-/app/scripts/migrate.cjs}"
# Postgres can still be booting even behind the compose healthcheck, so retry
# for roughly a minute before giving up: 30 attempts x 2s.
MIGRATE_MAX_ATTEMPTS="${MIGRATE_MAX_ATTEMPTS:-30}"
MIGRATE_SLEEP_SECONDS="${MIGRATE_SLEEP_SECONDS:-2}"

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
  if [ -z "${BETTER_AUTH_SECRET:-}" ]; then
    echo "[entrypoint] WARNING: BETTER_AUTH_SECRET is not set; production refuses to boot without it." >&2
  fi

  run_migrations

  if [ "$#" -eq 0 ]; then
    set -- node server.js
  fi

  echo "[entrypoint] starting: $*"
  exec "$@"
fi

exec "$@"
