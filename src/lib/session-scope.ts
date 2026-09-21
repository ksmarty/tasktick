'use client';

/**
 * Which session the locally stored data belongs to.
 *
 * ## The question this answers
 *
 * "What identifies the current session from inside a service worker?" Nothing
 * the worker can read for itself. The session cookie is `httpOnly`, so
 * `document.cookie` cannot see it; `self.cookieStore` exists only in Chromium;
 * and even a worker that could read the cookie would be reading a rotating
 * credential rather than an identity. So the *page* answers the question and
 * tells the worker, and the worker stores only an opaque hash:
 *
 *   `GET /api/auth/get-session` -> `session.id` (opaque, rotates per sign-in)
 *        -> `hashScope()` (short, non-reversible, no credential)
 *        -> `postMessage({ type: 'session', scope })` to the worker
 *        -> the worker names its API cache `api-<scope>-<version>` and deletes
 *           every `api-<other>-<version>` on the spot.
 *
 * That is why the API cache can no longer leak between accounts: it is not one
 * cache shared by the device, it is one cache per session, and a session change
 * is what deletes the previous one. Sign-out is the second, belt-and-braces
 * purge (`{ type: 'sign-out' }`, which drops every API cache and the stored
 * scope).
 *
 * ## The placeholder scope
 *
 * `get-session` is a round trip. Everything the app reads on the first paint can
 * easily complete before it does, and if those reads were not persisted the very
 * first session on a device would have nothing to show offline. So reads are
 * persisted immediately under the placeholder scope `unverified`, and are
 * re-tagged once the real session is known. A mismatch between the stored scope
 * and the live one wipes everything, which is the case that matters: a session
 * revoked elsewhere, followed by a different account signing in on this device,
 * must never be able to read the previous account's cache.
 */
import { ENTRY_STORE, META_STORE, idbClear, idbGet, idbGetAll, idbPut } from './offline-db';
import { clearPersistedEntries } from './offline-store';
import { clearQueue, resumeQueue, startQueuePump } from './offline-queue';

/** Scope used before the live session is known. */
export const UNVERIFIED_SCOPE = 'unverified';

const SCOPE_META_KEY = 'session-scope';

/** The session endpoint used to learn the scope. Never cached, never queued. */
export const SESSION_ENDPOINT = '/api/auth/get-session';

/**
 * How long `get-session` may hold up the offline machinery before the stored
 * scope is used instead.
 *
 * A healthy server answers in a few hundred milliseconds. Bounding it matters on
 * a link that hangs rather than refuses, where no `offline` event fires: an
 * unbounded handshake delayed connectivity reporting, the write queue and the
 * IndexedDB restore until the browser's own timeout. See `fetchLiveScope`.
 */
const SESSION_TIMEOUT_MS = 3000;

export type ScopeEvent =
  | { type: 'resolved'; scope: string }
  | { type: 'changed'; from: string; to: string }
  | { type: 'purged' };

let scope: string | null = null;
let initialised: Promise<void> | null = null;
const listeners = new Set<(event: ScopeEvent) => void>();

export function currentSessionScope(): string | null {
  return scope;
}

export function onScopeEvent(listener: (event: ScopeEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit(event: ScopeEvent): void {
  for (const listener of [...listeners]) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[offline] scope listener failed', error);
    }
  }
}

/* -------------------------------------------------------------------------- */
/* pure helpers                                                               */
/* -------------------------------------------------------------------------- */

/**
 * FNV-1a over the session id, rendered as hex.
 *
 * The point is not secrecy — a session id is not a password — but keeping a
 * database primary key out of a cache name that shows up in devtools, and
 * keeping the name short and URL-safe.
 */
export function hashScope(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `s${hash.toString(16).padStart(8, '0')}`;
}

/**
 * The scope implied by a `/api/auth/get-session` payload, or `null` when there
 * is no session. Accepts the session id and falls back to the user id, because
 * a session row is the unit that changes on sign-in and the user id is the next
 * best identity if a build stops returning one.
 */
export function sessionScopeFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const body = payload as { session?: { id?: unknown }; user?: { id?: unknown } };
  const sessionId = typeof body.session?.id === 'string' ? body.session.id : null;
  if (sessionId) return hashScope(sessionId);
  const userId = typeof body.user?.id === 'string' ? body.user.id : null;
  return userId ? hashScope(userId) : null;
}

