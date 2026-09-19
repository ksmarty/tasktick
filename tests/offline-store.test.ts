/**
 * The read cache's persistence format.
 *
 * What is stored, what is refused, and which stored records may be restored —
 * all pure, because the failure mode this guards against (restoring another
 * session's data, or restoring something that no longer parses) is not something
 * a browser test would catch reliably.
 */
import { describe, expect, it } from 'vitest';
import {
  ENTRY_MAX_AGE_MS,
  decodeEntry,
  encodeEntry,
  isExpired,
  selectHydratable,
  shouldApplyHydrated,
} from '@/lib/offline-store';
import { hashScope, sessionScopeFromPayload, UNVERIFIED_SCOPE } from '@/lib/session-scope';

const NOW = 1_700_000_000_000;

describe('encoding a read', () => {
  it('round-trips a nested payload', () => {
    const data = {
      tasks: [{ id: 'a', title: 'Ünïcodé ✓', tags: ['x', 'y'], done: false, dueAtMs: null }],
      counts: { open: 1, done: 0 },
    };
    const record = encodeEntry({ key: '/api/tasks?window=today', scope: 's1', data, loadedAt: NOW - 5, now: NOW });
    expect(record).not.toBeNull();

    const decoded = decodeEntry(record);
    expect(decoded).not.toBeNull();
    expect(decoded!.data).toEqual(data);
    expect(decoded!.key).toBe('/api/tasks?window=today');
    expect(decoded!.scope).toBe('s1');
    expect(decoded!.loadedAt).toBe(NOW - 5);
  });

  it('stores JSON, so an `undefined` property is dropped rather than fatal', () => {
    const record = encodeEntry({ key: 'k', scope: 's1', data: { a: 1, b: undefined }, now: NOW })!;
    expect(decodeEntry(record)!.data).toEqual({ a: 1 });
  });

  it('refuses what must not be stored, without throwing', () => {
    expect(encodeEntry({ key: 'k', scope: 's1', data: undefined, now: NOW })).toBeNull();
    expect(encodeEntry({ key: '', scope: 's1', data: {}, now: NOW })).toBeNull();
    expect(encodeEntry({ key: 'k', scope: '', data: {}, now: NOW })).toBeNull();

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(encodeEntry({ key: 'k', scope: 's1', data: circular, now: NOW })).toBeNull();

    const huge = { blob: 'x'.repeat(2_000_001) };
    expect(encodeEntry({ key: 'k', scope: 's1', data: huge, now: NOW })).toBeNull();
  });

  it('normalises a nonsense loadedAt to zero', () => {
    const record = encodeEntry({ key: 'k', scope: 's1', data: {}, loadedAt: Number.NaN, now: NOW })!;
    expect(record.loadedAt).toBe(0);
  });
});

describe('decoding a read', () => {
  it('rejects anything that is not a well-formed record', () => {
    expect(decodeEntry(null)).toBeNull();
    expect(decodeEntry('nope')).toBeNull();
    expect(decodeEntry({})).toBeNull();
    expect(decodeEntry({ key: 'k', scope: 's1' })).toBeNull();
    expect(decodeEntry({ key: 'k', scope: 's1', json: '{not json' })).toBeNull();
    expect(decodeEntry({ key: '', scope: 's1', json: '{}' })).toBeNull();
    expect(decodeEntry({ key: 'k', scope: '', json: '{}' })).toBeNull();
  });

  it('accepts a stored null payload, which is a legitimate answer', () => {
    const decoded = decodeEntry({ key: 'k', scope: 's1', json: 'null', loadedAt: 5, savedAt: NOW });
    expect(decoded).not.toBeNull();
    expect(decoded!.data).toBeNull();
  });
});

