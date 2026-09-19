/**
 * The offline mutation queue.
 *
 * A write that cannot reach the server is not an error any more — it is work
 * that has already happened as far as the user is concerned, and it is held here
 * until the connection comes back.
 *
 * ## Where it lives
 *
 * IndexedDB (`tasktick-offline` / `mutations`), one record per write, plus a
 * `meta` key for the sequence counter. The service worker deliberately keeps no
 * queue of its own: iOS reclaims workers without warning, and a write that only
 * exists inside a worker is a write that can vanish. The page owns the queue and
 * the worker owns the read cache; the page survives a reload with its writes
 * intact, the worker survives because it can always be respawned from disk.
 *
 * ## The rules
 *
 * **Order.** Entries replay strictly in the order they were made, one at a time,
 * by a monotonic `seq` persisted with the entries. Serial replay is not a
 * performance decision — it is what stops a create and a patch to the thing it
 * created from arriving in the wrong order. A write that must be retried blocks
 * the writes behind it; that is the honest behaviour, because they may depend on
 * it.
 *
 * **De-duplication.** Two mechanisms:
 *   1. An identical write (same method, path and body) already queued is not
 *      queued twice — a double tap while offline produces one entry.
 *   2. Before dispatching, an entry is claimed by a *lease* written to disk. A
 *      second tab, or a re-entrant pump, skips anything under a live lease, so
 *      the same entry is never on the wire twice at once. The lease expires
 *      (`LEASE_MS`), which is what lets a write abandoned by a killed tab be
 *      retried instead of being stuck forever.
 *
 * Every dispatch also carries `X-Idempotency-Key: <entry id>`, the same value for
 * every attempt of that entry. A server that honours it collapses the one
 * remaining window — the crash between "the server applied this" and "the client
 * recorded the success" — into a single effect.
 *
 * **Failure classification.** `classifyStatus` is the single rule:
 *   - 2xx                 -> done, remove the entry.
 *   - 401                 -> the session is gone. The queue PAUSES and keeps
 *                            everything; signing back in resumes it.
 *   - 0 / 408 / 429 / 5xx -> retryable. Keep, back off, try again later.
 *   - every other 4xx     -> not retryable. The request was wrong, and sending it
 *                            again will be wrong again, so it is removed and
 *                            reported to the user instead of being retried
 *                            forever behind their back.
 *
 * **Temporary ids.** An offline `POST /api/tasks` has no server id yet, so the
 * optimistic entity gets `temp:<entry id>`. Later writes reference that id (a
 * subtask's `parentId`, a task's `listId`). When the create finally lands, the
 * server's real id is mapped onto every pending entry — path and body — before
 * anything else is sent, so the chain replays correctly.
 */
import { ApiClientError, sendNow } from './api-client';
import { META_STORE, MUTATION_STORE, idbClear, idbDelete, idbGet, idbGetAll, idbPut, hasIndexedDb, isOfflineDbUsable } from './offline-db';
import {
  affectsFor,
  classifyStatus,
  createdId,
  isQueueable,
  isSameWrite,
  matchesPrefix,
  orderQueue,
  queuedResult,
  readyForReplay,
  retryDelayMs,
  rewriteEntryTempIds,
  type QueueMethod,
} from './offline-rules';

export * from './offline-rules';

export interface QueuedMutation {
  /** Stable identity: the de-duplication key and the idempotency key. */
  id: string;
  /** Monotonic insertion order; replay order is this, ascending. */
  seq: number;
  method: QueueMethod;
  /** Path including any query string. */
  path: string;
  body?: unknown;
  createdAt: number;
  /** Retryable failures so far. */
  attempts: number;
  /** Epoch ms before which this entry must not be attempted again. */
  nextAttemptAt: number;
  /** Read-cache prefixes to invalidate once this write lands. */
  affects: string[];
  /** The synthetic id handed to the UI for a create, if any. */
  tempId?: string;
  /** While in the future, another tab (or a dead one) owns this entry. */
  leaseUntil?: number;
}

export interface QueueFailure {
  id: string;
  method: QueueMethod;
  path: string;
  status: number;
  message: string;
  at: number;
}

