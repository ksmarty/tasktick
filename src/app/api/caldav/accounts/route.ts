/** CalDAV accounts: list and create. */
import { ok, parseJson, route } from '@/server/http';
import { createAccount, listAccounts } from '@/server/repos/calendars';
import { ensureSyncScheduler } from '@/server/services/scheduler';
import { createAccountSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => ok(await listAccounts(user.id)));

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createAccountSchema);
  const account = await createAccount(user.id, body);

  // The scheduler only loads the CalDAV stack when an enabled account exists, so
  // adding the FIRST one has to start it — otherwise sync would silently not run
  // until the next restart, which reads as "sync is broken" much later.
  // Idempotent, and a no-op once it is already running.
  try {
    await ensureSyncScheduler();
  } catch (error) {
    console.warn('[caldav] could not start the sync scheduler:', error);
  }

  return ok(account, 201);
});
