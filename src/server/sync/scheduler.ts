/**
 * In-process sync scheduler.
 *
 * The engine runs inside the Next.js server process, so "background sync" is a
 * timer plus a due check — no worker, no queue:
 *
 *  - {@link startSyncScheduler} installs one unref'd interval (the timer never
 *    keeps the process alive, and calling it twice cannot create two timers,
 *    which matters because both an instrumentation hook and a route call it);
 *  - every tick runs {@link syncAllDueAccounts}, which skips accounts whose
 *    previous run has not finished and accounts that are not due yet;
 *  - accounts that keep failing are backed off exponentially — iCloud locks an
 *    account out when hammered, so a broken account must not be retried every
 *    tick.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { getEnv } from '@/lib/env';
import type { SyncResult } from '@/lib/types';
import { caldavAccounts } from '@/server/db/schema';
import { describeError, openSyncDb, syncAccount, zeroCounters } from './engine';
import { isAccountInFlight } from './locks';
import { syncDueIcalSubscriptions } from '@/server/services/ical-subscription';

/** Consecutive failures after which the interval starts doubling. */
export const FAILURE_BACKOFF_THRESHOLD = 3;

/** Backoff ceiling: never wait longer than 12 hours between attempts. */
export const MAX_BACKOFF_MS = 12 * 60 * 60 * 1000;

export interface AccountScheduleState {
  lastSyncAtMs: number | null;
  syncIntervalMinutes: number;
  consecutiveFailures: number;
}

/**
 * `syncIntervalMinutes`, doubled once per consecutive failure past the
 * threshold and capped at {@link MAX_BACKOFF_MS}. Backoff never shortens the
 * configured interval.
 */
export function effectiveIntervalMs(syncIntervalMinutes: number, consecutiveFailures: number): number {
  const base = Math.max(1, syncIntervalMinutes) * 60_000;
  if (consecutiveFailures < FAILURE_BACKOFF_THRESHOLD) return base;
  const doublings = Math.min(consecutiveFailures - (FAILURE_BACKOFF_THRESHOLD - 1), 16);
  return Math.max(base, Math.min(base * 2 ** doublings, MAX_BACKOFF_MS));
}

/** An account that has never synced is always due; otherwise its interval decides. */
export function isAccountDue(state: AccountScheduleState, now: number): boolean {
  if (state.lastSyncAtMs === null) return true;
  return now - state.lastSyncAtMs >= effectiveIntervalMs(state.syncIntervalMinutes, state.consecutiveFailures);
}

/**
 * Runs every account that is due, one after another. Accounts that are in
 * flight or not due are left alone; a failing account never aborts the sweep —
 * its error is captured in a `SyncResult` instead.
 *
 * Returns one result per account *run*: skipped accounts are not represented.
 */
export async function syncAllDueAccounts(now: number = Date.now()): Promise<SyncResult[]> {
  const db = await openSyncDb();
  const due = await db
    .select()
    .from(caldavAccounts)
    .where(and(eq(caldavAccounts.enabled, true), isNull(caldavAccounts.deletedAtMs)));

  const results: SyncResult[] = [];
  for (const account of due) {
    if (isAccountInFlight(account.id)) continue; // the previous run has not finished
    if (!isAccountDue(account, now)) continue;
    const kind = account.lastSyncAtMs === null ? 'full' : 'incremental';
    try {
      results.push(await syncAccount(account.id, { kind, trigger: 'scheduled' }));
    } catch (error) {
      // `syncAccount` does not throw for expected failures; this guards the
      // unexpected ones so one account can never abort the sweep.
      results.push({ kind, status: 'error', ...zeroCounters(), error: describeError(error) });
    }
  }
  return results;
}

let ticking = false;

/**
 * One scheduler tick. Re-entrancy is refused rather than queued: a tick that
 * overruns the interval means the provider is slow, and stacking ticks would
 * only add pressure.
 */
export async function runSchedulerTick(now: number = Date.now()): Promise<SyncResult[]> {
  if (ticking) return [];
  ticking = true;
  try {
    /*
     * Calendar subscriptions ride the same ticker as CalDAV.
     *
     * They are a different kind of sync — one-way and read-only — but they want
     * the same thing from a scheduler: run periodically, back off when the
     * remote is down, and never block anything else. Giving them a second timer
     * would mean two unref'd intervals and two sets of failure semantics to keep
     * in step.
     *
     * Failures are swallowed here on purpose. A feed that is unreachable records
     * the error on its own calendar row, which is what the settings screen
     * shows; letting it throw would take the CalDAV tick down with it over a
     * URL somebody else typed.
     */
    try {
      await syncDueIcalSubscriptions(now);
    } catch (error) {
      console.error(`[ical] subscription refresh failed: ${describeError(error)}`);
    }
    return await syncAllDueAccounts(now);
  } finally {
    ticking = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function isSyncSchedulerRunning(): boolean {
  return timer !== null;
}

/**
 * Starts the ticker. Idempotent, and a no-op when `SYNC_ENABLED` is false.
 * The interval is unref'd so it never blocks process shutdown.
 */
export function startSyncScheduler(): void {
  if (timer !== null) return;
  if (!getEnv().SYNC_ENABLED) return;

  const tickMs = Math.max(5, getEnv().SYNC_TICK_SECONDS) * 1000;
  const handle = setInterval(() => {
    void runSchedulerTick().catch((error: unknown) => {
      console.error(`[sync] scheduler tick failed: ${describeError(error)}`);
    });
  }, tickMs);
  handle.unref();
  timer = handle;
}

/** Stops the ticker. Idempotent. */
export function stopSyncScheduler(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}
