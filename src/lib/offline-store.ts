/**
 * Persistence for the read cache.
 *
 * `store.ts` keeps its cache in a `Map`, which is what makes the app fast and
 * what makes a reload lose everything. This module turns one cache entry into a
 * keyed IndexedDB record and back, and owns the rules about which records may be
 * restored into the live cache.
 *
 * ## Why IndexedDB and not the Cache API
 *
 * The service worker's cache is keyed by URL and holds whole HTTP responses.
 * The store's cache is keyed by a *serialised resource key* (`/api/tasks?window=today`)
 * and holds the unwrapped `data` of the envelope, which is what every screen
 * reads. Rebuilding the store's keys out of HTTP responses would mean
 * reimplementing the store inside the worker. So the store persists itself,
 * under its own keys, and the worker keeps its own copy for the case where the
 * page has no store at all (a hard navigation to a screen that was never
 * visited).
 *
 * ## Serialisation
 *
 * A record holds the payload as **JSON text**, not as a structured-cloned
 * object. That is deliberate:
 *
 *   - The source of every payload is already `JSON.parse`d response text, so a
 *     JSON round trip is lossless for everything that can be in the cache.
 *   - Structured clone would throw (`DataCloneError`) on a value that cannot be
 *     cloned — a DOM node that leaked into a payload, say — and a throw inside
 *     a write path is exactly the kind of failure that loses the *other* data
 *     in the same transaction.
 *   - JSON text is inspectable in devtools and trivially unit-testable in node,
 *     where there is no IndexedDB at all.
 *
 * The visible consequence is that `undefined` object properties are dropped and
 * a `Date` would come back as an ISO string. Neither occurs in an API payload.
 */
import { ENTRY_STORE, idbClear, idbDelete, idbGetAll, idbPut } from './offline-db';

/** A cache entry as it is stored. `json` is the serialised `data`. */
export interface PersistedEntry {
  key: string;
  /** The session scope this record belongs to; records from another are ignored. */
  scope: string;
  /** Epoch ms of the last successful load (informational). */
  loadedAt: number;
  /** Epoch ms this record was written. */
  savedAt: number;
  json: string;
}

/** A validated record, with the payload parsed again. */
export interface DecodedEntry {
  key: string;
  scope: string;
  data: unknown;
  loadedAt: number;
}

/** Records older than this are dropped rather than restored. */
export const ENTRY_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** A single payload larger than this is not persisted (quota, not correctness). */
export const ENTRY_MAX_BYTES = 2_000_000;

/**
 * Serialises one cache entry.
 *
 * Returns `null` for anything that must not be stored: no data, a circular
 * structure, or an oversized payload. A `null` is not an error — it means "this
 * key is simply not available offline", which is what the store treats it as.
 */
export function encodeEntry(input: {
  key: string;
  scope: string;
  data: unknown;
  loadedAt?: number;
  now?: number;
}): PersistedEntry | null {
  if (!input.key || !input.scope) return null;
  if (input.data === undefined) return null;

  let json: string;
  try {
    const serialised = JSON.stringify(input.data);
    if (serialised === undefined) return null;
    json = serialised;
  } catch {
    return null;
  }

  if (json.length > ENTRY_MAX_BYTES) return null;

  const now = input.now ?? Date.now();
  const loadedAt = Number.isFinite(input.loadedAt) ? Math.max(0, Math.trunc(input.loadedAt as number)) : 0;

  return { key: input.key, scope: input.scope, loadedAt, savedAt: now, json };
}

/** Validates and parses a stored record. Malformed records decode to `null`. */
export function decodeEntry(raw: unknown): DecodedEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const record = raw as Partial<PersistedEntry>;

  if (typeof record.key !== 'string' || record.key.length === 0) return null;
  if (typeof record.scope !== 'string' || record.scope.length === 0) return null;
  if (typeof record.json !== 'string') return null;

  let data: unknown;
  try {
    data = JSON.parse(record.json);
  } catch {
    return null;
  }
  if (data === undefined) return null;

  const loadedAt = typeof record.loadedAt === 'number' && Number.isFinite(record.loadedAt) ? record.loadedAt : 0;

  return { key: record.key, scope: record.scope, data, loadedAt };
}

/** A record is expired when it was written more than `maxAge` ago. */
export function isExpired(record: { savedAt?: unknown }, now: number, maxAge: number = ENTRY_MAX_AGE_MS): boolean {
  const savedAt = typeof record?.savedAt === 'number' && Number.isFinite(record.savedAt) ? record.savedAt : 0;
  if (savedAt <= 0) return true;
  // A clock that moved backwards must not make old data immortal.
  if (savedAt > now) return false;
  return now - savedAt > maxAge;
}

/**
 * The records that may be restored for `scope`: valid, belonging to this
 * session, not expired, and newest first. Duplicate keys keep the newest record.
 */
export function selectHydratable(
  records: readonly unknown[],
  options: { scope: string; now: number; maxAge?: number },
): DecodedEntry[] {
  const maxAge = options.maxAge ?? ENTRY_MAX_AGE_MS;
  const best = new Map<string, { decoded: DecodedEntry; savedAt: number }>();

  for (const raw of records) {
    const record = raw as Partial<PersistedEntry>;
    if (!record || record.scope !== options.scope) continue;
    if (isExpired(record, options.now, maxAge)) continue;

    const decoded = decodeEntry(record);
    if (!decoded) continue;

    const savedAt = typeof record.savedAt === 'number' ? record.savedAt : 0;
    const existing = best.get(decoded.key);
    if (!existing || savedAt > existing.savedAt) best.set(decoded.key, { decoded, savedAt });
  }

  return [...best.values()]
    .sort((a, b) => b.savedAt - a.savedAt)
    .map((entry) => entry.decoded);
}

/**
 * Whether a restored record may be applied to the live cache.
 *
 * Restoring must never overwrite data this session already fetched: a live
 * request is newer than anything on disk, and the persisted copy exists only for
 * the case where there is no request to make. This is the whole merge rule.
 */
export function shouldApplyHydrated(
  current: { data: unknown } | undefined,
  hydrated: DecodedEntry,
): boolean {
  if (!hydrated) return false;
  return current?.data === undefined;
}

/* -------------------------------------------------------------------------- */
/* storage                                                                    */
/* -------------------------------------------------------------------------- */

export async function persistEntry(record: PersistedEntry): Promise<void> {
  await idbPut(ENTRY_STORE, record);
}

export async function forgetPersistedEntry(key: string): Promise<void> {
  await idbDelete(ENTRY_STORE, key);
}

/**
 * Reads every stored record and returns the ones this session may use.
 *
 * Hydrated entries always come back with `loadedAt: 0` in the caller, so the
 * first online `load()` still revalidates: disk is a *fallback*, never a reason
 * to skip the network.
 */
export async function loadPersistedEntries(options: { scope: string; now?: number }): Promise<DecodedEntry[]> {
  const all = await idbGetAll<unknown>(ENTRY_STORE);
  if (all.length === 0) return [];
  return selectHydratable(all, { scope: options.scope, now: options.now ?? Date.now() });
}

export async function clearPersistedEntries(): Promise<void> {
  await idbClear(ENTRY_STORE);
}