describe('expiry', () => {
  it('measures age from when the record was written', () => {
    expect(isExpired({ savedAt: NOW }, NOW)).toBe(false);
    expect(isExpired({ savedAt: NOW - ENTRY_MAX_AGE_MS - 1 }, NOW)).toBe(true);
    expect(isExpired({ savedAt: NOW - ENTRY_MAX_AGE_MS + 1 }, NOW)).toBe(false);
  });

  it('treats a record with no timestamp as expired, and a future one as fresh', () => {
    expect(isExpired({}, NOW)).toBe(true);
    expect(isExpired({ savedAt: 'yesterday' }, NOW)).toBe(true);
    // A clock that jumped backwards must not expire everything.
    expect(isExpired({ savedAt: NOW + 60_000 }, NOW)).toBe(false);
  });
});

describe('choosing what to restore', () => {
  const record = (over: Record<string, unknown>) => ({
    key: 'k',
    scope: 's1',
    loadedAt: 0,
    savedAt: NOW,
    json: '{"ok":true}',
    ...over,
  });

  it('restores only this session’s records', () => {
    const restored = selectHydratable(
      [record({ key: 'a', scope: 's1' }), record({ key: 'b', scope: 's2' }), record({ key: 'c', scope: UNVERIFIED_SCOPE })],
      { scope: 's1', now: NOW },
    );
    expect(restored.map((entry) => entry.key)).toEqual(['a']);
  });

  it('accepts the placeholder scope, which is what the first session on a device writes', () => {
    const restored = selectHydratable([record({ scope: UNVERIFIED_SCOPE, key: 'a' })], { scope: UNVERIFIED_SCOPE, now: NOW });
    expect(restored.map((entry) => entry.key)).toEqual(['a']);
  });

  it('drops expired and malformed records', () => {
    const restored = selectHydratable(
      [
        record({ key: 'fresh' }),
        record({ key: 'old', savedAt: NOW - ENTRY_MAX_AGE_MS - 1 }),
        record({ key: 'broken', json: 'not json' }),
        record({ key: 'partial', json: undefined }),
      ],
      { scope: 's1', now: NOW },
    );
    expect(restored.map((entry) => entry.key)).toEqual(['fresh']);
  });

  it('keeps the newest record when a key was stored twice', () => {
    const restored = selectHydratable(
      [record({ key: 'k', json: '{"v":1}', savedAt: NOW - 100 }), record({ key: 'k', json: '{"v":2}', savedAt: NOW })],
      { scope: 's1', now: NOW },
    );
    expect(restored).toHaveLength(1);
    expect(restored[0].data).toEqual({ v: 2 });
  });

  it('never overwrites data this session already fetched', () => {
    const hydrated = { key: 'k', scope: 's1', data: { v: 1 }, loadedAt: 0 };
    expect(shouldApplyHydrated({ data: undefined }, hydrated)).toBe(true);
    expect(shouldApplyHydrated(undefined, hydrated)).toBe(true);
    expect(shouldApplyHydrated({ data: { v: 9 } }, hydrated)).toBe(false);
  });
});

describe('session scope', () => {
  it('hashes a session id into a short, stable, URL-safe scope', () => {
    const scope = hashScope('6P51Rae1jHQyrz3cJvJc0NQ0IZEZgyZW');
    expect(scope).toMatch(/^s[0-9a-f]{8}$/);
    expect(hashScope('6P51Rae1jHQyrz3cJvJc0NQ0IZEZgyZW')).toBe(scope);
    // A different sign-in is a different scope, which is what retires the cache.
    expect(hashScope('something-else')).not.toBe(scope);
  });

  it('reads the session id out of the session payload, falling back to the user', () => {
    expect(sessionScopeFromPayload({ session: { id: 'sess-1' }, user: { id: 'user-1' } })).toBe(hashScope('sess-1'));
    expect(sessionScopeFromPayload({ user: { id: 'user-1' } })).toBe(hashScope('user-1'));
    expect(sessionScopeFromPayload({ session: {}, user: {} })).toBeNull();
    expect(sessionScopeFromPayload(null)).toBeNull();
    expect(sessionScopeFromPayload('nope')).toBeNull();
  });
});
