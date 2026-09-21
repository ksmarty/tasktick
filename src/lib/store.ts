'use client';

/**
 * Minimal client data layer.
 *
 * A cache + subscription store rather than a data-fetching library: the app
 * needs exactly three things — share one in-flight request per key, revalidate
 * on focus, and let a mutation push an optimistic value — and hand-rolling them
 * is smaller and easier to reason about than bending a framework to the
 * offline-first behaviour the PWA needs.
 *
 * ## Offline
 *
 * The `Map` below is still the source of truth for rendering, but it is no
 * longer the only copy: every entry with data is mirrored into IndexedDB
 * (`offline-store.ts`) and restored on the next page load, which is what makes a
 * reload on a dead connection show the last data instead of a skeleton. Entries
 * are tagged with the session scope they belong to and are dropped when the
 * scope changes.
 *
 * Two rules make the offline behaviour coherent without any component knowing
 * about it:
 *
 *   1. A fetched response is NOT applied to a resource that has a pending queued
 *      write. The server's copy cannot contain the write yet, so applying it
 *      would roll the user's optimistic change back off the screen — the classic
 *      "I ticked it off, it un-ticked itself" bug. Once the queue drains, the
 *      prefixes are revalidated for real and the server wins again.
 *   2. When a queued write finally lands, the prefixes it affects are refetched
 *      through `revalidate()`, which reaches every mounted screen, not just the
 *      one that made the write (it may not exist any more).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, errorMessage } from './api-client';
import { isQueueUsable, matchesPrefix, pathnameOf, pendingAffects, subscribeQueue } from './offline-queue';
import { encodeEntry, persistEntry as persistRecord, forgetPersistedEntry, loadPersistedEntries, shouldApplyHydrated, clearPersistedEntries } from './offline-store';
import { insertProjectedEntity, projectQueuedCreate } from './offline-projections';
import { ensureOfflineSupport, invalidateServiceWorker, onScopeEvent, scopeForWrites } from './session-scope';

type Listener = () => void;

interface Entry<T = unknown> {
  data: T | undefined;
  error: string | null;
  isLoading: boolean;
  /** Monotonic token so a slow stale response cannot overwrite a fresh one. */
  version: number;
  promise?: Promise<unknown>;
  /** Epoch ms of the last successful load. */
  loadedAt: number;
}

const cache = new Map<string, Entry>();
const listeners = new Set<Listener>();

function emit() {
  for (const listener of listeners) listener();
}

function getEntry<T>(key: string): Entry<T> {
  const existing = cache.get(key) as Entry<T> | undefined;
  if (existing) return existing;
  const fresh: Entry<T> = { data: undefined, error: null, isLoading: false, version: 0, loadedAt: 0 };
  cache.set(key, fresh as Entry);
  return fresh;
}

function setEntry<T>(key: string, patch: Partial<Entry<T>>) {
  const current = getEntry<T>(key);
  const next = { ...current, ...patch } as Entry<T>;
  cache.set(key, next);
  if (patch.data !== undefined) persistEntrySoon(key, next);
  emit();
}

/**
 * True while records are being read back out of IndexedDB.
 *
 * Hydration must not turn around and write what it just read: on a large cache
 * that is a pointless write storm, and on a cached-but-stale payload it would
 * keep refreshing the `savedAt` that expiry is measured against.
 */
let hydrating = false;

