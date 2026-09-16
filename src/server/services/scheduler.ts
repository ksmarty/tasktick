/**
 * Lazy start-up for the background CalDAV scheduler.
 *
 * Importing `@/server/sync` pulls in the whole CalDAV transport: the iCalendar
 * codec, Luxon, the WebDAV XML parser and the merge engine. That is ~7 MB of
 * resident memory, and a fresh install — or any instance that has never
 * connected a calendar — pays for it on every boot while having nothing to sync.
 *
 * So the scheduler is started through this module instead: it answers the cheap
 * question ("is there an enabled account?") using only the database handle, and
 * imports the sync stack only when the answer is yes.
 *
 * The consequence to be careful about: adding the FIRST account must start the
 * scheduler without a restart, which is why `POST /api/caldav/accounts` calls
 * this too. Missing that would mean sync silently never begins until the next
 * container restart, which is exactly the kind of bug that looks like "sync is
 * broken" weeks later.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { caldavAccounts } from '../db/schema';
import { getEnv } from '@/lib/env';

let started = false;

/** True when at least one CalDAV account is enabled and not soft-deleted. */
export async function hasSyncableAccount(): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: caldavAccounts.id })
    .from(caldavAccounts)
    .where(and(eq(caldavAccounts.enabled, true), isNull(caldavAccounts.deletedAtMs)))
    .limit(1);
  return Boolean(row);
}

/**
 * Starts the background scheduler if there is anything to sync.
 *
 * Safe to call repeatedly and from several places: the underlying scheduler is
 * idempotent, and the local flag short-circuits the import once it has run.
 */
export async function ensureSyncScheduler(): Promise<void> {
  if (started) return;
  if (!getEnv().SYNC_ENABLED) return;

  // Cheap check first — no CalDAV code is loaded to perform it.
  if (!(await hasSyncableAccount())) return;

  const { startSyncScheduler } = await import('../sync');
  startSyncScheduler();
  started = true;
  console.log('[startup] CalDAV sync scheduler running');
}

/** Test seam. */
export function resetSchedulerBootstrap(): void {
  started = false;
}