export interface QueueSnapshot {
  entries: readonly QueuedMutation[];
  failures: readonly QueueFailure[];
  /** True while the queue is waiting for the session to be restored. */
  authPaused: boolean;
  /** Whether IndexedDB accepted the database; false means memory-only. */
  durable: boolean;
  syncing: boolean;
}

export type QueueEvent =
  | { type: 'queued'; entry: QueuedMutation }
  | { type: 'changed' }
  | { type: 'flushed'; affects: string[]; synced: number; failed: number }
  | { type: 'failed'; entry: QueuedMutation; status: number; message: string }
  | { type: 'auth' };

/** Failures kept for the banner. */
const MAX_FAILURES = 5;

const SEQ_META_KEY = 'mutation-seq';
const LEASE_MS = 30_000;

export interface FlushReport {
  synced: number;
  failed: number;
  retried: number;
  /** True when the pass did not run at all (offline, paused, nothing to do). */
  skipped: boolean;
}

/* -------------------------------------------------------------------------- */
/* state                                                                      */
/* -------------------------------------------------------------------------- */

let entries: QueuedMutation[] = [];
let failures: QueueFailure[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
let seq = 0;
let authPaused = false;
let syncing = false;
let pumping: Promise<FlushReport> | null = null;
let pumpStarted = false;
let timer: ReturnType<typeof setInterval> | null = null;

const listeners = new Set<(event: QueueEvent) => void>();

function emit(event: QueueEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[offline] queue listener failed', error);
    }
  }
}

