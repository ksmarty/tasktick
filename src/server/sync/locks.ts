/**
 * Run exclusivity for CalDAV sync.
 *
 * A single Next.js server process can host several accounts, and the scheduler
 * tick, the instrumentation hook and a manual "sync now" route can all fire at
 * the same time. Two overlapping runs against one account would fight over
 * ETags and could insert duplicate objects, so:
 *
 *  - **per account**: a second call while a run is in flight returns the *same*
 *    promise instead of starting another run ({@link runSyncExclusive});
 *  - **process-wide**: runs are serialised, so two accounts never hit the
 *    provider concurrently. Providers rate-limit aggressively (iCloud locks an
 *    account out), and a serialised sweep is far easier to reason about.
 *
 * Nothing here holds a lock across an await in a way that could deadlock: the
 * chain always resolves, even when a run rejects.
 */
import type { SyncResult } from '@/lib/types';

const inFlight = new Map<string, Promise<SyncResult>>();
let tail: Promise<unknown> = Promise.resolve();

function noop(): void {
  /* keeps the serialisation chain alive after a rejected run */
}

/** The in-flight run for `accountId`, or null — the scheduler uses this to skip. */
export function inFlightRun(accountId: string): Promise<SyncResult> | null {
  return inFlight.get(accountId) ?? null;
}

export function isAccountInFlight(accountId: string): boolean {
  return inFlight.has(accountId);
}

/** Test seam: forgets in-flight runs and resets the serialisation chain. */
export function resetSyncLocks(): void {
  inFlight.clear();
  tail = Promise.resolve();
}

/** Queues `run` behind every run already started, without de-duplicating. */
export function queueGlobal<T>(run: () => Promise<T>): Promise<T> {
  const chained = tail.then(run, run);
  tail = chained.then(noop, noop);
  return chained;
}

/**
 * Runs `run` for `accountId`, or returns the promise of the run already in
 * flight for that account. The map entry is registered synchronously, so even a
 * queued-behind-another-account run counts as "in flight" and the scheduler
 * will not start a second one.
 */
export function runSyncExclusive(accountId: string, run: () => Promise<SyncResult>): Promise<SyncResult> {
  const existing = inFlight.get(accountId);
  if (existing) return existing;

  const queued = queueGlobal(run);
  const guarded = queued.finally(() => {
    if (inFlight.get(accountId) === guarded) inFlight.delete(accountId);
  });
  inFlight.set(accountId, guarded);
  return guarded;
}
