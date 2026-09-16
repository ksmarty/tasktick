'use client';

/**
 * Minimal client data layer.
 *
 * A cache + subscription store rather than a data-fetching library: the app
 * needs exactly three things — share one in-flight request per key, revalidate
 * on focus, and let a mutation push an optimistic value — and hand-rolling them
 * is smaller and easier to reason about than bending a framework to the
 * offline-first behaviour the PWA needs.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api, errorMessage } from './api-client';

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
  cache.set(key, { ...current, ...patch } as Entry);
  emit();
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

      const promise = (async () => {
        try {
          const data = await api.get<T>(key!, queryRef.current as never);
          // Ignore a response that a newer request has already superseded.
          if (getEntry<T>(cacheKey).version === version) {
            setEntry<T>(cacheKey, { data, isLoading: false, error: null, loadedAt: Date.now() });
          }
        } catch (error) {
          if (getEntry<T>(cacheKey).version === version) {
            setEntry<T>(cacheKey, { isLoading: false, error: errorMessage(error) });
          }
        }
      })();

      setEntry<T>(cacheKey, { promise });
      return promise;
    },
    [cacheKey, enabled, key, staleAfterMs],
  );

  useEffect(() => {
    void load();
  }, [load]);

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

/** Imperatively refreshes every cached key matching a prefix. */
export function invalidate(prefix: string): void {
  for (const key of cache.keys()) {
    if (key === prefix || key.startsWith(`${prefix}?`) || key.startsWith(`${prefix}/`)) {
      const entry = getEntry(key);
      setEntry(key, { loadedAt: 0, version: entry.version });
    }
  }
  emit();
}

/** Drops a cached entry entirely (e.g. after a delete). */
export function forget(key: string): void {
  cache.delete(key);
  emit();
}

export function clearCache(): void {
  cache.clear();
  emit();
}

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

export function useOnline(): boolean {
  return useSyncExternalStore(
    (listener) => {
      window.addEventListener('online', listener);
      window.addEventListener('offline', listener);
      return () => {
        window.removeEventListener('online', listener);
        window.removeEventListener('offline', listener);
      };
    },
    () => navigator.onLine,
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