export function subscribeQueue(listener: (event: QueueEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function queueSnapshot(): QueueSnapshot {
  return { entries: [...entries], failures: [...failures], authPaused, durable: isOfflineDbUsable(), syncing };
}

export function pendingCount(): number {
  return entries.length;
}

export function hasPending(): boolean {
  return entries.length > 0;
}

/** True when a pending write will invalidate the read held under `key`. */
export function pendingAffects(key: string): boolean {
  return entries.some((entry) => entry.affects.some((prefix) => matchesPrefix(key, prefix)));
}

export function pendingWrites(): readonly QueuedMutation[] {
  return entries;
}

/**
 * True while the queue exists and can be trusted to hold a write.
 *
 * This is what lets the app promise "your change is kept" while offline; when
 * IndexedDB is unavailable (private browsing, storage denied) the promise cannot
 * be made and the app falls back to refusing the write instead of losing it.
 */
export function isQueueUsable(): boolean {
  return isOfflineDbUsable();
}

/* -------------------------------------------------------------------------- */
/* persistence                                                                */
/* -------------------------------------------------------------------------- */

async function loadQueue(): Promise<void> {
  if (loaded) return;
  if (loading) return loading;

  loading = (async () => {
    const [stored, storedSeq] = await Promise.all([
      idbGetAll<QueuedMutation>(MUTATION_STORE),
      idbGet<{ key: string; value: number }>(META_STORE, SEQ_META_KEY),
    ]);

    const valid = stored.filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.path === 'string' &&
        typeof entry.seq === 'number' &&
        ['POST', 'PATCH', 'PUT', 'DELETE'].includes(entry.method),
    );

    entries = valid.map((entry) => ({
      ...entry,
      affects: Array.isArray(entry.affects) && entry.affects.length > 0 ? entry.affects : affectsFor(entry.method, entry.path),
      attempts: Number.isFinite(entry.attempts) ? entry.attempts : 0,
      nextAttemptAt: Number.isFinite(entry.nextAttemptAt) ? entry.nextAttemptAt : 0,
    }));

    const persistedSeq = typeof storedSeq?.value === 'number' ? storedSeq.value : 0;
    seq = Math.max(persistedSeq, ...entries.map((entry) => entry.seq), 0);
    loaded = true;
  })().finally(() => {
    loading = null;
  });

  return loading;
}

/** Loads the queue from disk (once) so callers can read `pendingCount()`. */
export function whenQueueReady(): Promise<void> {
  return loadQueue();
}

function replaceEntry(next: QueuedMutation): void {
  const index = entries.findIndex((entry) => entry.id === next.id);
  entries = index === -1 ? [...entries, next] : entries.map((entry) => (entry.id === next.id ? next : entry));
}

function removeEntry(id: string): void {
  entries = entries.filter((entry) => entry.id !== id);
}

function newId(): string {
  const cryptoRef = globalThis.crypto as Crypto | undefined;
  if (cryptoRef && typeof cryptoRef.randomUUID === 'function') return cryptoRef.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Records a write for later replay and returns its entry plus the value its
 * caller should receive now.
 *
 * An identical write already waiting in the queue is returned instead of being
 * added again: a double tap on a slow connection must not complete a task twice.
 */
export async function enqueueWrite(input: {
  method: QueueMethod;
  path: string;
  body?: unknown;
}): Promise<{ entry: QueuedMutation; result: unknown; deduplicated: boolean }> {
  await loadQueue();

  /*
   * A queue that cannot persist is not a queue.
   *
   * Every promise the app makes about offline writes — "kept on this device",
   * "will sync when you reconnect" — rests on the entry being on disk before the
   * caller is told it was accepted. When IndexedDB exists but refused to open
   * (private browsing, storage denied, quota), holding the entry in memory would
   * make the app lie and lose the work on the next reload. The caller gets the
   * original network error instead, which is the honest answer. The exception is
   * an environment with no IndexedDB at all (server rendering, the test runner),
   * where the in-memory queue is the only thing there is.
   */
  if (hasIndexedDb() && !isOfflineDbUsable()) {
    throw new Error('Offline storage is unavailable, so the change could not be held.');
  }

  const candidate = { method: input.method, path: input.path, body: input.body };
  const existing = entries.find((entry) => isSameWrite(entry, candidate));
  if (existing) {
    return {
      entry: existing,
      result: queuedResult(existing.method, existing.path, existing.body, existing.tempId),
      deduplicated: true,
    };
  }

  seq += 1;
  const id = newId();
  const tempId = input.method === 'POST' ? `temp:${id}` : undefined;
  const entry: QueuedMutation = {
    id,
    seq,
    method: input.method,
    path: input.path,
    body: input.body,
    createdAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    affects: affectsFor(input.method, input.path),
    ...(tempId ? { tempId } : {}),
  };

  entries = [...entries, entry];
  await Promise.all([idbPut(MUTATION_STORE, entry), idbPut(META_STORE, { key: SEQ_META_KEY, value: seq })]);
  emit({ type: 'queued', entry });
  emit({ type: 'changed' });

  return { entry, result: queuedResult(entry.method, entry.path, entry.body, entry.tempId), deduplicated: false };
}

/* -------------------------------------------------------------------------- */
/* replay                                                                     */
/* -------------------------------------------------------------------------- */

function isOnline(): boolean {
  if (typeof navigator === 'undefined') return true;
  // Node exposes a `navigator` without `onLine`; anything but an explicit
  // `false` means "the browser has not told us we are offline".
  return navigator.onLine !== false;
}

/**
 * Drains the queue, one entry at a time, oldest first.
 *
 * Re-entrant calls share the in-flight pass, and a second tab is kept out by the
 * per-entry lease.
 */
export function flushQueue(): Promise<FlushReport> {
  if (pumping) return pumping;
  syncing = true;
  pumping = runFlush().finally(() => {
    pumping = null;
    syncing = false;
    emit({ type: 'changed' });
  });
  return pumping;
}

async function runFlush(): Promise<FlushReport> {
  const report: FlushReport = { synced: 0, failed: 0, retried: 0, skipped: true };

  await loadQueue();
  if (entries.length === 0) return report;
  if (authPaused) return report;
  if (!isOnline()) return report;

  report.skipped = false;
  const touched = new Set<string>();

  for (;;) {
    const now = Date.now();
    const next = orderQueue(entries).find((entry) => readyForReplay(entry, now));
    if (!next) break;

    // The claim is written before the request leaves, so a tab that dies mid
    // flight leaves a lease behind rather than an invitation to send again.
    const claimed: QueuedMutation = { ...next, leaseUntil: now + LEASE_MS };
    replaceEntry(claimed);
    await idbPut(MUTATION_STORE, claimed);

    try {
      const data = await sendNow<unknown>(claimed.method, claimed.path, claimed.body, undefined, {
        'X-Idempotency-Key': claimed.id,
      });

      removeEntry(claimed.id);
      await idbDelete(MUTATION_STORE, claimed.id);
      for (const prefix of claimed.affects) touched.add(prefix);
      report.synced += 1;

      const serverId = claimed.tempId ? createdId(data) : null;
      if (claimed.tempId && serverId) {
        const map = new Map([[claimed.tempId, serverId]]);
        entries = entries.map((entry) => rewriteEntryTempIds(entry, map));
        // Persisted immediately: a reload between here and the next send must
        // not lose the mapping the remaining entries depend on.
        await Promise.all(entries.map((entry) => idbPut(MUTATION_STORE, entry)));
      }
    } catch (error) {
      const status = error instanceof ApiClientError ? error.status : 0;
      const message = error instanceof Error ? error.message : 'The change could not be sent.';
      const outcome = classifyStatus(status);

      if (outcome === 'retry') {
        const attempts = claimed.attempts + 1;
        const updated: QueuedMutation = {
          ...claimed,
          attempts,
          leaseUntil: undefined,
          nextAttemptAt: Date.now() + retryDelayMs(attempts),
        };
        replaceEntry(updated);
        await idbPut(MUTATION_STORE, updated);
        report.retried += 1;
        // Stop the pass: everything behind this entry may depend on it.
        break;
      }

      if (outcome === 'auth') {
        const paused: QueuedMutation = { ...claimed, leaseUntil: undefined, nextAttemptAt: Date.now() };
        authPaused = true;
        replaceEntry(paused);
        await idbPut(MUTATION_STORE, paused);
        emit({ type: 'auth' });
        break;
      }

      // Not retryable: the server rejected the request itself. Repeating it
      // would only produce the same rejection, so the entry is dropped and the
      // user is told the change did not survive.
      removeEntry(claimed.id);
      await idbDelete(MUTATION_STORE, claimed.id);
      for (const prefix of claimed.affects) touched.add(prefix);
      failures = [
        ...failures,
        { id: claimed.id, method: claimed.method, path: claimed.path, status, message, at: Date.now() },
      ].slice(-MAX_FAILURES);
      report.failed += 1;
      emit({ type: 'failed', entry: claimed, status, message });
    }
  }

  if (report.synced > 0 || report.failed > 0) {
    emit({ type: 'flushed', affects: [...touched], synced: report.synced, failed: report.failed });
  }
  emit({ type: 'changed' });
  return report;
}

/**
 * Installs the triggers that keep a pending queue moving: reconnect, returning to
 * the tab, and a timer while anything is waiting. Idempotent.
 */
export function startQueuePump(): void {
  if (pumpStarted || typeof window === 'undefined') return;
  pumpStarted = true;

  window.addEventListener('online', () => void flushQueue());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void flushQueue();
  });

  // A captive portal or a Wi-Fi handover can leave `navigator.onLine` true and
  // the network gone, so the timer is what actually retries on a bad connection.
  timer = setInterval(() => {
    if (hasPending() && !authPaused) void flushQueue();
  }, 20_000);

  void loadQueue().then(() => {
    if (hasPending()) void flushQueue();
  });
}

/** Test-only: stop the interval so a test process can exit. */
export function stopQueuePump(): void {
  if (timer) clearInterval(timer);
  timer = null;
  pumpStarted = false;
}

/** Clears everything: used on sign-out and when the session scope changes. */
export async function clearQueue(): Promise<void> {
  entries = [];
  failures = [];
  authPaused = false;
  seq = 0;
  await Promise.all([idbClear(MUTATION_STORE), idbPut(META_STORE, { key: SEQ_META_KEY, value: 0 })]);
  emit({ type: 'changed' });
}

/** Resumes replaying after a 401 — the user has signed back in. */
export function resumeQueue(): void {
  if (!authPaused) return;
  authPaused = false;
  emit({ type: 'changed' });
  void flushQueue();
}

export function dismissFailures(): void {
  failures = [];
  emit({ type: 'changed' });
}

/** Test-only: forget all in-memory state. */
export function __resetQueueForTests(): void {
  entries = [];
  failures = [];
  loaded = false;
  loading = null;
  seq = 0;
  authPaused = false;
  pumping = null;
  syncing = false;
}

export { isQueueable };
