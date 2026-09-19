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
 * is not running yet, and it will ask again on the next load. `ready` is not
 * used here because it resolves even when a worker is registered but not yet
 * controlling this document — messaging a controller-less worker is a no-op and
 * would silently leave the worker without a scope.
 */
export function announceScopeToServiceWorker(next: string | null): void {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

  const send = (target: ServiceWorker | null) => {
    if (!target) return;
    try {
      target.postMessage(next === null ? { type: 'sign-out' } : { type: 'session', scope: next });
    } catch (error) {
      console.warn('[offline] could not tell the service worker about the session', error);
    }
  };

  send(navigator.serviceWorker.controller);
  // On the very first load the worker is still installing; once it claims the
  // page it must be told too, or it would run with no scope for a whole session.
  if (!navigator.serviceWorker.controller) {
    void navigator.serviceWorker.ready.then(() => send(navigator.serviceWorker.controller)).catch(() => undefined);
  }
}

/* -------------------------------------------------------------------------- */
/* lifecycle                                                                  */
/* -------------------------------------------------------------------------- */

async function fetchLiveScope(): Promise<string | null> {
  try {
    const response = await fetch(SESSION_ENDPOINT, {
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return sessionScopeFromPayload(await response.json());
  } catch {
    // Offline, or the server is down: the stored scope is the best answer.
    return null;
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