/* -------------------------------------------------------------------------- */
/* storage                                                                    */
/* -------------------------------------------------------------------------- */

async function readStoredScope(): Promise<string | null> {
  const record = await idbGet<{ key: string; value: string }>(META_STORE, SCOPE_META_KEY);
  return typeof record?.value === 'string' && record.value ? record.value : null;
}

async function writeStoredScope(next: string | null): Promise<void> {
  if (next === null) {
    await idbClear(META_STORE);
    return;
  }
  await idbPut(META_STORE, { key: SCOPE_META_KEY, value: next });
}

/** Re-tags every persisted read that was written before the scope was known. */
async function reTagUnverified(next: string): Promise<void> {
  const records = await idbGetAll<{ key: string; scope?: string }>(ENTRY_STORE);
  const stale = records.filter((record) => record?.scope === UNVERIFIED_SCOPE);
  await Promise.all(stale.map((record) => idbPut(ENTRY_STORE, { ...record, scope: next })));
}

/* -------------------------------------------------------------------------- */
/* the worker's copy                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Hands the scope to the service worker so it can key (and purge) its API cache.
 *
 * `controller` is the worker that owns this page; when there is none the worker
 * has not claimed the page yet. `ready` is not used directly because it resolves
 * even when a worker is registered but not yet controlling this document —
 * messaging a controller-less worker is a no-op and would silently leave the
 * worker without a scope. Instead the message is queued behind
 * `postToServiceWorker`, which waits for the controller (or for `ready` when
 * one is still installing) rather than dropping the message.
 */
export function announceScopeToServiceWorker(next: string | null): void {
  void postToServiceWorker(next === null ? { type: 'sign-out' } : { type: 'session', scope: next });
}

/**
 * Asks the worker to keep THIS page's document.
 *
 * The worker can only cache a document it sees a request for, and the document
 * that boots a first visit was fetched before the worker was controlling — so
 * it was never stored, and a cold offline open had nothing to serve. The page is
 * the only thing that knows which URL that document belongs to, so it says so,
 * once, on the same channel as the session scope.
 *
 * Deliberately not called on navigation: the worker stores every document that
 * passes through it already, and this only covers the one that could not.
 */
export function requestDocumentCache(url?: string): void {
  if (typeof window === 'undefined') return;
  void postToServiceWorker({ type: 'cache-document', url: url ?? window.location.href });
}

/**
 * Tells the worker to drop the cached reads a write just invalidated.
 *
 * The worker cannot see a write — non-GET requests are never intercepted — so
 * the page that performed it says which read prefixes are now stale. This is
 * what lets reads be cache-first without replaying the pre-write body after a
 * completed task or an edited event.
 *
 * The returned promise resolves once the worker has actually deleted the
 * entries. `revalidate()` awaits it before refetching, so a forced refresh can
 * never be answered from the copy the write just invalidated. When there is no
 * worker — or it does not answer — the promise still resolves: the invalidation
 * is what keeps the cache honest, not a precondition for the app to work.
 */
export function invalidateServiceWorker(prefixes: readonly string[]): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve();
  const list = prefixes.filter((prefix) => typeof prefix === 'string' && prefix.length > 0);
  if (list.length === 0) return Promise.resolve();

  return new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    // A worker that is not running, or is mid-restart, must not hold a refetch
    // hostage: the fallback is the cache-first read it would have done anyway.
    const timer = setTimeout(finish, 1000);

    // Keep `port1` for the reply and transfer `port2`; a transferred port is no
    // longer usable on the sending side.
    let transfer: Transferable[] = [];
    if (typeof MessageChannel !== 'undefined') {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        finish();
      };
      transfer = [channel.port2];
    }

    void postToServiceWorker({ type: 'invalidate', prefixes: list }, transfer).catch(finish);
  });
}

/**
 * Serialises messages to the worker and delivers them in the order they were
 * queued.
 *
 * Order matters: the worker refuses to cache anything until it knows which
 * session the data belongs to, so the `session` message must land before a
 * `cache-document` that depends on it. Queueing also handles the first load,
 * where `navigator.serviceWorker.controller` is null until the newly installed
 * worker claims the page: the messages wait for `ready` instead of being
 * dropped, which is what previously left the worker scopeless for a whole
 * session.
 */
