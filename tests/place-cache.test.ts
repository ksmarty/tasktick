/**
 * The place cache, and the sheet's habit of resolving a link as it opens.
 *
 * A short maps link costs a server round trip to learn anything about, so the
 * only way opening the same item twice feels instant is to remember the answer.
 * These tests pin the remembering (including the ways a localStorage cache
 * usually goes wrong: expiry, eviction, corrupt JSON, an unavailable store) and
 * the fact that the sheet no longer waits for a tap.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readPlaceCache, resetPlaceCache, writePlaceCache } from '../src/lib/place-cache';

const SHEET = readFileSync(path.join(process.cwd(), 'src/components/tasks/ItemDetailSheet.tsx'), 'utf8');

class MemoryStorage {
  private items = new Map<string, string>();

  get length(): number {
    return this.items.size;
  }

  clear(): void {
    this.items.clear();
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.items.delete(key);
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value);
  }
}

let store: MemoryStorage;

function withStorage(value: unknown): void {
  (globalThis as unknown as { window?: unknown }).window = value;
}

const PIN = 'https://maps.app.goo.gl/GfEZMWPsWs9gcjPf9?g_st=ic';

beforeEach(() => {
  store = new MemoryStorage();
  withStorage({ localStorage: store });
  resetPlaceCache();
});

describe('a place a link resolved to is remembered', () => {
  it('answers a link it has seen before', () => {
    writePlaceCache(PIN, { name: 'Imagine Cinemas Carlton', latitude: null, longitude: null });
    expect(readPlaceCache(PIN)).toEqual({
      name: 'Imagine Cinemas Carlton',
      latitude: null,
      longitude: null,
    });
  });

  it('says nothing about a link it has never seen', () => {
    expect(readPlaceCache('https://maps.app.goo.gl/never-seen')).toBeNull();
    expect(readPlaceCache('')).toBeNull();
  });

  it('survives a reload, because the point is the next visit', () => {
    writePlaceCache(PIN, { name: 'Imagine Cinemas Carlton', latitude: null, longitude: null });
    // A new page drops the module's memory but keeps the storage.
    resetPlaceCache();
    expect(readPlaceCache(PIN)?.name).toBe('Imagine Cinemas Carlton');
  });

  it('forgets an entry older than a month', () => {
    const now = Date.UTC(2026, 0, 1);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(now);
      writePlaceCache(PIN, { name: 'Old place', latitude: 1, longitude: 2 });
      vi.setSystemTime(now + 31 * 24 * 60 * 60 * 1000);
      expect(readPlaceCache(PIN)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps a well-used device bounded, dropping the oldest first', () => {
    for (let index = 0; index < 205; index += 1) {
      writePlaceCache(`https://maps.app.goo.gl/link-${index}`, {
        name: `Place ${index}`,
        latitude: null,
        longitude: null,
      });
    }
    expect(readPlaceCache('https://maps.app.goo.gl/link-0')).toBeNull();
    expect(readPlaceCache('https://maps.app.goo.gl/link-204')?.name).toBe('Place 204');
  });

  it('starts empty rather than throwing on a store somebody else wrote', () => {
    store.setItem('tasktick.places.v1', '{not json');
    resetPlaceCache();
    expect(readPlaceCache(PIN)).toBeNull();
    // and a write repairs it
    writePlaceCache(PIN, { name: 'Repaired', latitude: null, longitude: null });
    expect(readPlaceCache(PIN)?.name).toBe('Repaired');
  });

  it('falls back to memory when the store is unavailable', () => {
    // A private-mode browser has no usable localStorage; the session still gets
    // the map without a second round trip, and nothing throws.
    withStorage(undefined);
    resetPlaceCache();
    expect(() => writePlaceCache(PIN, { name: 'Nowhere', latitude: null, longitude: null })).not.toThrow();
    expect(readPlaceCache(PIN)?.name).toBe('Nowhere');
    // Nothing survives a reload, which is the whole cost of having no store.
    resetPlaceCache();
    expect(readPlaceCache(PIN)).toBeNull();
  });
});

describe('the sheet resolves a link as it opens, not when asked', () => {
  it('asks the server on mount and keeps the answer', () => {
    expect(SHEET).toContain("api\n      .get<{ place: CachedPlace | null }>('/api/links/resolve'");
    expect(SHEET).toContain('writePlaceCache(preview.href, answer.place)');
    expect(SHEET).toContain('const cached = readPlaceCache(preview.href)');
    expect(SHEET).toContain('useEffect(');
  });

  it('no longer makes the reader ask for the map', () => {
    expect(SHEET).not.toContain('Show map');
    expect(SHEET).not.toContain('Finding the map…');
  });

  it('shows the address and the map, never the raw link, for a maps URL', () => {
    expect(SHEET).toContain('const address = place.name ?? resolved?.name ?? null;');
    expect(SHEET).toContain('<span className="shrink-0 text-muted-foreground">Location</span>');
    expect(SHEET).toContain('mapsEmbedUrl({ name: address })');
    expect(SHEET).toContain('loading="lazy"');
    expect(SHEET).toContain('Finding the address…');
  });
});
