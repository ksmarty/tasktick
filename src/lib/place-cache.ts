/**
 * Remembered map places.
 *
 * A short maps link is opaque: the only way to learn what it points at is to
 * follow it on the server. That costs a round trip, which is why the sheet used
 * to ask before framing the map, and why opening the same task twice paid for
 * the same answer twice.
 *
 * A share link is immutable — the place it names does not move — so the answer
 * is worth keeping on the device. The cache is read synchronously during the
 * first effect that runs, so a place seen before paints without waiting for the
 * network, and the server's own resolver still answers the first sighting.
 *
 * localStorage rather than IndexedDB: the payload is a few dozen bytes per
 * entry and the read has to be synchronous to be worth anything at paint time.
 */

export interface CachedPlace {
  name: string | null;
  latitude: number | null;
  longitude: number | null;
}

interface Entry {
  place: CachedPlace;
  at: number;
}

/** The key carries its own version: a changed shape must not be read as an old one. */
const STORAGE_KEY = 'tasktick.places.v1';

/** Long enough that a place is remembered across releases, short enough to forget a typo. */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** A share link is one entry per link; this keeps a well-used device bounded. */
const LIMIT = 200;

let entries: Map<string, Entry> | null = null;

function storage(): Storage | null {
  try {
    // Access itself throws in Safari's private mode, so the check is guarded.
    if (typeof window === 'undefined') return null;
    return window.localStorage ?? null;
  } catch {
    return null;
  }
}

function load(): Map<string, Entry> {
  if (entries) return entries;
  const store = storage();
  const empty = new Map<string, Entry>();
  entries = empty;
  if (!store) return empty;
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return empty;
  }
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Record<string, Entry>;
    const cutoff = Date.now() - TTL_MS;
    for (const [key, entry] of Object.entries(parsed)) {
      if (!entry || typeof entry.at !== 'number' || entry.at < cutoff) continue;
      if (!entry.place || typeof entry.place !== 'object') continue;
      empty.set(key, entry);
    }
  } catch {
    empty.clear();
  }
  return empty;
}

function save(): void {
  const store = storage();
  if (!store || !entries) return;
  const flat: Record<string, Entry> = {};
  for (const [key, entry] of entries) flat[key] = entry;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(flat));
  } catch {
    // A full or unavailable store is not a reason to fail a render.
  }
}

/**
 * The place remembered for this link, or null.
 *
 * Returns a miss for an entry older than the TTL rather than pruning while
 * reading: the prune happens on the next write, where it costs nothing.
 */
export function readPlaceCache(url: string): CachedPlace | null {
  if (!url) return null;
  const entry = load().get(url);
  if (!entry) return null;
  if (entry.at < Date.now() - TTL_MS) return null;
  return entry.place;
}

/**
 * Remember what a link resolved to.
 *
 * Only successes reach here: caching "nothing there" would turn one bad second
 * into a link that never resolves again.
 */
export function writePlaceCache(url: string, place: CachedPlace): void {
  if (!url || !place) return;
  const map = load();
  // Re-inserting moves the key to the end, so eviction below is oldest-first.
  map.delete(url);
  map.set(url, { place, at: Date.now() });
  while (map.size > LIMIT) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
  save();
}

/** Drop everything in memory so the next read goes back to storage. */
export function resetPlaceCache(): void {
  entries = null;
}
