/**
 * The smallest IndexedDB wrapper this app needs.
 *
 * Two things are persisted offline-first, and both of them are keyed records:
 *
 *   `entries`    the read cache — one record per `useResource` key (see
 *                `offline-store.ts` for the record shape and its serialisation).
 *   `mutations`  writes made while the network was unavailable, in the order
 *                they were made (see `offline-queue.ts`).
 *   `meta`       small scalars: the session scope the two above belong to and
 *                the mutation sequence counter.
 *
 * Deliberately hand-written rather than pulling in `idb`: the surface used here
 * is a handful of operations, and IndexedDB's request/transaction model is only
 * awkward until it is wrapped once.
 *
 * ## Every operation is optional
 *
 * IndexedDB is missing or unusable in more places than it looks: server-side
 * rendering, the node test runner, Safari private browsing (where `open()`
 * rejects), and any browser that has been denied storage. A failure to open the
 * database must never take the app down, so `openOfflineDb()` resolves to `null`
 * in those cases and every helper below degrades to a no-op. The caller learns
 * the difference through `isOfflineDbUsable()`, which is what gates the promise
 * "your changes are held on this device".
 */

export const OFFLINE_DB_NAME = 'tasktick-offline';
export const OFFLINE_DB_VERSION = 1;

export const ENTRY_STORE = 'entries';
export const MUTATION_STORE = 'mutations';
export const META_STORE = 'meta';

/** The keyPath of each object store. */
const KEY_PATHS: Record<string, string> = {
  [ENTRY_STORE]: 'key',
  [MUTATION_STORE]: 'id',
  [META_STORE]: 'key',
};

type Db = IDBDatabase;

let dbPromise: Promise<Db | null> | null = null;
let usable = false;

/** True once the database has been opened successfully on this page. */
export function isOfflineDbUsable(): boolean {
  return usable;
}

/** True when `indexedDB` exists at all (false during SSR and in node tests). */
export function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined';
}

/**
 * Opens (and migrates) the database, once per page.
 *
 * The promise is memoised even on failure: a browser that refused once will
 * refuse again, and retrying on every write would turn a storage problem into a
 * hot loop.
 */
export function openOfflineDb(): Promise<Db | null> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<Db | null>((resolve) => {
    if (!hasIndexedDb()) {
      resolve(null);
      return;
    }

    let settled = false;
    const done = (value: Db | null) => {
      if (settled) return;
      settled = true;
      usable = value !== null;
      resolve(value);
    };

    try {
      const open = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);

      open.onupgradeneeded = () => {
        const db = open.result;
        for (const [store, keyPath] of Object.entries(KEY_PATHS)) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store, { keyPath });
        }
      };
      open.onsuccess = () => done(open.result);
      open.onerror = () => done(null);
      open.onblocked = () => done(null);
    } catch {
      // Some privacy modes throw synchronously from `open`.
      done(null);
    }
  });

  return dbPromise;
}

/**
 * Runs `fn` inside one transaction and resolves when that transaction commits.
 *
 * The whole transaction is settled once. Resolving on the individual request
 * would let a caller believe a write had landed before the transaction carrying
 * it had committed — the one thing an offline queue cannot get wrong.
 *
 * Returns `{ ok: false }` when the database is unavailable, so "the write
 * failed" is distinguishable from "the stored value was undefined".
 */
async function transact<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest,
): Promise<{ ok: true; value: T } | { ok: false }> {
  const db = await openOfflineDb();
  if (!db) return { ok: false };

  try {
    return await new Promise<{ ok: true; value: T } | { ok: false }>((resolve) => {
      let value: T;
      let tx: IDBTransaction;
      try {
        tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        req.onsuccess = () => {
          value = req.result as T;
        };
        tx.oncomplete = () => resolve({ ok: true, value });
        tx.onerror = () => resolve({ ok: false });
        tx.onabort = () => resolve({ ok: false });
      } catch {
        resolve({ ok: false });
      }
    });
  } catch {
    return { ok: false };
  }
}

export async function idbPut(store: string, value: unknown): Promise<boolean> {
  return (await transact(store, 'readwrite', (s) => s.put(value as never))).ok;
}

export async function idbDelete(store: string, key: IDBValidKey): Promise<boolean> {
  return (await transact(store, 'readwrite', (s) => s.delete(key))).ok;
}

export async function idbGet<T>(store: string, key: IDBValidKey): Promise<T | null> {
  const result = await transact<T | undefined>(store, 'readonly', (s) => s.get(key));
  if (!result.ok) return null;
  return result.value ?? null;
}

export async function idbGetAll<T>(store: string): Promise<T[]> {
  const result = await transact<T[]>(store, 'readonly', (s) => s.getAll());
  if (!result.ok || !Array.isArray(result.value)) return [];
  return result.value;
}

export async function idbClear(store: string): Promise<void> {
  await transact(store, 'readwrite', (s) => s.clear());
}

/** Removes the whole database — used when a different account signs in. */
export async function idbDestroy(): Promise<void> {
  const db = await openOfflineDb();
  dbPromise = null;
  usable = false;
  if (db) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
  }
  if (!hasIndexedDb()) return;

  await new Promise<void>((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(OFFLINE_DB_NAME);
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Test-only: forget the memoised connection and the usability flag. */
export function __resetOfflineDbForTests(): void {
  dbPromise = null;
  usable = false;
}