let postQueue: Promise<void> = Promise.resolve();

function postToServiceWorker(message: unknown, transfer: Transferable[] = []): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return Promise.resolve();

  const deliver = async (): Promise<void> => {
    let target = navigator.serviceWorker.controller;
    if (!target) {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      target = navigator.serviceWorker.controller ?? registration?.active ?? null;
    }
    if (!target) return;
    try {
      target.postMessage(message, transfer);
    } catch (error) {
      console.warn('[offline] could not message the service worker', error);
    }
  };

  postQueue = postQueue.then(deliver, deliver);
  return postQueue;
}

/* -------------------------------------------------------------------------- */
/* lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

async function fetchLiveScope(): Promise<string | null> {
  /*
   * Bounded on purpose. This is the FIRST thing the page waits for: starting the
   * write queue and restoring IndexedDB both begin only once `runInit` gets past
   * it. On a link that hangs — accepted, never answered, so no `offline` event
   * ever fires — an unbounded fetch here meant the stored data was never
   * restored until the browser gave up. The stored scope is a perfectly good
   * answer in that case.
   */
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
  try {
    const response = await fetch(SESSION_ENDPOINT, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return sessionScopeFromPayload(await response.json());
  } catch {
    // Offline, the server is down, or the handshake timed out: the stored scope
    // is the best answer.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function runInit(): Promise<void> {
  if (typeof window === 'undefined') return;

  const [stored, live] = await Promise.all([readStoredScope(), fetchLiveScope()]);

  if (live) {
    if (stored && stored !== live && stored !== UNVERIFIED_SCOPE) {
      // A different session than the one this device last stored: nothing on
      // disk belongs to it.
      await purgeLocalData();
      scope = live;
      await writeStoredScope(live);
      announceScopeToServiceWorker(live);
      emit({ type: 'changed', from: stored, to: live });
    } else {
      scope = live;
      /*
       * Re-tag before anything else reads the store: reads that completed while
       * this was still resolving were written under the placeholder scope, and
       * they are real data for this session. Without this they would be invisible
       * to the next (offline) load, which is exactly when they matter.
       */
      await reTagUnverified(live);
      await writeStoredScope(live);
      announceScopeToServiceWorker(live);
      emit({ type: 'resolved', scope: live });
    }

    /*
     * Ask the worker to keep the document that booted this page.
     *
     * It is queued after the scope message above, so the worker always knows
     * which session the document belongs to before it is stored. A document
     * that DID pass through the worker was already cached by the navigation
     * strategy; this only covers the first-visit case that could not.
     */
    requestDocumentCache();
  } else {
    // No live session: either signed out (no stored scope either) or offline
    // with a session we cannot verify. In both cases the stored scope is what
    // the local data was tagged with.
    scope = stored;
    if (stored) emit({ type: 'resolved', scope: stored });
  }

  startQueuePump();
  resumeQueue();
}

/** Resolves the session scope and starts the offline machinery. Idempotent. */
export function ensureOfflineSupport(): Promise<void> {
  if (!initialised) initialised = runInit().catch((error) => console.warn('[offline] init failed', error));
  return initialised;
}

/** The scope the read cache should be tagged with right now. */
export async function whenScopeReady(): Promise<string | null> {
  await ensureOfflineSupport();
  return scope;
}

/** The scope tag to persist a read under; the placeholder until resolved. */
export function scopeForWrites(): string {
  return scope ?? UNVERIFIED_SCOPE;
}

/**
 * Drops every trace of the current session from this device.
 *
 * Called on sign-out, and on discovering that the stored data belongs to a
 * different session. The worker is told first so its API cache goes before the
 * client's own data does.
 */
export async function purgeLocalData(): Promise<void> {
  announceScopeToServiceWorker(null);
  await Promise.all([clearPersistedEntries(), clearQueue(), writeStoredScope(null)]);
}

/** Sign-out: purge, then tell the store to empty itself. */
export async function purgeSession(): Promise<void> {
  await purgeLocalData();
  scope = null;
  emit({ type: 'purged' });
}

/** Test-only: forget the memoised initialisation. */
export function __resetSessionScopeForTests(): void {
  initialised = null;
  scope = null;
}
