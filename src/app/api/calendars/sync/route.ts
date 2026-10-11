/**
 * Refresh every remote calendar now.
 *
 * The button behind this lives in the tasks header, which is where a user
 * notices that something they just added elsewhere has not arrived. It is a
 * `POST` even though it reads: it changes `lastSyncedAtMs`, mirrors remote rows
 * and can push local edits, so it is not cacheable and must never be replayed
 * from the offline queue (see `NEVER_QUEUEABLE` in `@/lib/offline-rules`).
 *
 * A static `sync` segment outranks `[id]`, so this does not shadow
 * `GET /api/calendars/[id]`.
 */
import { ok, route } from '@/server/http';
import { refreshAllCalendars } from '@/server/services/calendar-refresh';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = route(async ({ user }) => ok(await refreshAllCalendars(user.id)));