function persistEntrySoon(key: string, entry: Entry) {
  if (hydrating || typeof window === 'undefined' || entry.data === undefined) return;
  const record = encodeEntry({
    key,
    scope: scopeForWrites(),
    data: entry.data,
    loadedAt: entry.loadedAt,
  });
  // `null` means the payload is not storable (oversized, or not serialisable);
  // that key is simply not available offline.
  if (record) void persistRecord(record);
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function serializeKey(key: string, query?: Record<string, unknown>): string {
  if (!query) return key;
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : String(v)}`);
  return parts.length ? `${key}?${parts.join('&')}` : key;
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface UseResourceOptions {
  /** Skip fetching entirely (e.g. a sheet that is closed). */
  enabled?: boolean;
  /** Treat data as stale after this many ms. */
  staleAfterMs?: number;
  /** Revalidate when the tab regains focus. Default true. */
  revalidateOnFocus?: boolean;
  /** Revalidate when the browser comes back online. Default true. */
  revalidateOnReconnect?: boolean;
}

export interface Resource<T> {
  data: T | undefined;
  error: string | null;
  isLoading: boolean;
  /** True only on the very first load, so views can show a skeleton. */
  isInitialLoading: boolean;
  refresh: () => Promise<void>;
  /** Applies a local update without a round trip (used for optimistic writes). */
  mutate: (updater: T | ((current: T | undefined) => T | undefined)) => void;
}

export function useResource<T>(
  key: string | null,
  query?: Record<string, unknown>,
  options: UseResourceOptions = {},
): Resource<T> {
  const { enabled = true, staleAfterMs = 15_000, revalidateOnFocus = true, revalidateOnReconnect = true } = options;
  const cacheKey = key ? serializeKey(key, query) : null;
  const queryRef = useRef(query);
  queryRef.current = query;

  const entry = useSyncExternalStore(
    subscribe,
    () => (cacheKey ? getEntry<T>(cacheKey) : undefined),
    () => undefined,
  );

  const load = useCallback(
    async (force = false) => {
      if (!cacheKey || !enabled) return;
      const current = getEntry<T>(cacheKey);

      if (!force && current.data !== undefined && Date.now() - current.loadedAt < staleAfterMs) return;
      if (current.promise && !force) return current.promise;

      const version = current.version + 1;
      setEntry<T>(cacheKey, { isLoading: true, version, error: null });

      /*
       * `run` is referenced from inside its own finally, which only executes
       * after the assignment below has completed.
       */
      let run!: Promise<void>;
      run = (async () => {
        try {
          const data = await api.get<T>(key!, queryRef.current as never);
          // Ignore a response that a newer request has already superseded.
          if (getEntry<T>(cacheKey).version === version) {
            if (pendingAffects(cacheKey)) {
              /*
               * A queued write owns the local copy of this resource.
               *
               * The response was fetched before that write reached the server
               * (or could not reach it at all), so it does not contain the
               * change the user has already seen. Applying it would undo the
               * optimistic update. `invalidate()` marks the entry stale, so the
               * moment the queue drains the next load replaces this with the
               * server's answer.
               */
              setEntry<T>(cacheKey, { isLoading: false, error: null });
            } else {
              setEntry<T>(cacheKey, { data, isLoading: false, error: null, loadedAt: Date.now() });
            }
          }
        } catch (error) {
          if (getEntry<T>(cacheKey).version === version) {
            setEntry<T>(cacheKey, { isLoading: false, error: errorMessage(error) });
          }
        } finally {
          /*
           * Clear the in-flight marker once the request settles.
           *
           * This marker is what dedupes concurrent callers, but it was left set
           * forever after the request resolved. The next `load()` then saw a
           * truthy `promise`, returned the OLD settled one, and never fetched —
           * so `invalidate()` marked an entry stale and nothing ever came of it.
           *
           * The symptom was a screen that only refreshed after a full reload:
           * which is every case of "I added it and it did not appear until I
           * restarted the app". A reload throws the module cache away, which is
           * why restarting 'fixed' it.
           *
           * Only clear it if it is still ours, so a request that a newer load
           * has already replaced cannot delete that newer request's marker.
           */
          if (getEntry<T>(cacheKey).promise === run) {
            setEntry<T>(cacheKey, { promise: undefined });
          }
        }
      })();

      setEntry<T>(cacheKey, { promise: run });
      return run;
    },
    [cacheKey, enabled, key, staleAfterMs],
  );

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * Every mounted resource publishes its loader so a write that lands later can
   * refresh it. `revalidate()` is what the offline queue calls when a replayed
   * write succeeds: the component that made the write may be long gone (or the
   * page may have been reloaded), so the refetch cannot be the caller's job.
   */
  useEffect(() => {
    if (!cacheKey || !enabled) return;
    return registerLoader(cacheKey, (force) => load(force));
  }, [cacheKey, enabled, load]);

  useEffect(() => {
    if (!revalidateOnFocus) return;
    const onFocus = () => {
      if (document.visibilityState === 'visible') void load();
    };
    document.addEventListener('visibilitychange', onFocus);
    return () => document.removeEventListener('visibilitychange', onFocus);
  }, [load, revalidateOnFocus]);

  useEffect(() => {
    if (!revalidateOnReconnect) return;
    const onOnline = () => void load(true);
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [load, revalidateOnReconnect]);

  const mutate = useCallback(
    (updater: T | ((current: T | undefined) => T | undefined)) => {
      if (!cacheKey) return;
      const current = getEntry<T>(cacheKey);
      const next = typeof updater === 'function' ? (updater as (c: T | undefined) => T | undefined)(current.data) : updater;
      setEntry<T>(cacheKey, { data: next, loadedAt: Date.now() });
    },
    [cacheKey],
  );

  return useMemo(
    () => ({
      data: entry?.data,
      error: entry?.error ?? null,
      isLoading: entry?.isLoading ?? false,
      isInitialLoading: Boolean(entry?.isLoading && entry.data === undefined),
      refresh: () => load(true).then(() => undefined),
      mutate,
    }),
    [entry, load, mutate],
  );
}

/** A mounted loader; its result is irrelevant to the caller. */
type Loader = (force: boolean) => unknown;

/** Mounted loaders, so a key can be refreshed without a component asking. */
const loaders = new Map<string, Set<Loader>>();

function registerLoader(key: string, loader: Loader): () => void {
  const set = loaders.get(key) ?? new Set<Loader>();
  set.add(loader);
  loaders.set(key, set);
  return () => {
    set.delete(loader);
    if (set.size === 0) loaders.delete(key);
  };
}

/**
 * Imperatively refreshes every cached key matching a prefix.
 *
 * Marks the client entries stale AND drops the service worker's cached copy of
 * the same reads. The worker cannot see a write — non-GET requests are never
 * intercepted — so without this a cache-first read would answer the next mount
 * with the body from before the write. The returned promise resolves once the
 * worker has actually dropped its copy; `revalidate()` waits on it, and callers
 * that only need the local entries stale can ignore it.
 */
export function invalidate(prefix: string): Promise<void> {
  for (const key of cache.keys()) {
    if (matchesPrefix(key, prefix)) {
      const entry = getEntry(key);
      setEntry(key, { loadedAt: 0, version: entry.version });
    }
  }
  emit();
  return invalidateServiceWorker([prefix]);
}

/**
 * Invalidates and actually refetches, for every mounted key under `prefix`.
 *
 * `invalidate()` alone only marks entries stale, which is enough when the
 * caller is about to read them again. A write replayed from the offline queue
 * has no such caller, so this is the version it uses.
 *
 * The refetch waits for the worker to drop its cached copy first. This is the
 * one caller that refetches immediately, and a cache-first read racing the drop
 * would replay exactly the pre-write body the flush replaced.
 */
export function revalidate(prefix: string): Promise<void> {
  return invalidate(prefix).then(() => {
    for (const [key, callbacks] of loaders) {
      if (!matchesPrefix(key, prefix)) continue;
      for (const callback of [...callbacks]) void callback(true);
    }
  });
}

/** Drops a cached entry entirely (e.g. after a delete). */
export function forget(key: string): void {
  cache.delete(key);
  if (typeof window !== 'undefined') void forgetPersistedEntry(key);
  emit();
}

export function clearCache(): void {
  cache.clear();
  if (typeof window !== 'undefined') void clearPersistedEntries();
  emit();
}

/* -------------------------------------------------------------------------- */
/* offline persistence                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Restores persisted reads for `scope` into the live cache.
 *
 * Hydrated entries are marked stale (`loadedAt: 0`), so online the very next
 * `load()` revalidates them: disk is a fallback for a dead connection, never a
 * reason to show something older than the network would have given us. Nothing
 * is applied over data this session already fetched.
 */
async function hydrateCache(): Promise<void> {
  const scope = scopeForWrites();
  const records = await loadPersistedEntries({ scope });
  if (records.length === 0) return;

  hydrating = true;
  try {
    for (const record of records) {
      if (!shouldApplyHydrated(cache.get(record.key), record)) continue;
      const current = cache.get(record.key);
      cache.set(record.key, {
        data: record.data,
        error: null,
        isLoading: false,
        version: current?.version ?? 0,
        loadedAt: 0,
      });
    }
  } finally {
    hydrating = false;
  }
  emit();
}

/**
 * Shows a queued create immediately, in the reads it belongs to.
 *
 * A queued *update* needs nothing here: the component that made it already
 * changed the screen, and `load()` refuses to overwrite a resource with a
 * pending write. A queued *create* would otherwise be invisible until it reached
 * the server — "Task added" toast, unchanged list.
 */
function applyQueuedProjection(entry: { path: string; body?: unknown; tempId?: string; createdAt: number }): void {
  const projection = projectQueuedCreate(entry.path, entry.body, entry.tempId, entry.createdAt);
  if (!projection) return;

  for (const key of [...cache.keys()]) {
    if (pathnameOf(key) !== projection.resource) continue;
    const current = cache.get(key);
    if (!current || current.data === undefined) continue;

    const next = insertProjectedEntity(current.data, projection.entity);
    if (next === current.data) continue;
    setEntry(key, { data: next, loadedAt: current.loadedAt });
  }
}

/**
 * Wires the store to the offline layer. Runs once, in the browser only.
 *
 * `useResource` and `mutate` keep working exactly as before for every existing
 * caller; what is added here is persistence and the queue's signals.
 */
function startOfflineBridge(): void {
  onScopeEvent((event) => {
    if (event.type === 'purged' || event.type === 'changed') {
      // A different session: nothing in memory belongs to it.
      clearCache();
      return;
    }
    void hydrateCache();
  });

  subscribeQueue((event) => {
    if (event.type === 'queued') applyQueuedProjection(event.entry);
    if (event.type === 'flushed') {
      for (const prefix of event.affects) revalidate(prefix);
    }
  });

  void ensureOfflineSupport();
}

if (typeof window !== 'undefined') startOfflineBridge();

/* -------------------------------------------------------------------------- */
/* mutations                                                                  */
/* -------------------------------------------------------------------------- */

export interface MutationState {
  isPending: boolean;
}

/**
 * Wraps a write. On success it invalidates the given key prefixes so every view
 * showing that data refetches, which is what keeps the calendar and the task
 * list consistent without any manual plumbing.
 */
export function useMutation<TArgs extends unknown[], TResult = unknown>(
  fn: (...args: TArgs) => Promise<TResult>,
  options: { invalidates?: string[]; onSuccess?: (result: TResult, args: TArgs) => void; onError?: (message: string) => void } = {},
) {
  const [isPending, setPending] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setPending(true);
      try {
        const result = await fn(...args);
        for (const prefix of options.invalidates ?? []) invalidate(prefix);
        options.onSuccess?.(result, args);
        return result;
      } catch (error) {
        options.onError?.(errorMessage(error));
        return undefined;
      } finally {
        if (mounted.current) setPending(false);
      }
    },
    [fn, options],
  );

  return { run, isPending } satisfies MutationState & { run: typeof run };
}

/* -------------------------------------------------------------------------- */
/* environment hooks                                                          */
/* -------------------------------------------------------------------------- */

function subscribeNetwork(listener: () => void): () => void {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

/** Truthful connectivity: what the browser reports, and nothing else. */
export function useNetworkOnline(): boolean {
  return useSyncExternalStore(subscribeNetwork, () => navigator.onLine, () => true);
}

/**
 * Whether a write is accepted right now — online, or offline with a durable
 * queue to hold it.
 *
 * This is deliberately NOT `navigator.onLine`. The one caller is
 * `useTaskActions`'s guard ("the app has no queue to put it in"), and that
 * premise is exactly what the offline queue removed: with IndexedDB available, an
 * offline write is accepted, held, replayed, and the failure the guard used to
 * prevent is now the normal path. When IndexedDB is unavailable — private
 * browsing, storage denied — the queue cannot promise to keep anything, so this
 * falls back to the honest answer and the write is refused as it used to be.
 *
 * `useNetworkOnline` above is the truthful connectivity signal for anything that
 * is *about* the connection rather than about accepting a write.
 */
export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      let cancelled = false;
      const unsubscribeNetwork = subscribeNetwork(listener);
      const unsubscribeQueue = subscribeQueue(listener);
      // The queue's durability resolves asynchronously (the database opens once
      // per page), and that changes this snapshot.
      void ensureOfflineSupport().then(() => {
        if (!cancelled) listener();
      });
      return () => {
        cancelled = true;
        unsubscribeNetwork();
        unsubscribeQueue();
      };
    },
    () => navigator.onLine || isQueueUsable(),
    () => true,
  );
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', listener);
      return () => mql.removeEventListener('change', listener);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** True on a viewport wide enough for the persistent sidebar. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

export function useIsStandalone(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () =>
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as { standalone?: boolean }).standalone === true,
    () => false,
  );
}
