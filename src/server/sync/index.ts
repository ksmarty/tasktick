/**
 * Public surface of the CalDAV sync policy layer.
 *
 * Everything the rest of the app (routes, instrumentation hook) is allowed to
 * call lives here, and the signatures are pinned deliberately: they are the
 * contract other agents' code compiles against. Implementation is split by
 * concern — `engine.ts` owns a single account's run, `scheduler.ts` decides
 * *when* accounts run, `merge.ts` holds the pure conflict policy, `mapper.ts`
 * converts wire <-> row, `locks.ts` guarantees one run per account.
 */
import type { SyncResult } from '@/lib/types';
import {
  discoverAccountCalendars as discover,
  purgeExpiredTombstones as purge,
  syncAccount as runSyncAccount,
} from './engine';
import type { SyncRunOptions } from './engine';
import {
  runSchedulerTick as tick,
  startSyncScheduler as startScheduler,
  stopSyncScheduler as stopScheduler,
  syncAllDueAccounts as syncDue,
} from './scheduler';

/* Implementation types, error helper and test seams. */
export type { CalDavClientFactory, Counters, SyncRunOptions } from './engine';
export type { AccountScheduleState } from './scheduler';
export { describeError, setCalDavClientFactory, zeroCounters } from './engine';
export { isAccountInFlight, resetSyncLocks } from './locks';
export {
  FAILURE_BACKOFF_THRESHOLD,
  MAX_BACKOFF_MS,
  effectiveIntervalMs,
  isAccountDue,
  isSyncSchedulerRunning,
} from './scheduler';
export { CONCURRENT_EDIT_WINDOW_MS, resolveConflict } from './merge';

/**
 * Syncs one account: pull the collections, then push the rows the user changed
 * locally. Concurrent calls for the same account share a single run.
 */
export async function syncAccount(accountId: string, opts?: SyncRunOptions): Promise<SyncResult> {
  return runSyncAccount(accountId, opts ?? {});
}

/**
 * Sweeps every account that is due, in sequence, isolating per-account failures.
 * `now` is injectable so the scheduler's due-ness rules stay testable.
 */
export async function syncAllDueAccounts(now?: number): Promise<SyncResult[]> {
  return syncDue(now ?? Date.now());
}

/**
 * Discovers the account's remote collections and mirrors their metadata. Never
 * deletes a local calendar that the server stopped advertising.
 */
export async function discoverAccountCalendars(accountId: string): Promise<SyncResult> {
  return discover(accountId);
}

/** Installs the unref'd sync ticker. Idempotent and safe to call from a route. */
export function startSyncScheduler(): void {
  startScheduler();
}

/** Removes the sync ticker. Idempotent. */
export function stopSyncScheduler(): void {
  stopScheduler();
}

/**
 * Reclaims tombstones whose deletion has already propagated (default: older
 * than 30 days) and expired `sync_logs`.
 */
export async function purgeExpiredTombstones(olderThanMs?: number): Promise<number> {
  return purge(olderThanMs);
}

/** Runs exactly one scheduler tick (the interval itself is time-based). */
export async function runSchedulerTick(now?: number): Promise<SyncResult[]> {
  return tick(now ?? Date.now());
}
