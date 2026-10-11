import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A cold start must show the previous session's reads immediately.
 *
 * The reads the last session persisted are only restored once a scope is
 * announced (`onScopeEvent` → `hydrateCache` in `src/lib/store.ts`), and the
 * handshake that decides the live scope is a network round trip. When `runInit`
 * announced the scope only *after* awaiting it, every cold start painted
 * skeletons for as long as the server took — while the answer was already on
 * disk. These tests pin the order: the stored scope is adopted and announced
 * first, and the handshake only gets to change that afterwards.
 */

const db = vi.hoisted(() => ({
  get: vi.fn(),
  getAll: vi.fn(),
  put: vi.fn(),
  clear: vi.fn(),
}));

const persisted = vi.hoisted(() => ({
  clearPersistedEntries: vi.fn(),
  clearQueue: vi.fn(),
  resumeQueue: vi.fn(),
  startQueuePump: vi.fn(),
}));

vi.mock('@/lib/offline-db', () => ({
  ENTRY_STORE: 'entries',
  META_STORE: 'meta',
  idbGet: (...args: unknown[]) => db.get(...args),
  idbGetAll: (...args: unknown[]) => db.getAll(...args),
  idbPut: (...args: unknown[]) => db.put(...args),
  idbClear: (...args: unknown[]) => db.clear(...args),
}));

vi.mock('@/lib/offline-store', () => ({
  clearPersistedEntries: persisted.clearPersistedEntries,
}));

vi.mock('@/lib/offline-queue', () => ({
  clearQueue: persisted.clearQueue,
  resumeQueue: persisted.resumeQueue,
  startQueuePump: persisted.startQueuePump,
}));

import {
  UNVERIFIED_SCOPE,
  __resetSessionScopeForTests,
  currentSessionScope,
  ensureOfflineSupport,
  hashScope,
  onScopeEvent,
  type ScopeEvent,
} from '@/lib/session-scope';

const SCOPE_META_KEY = 'session-scope';

/** Lets the pending microtasks in `runInit` run without releasing the fetch. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

function sessionResponse(id: string) {
  return { ok: true, json: async () => ({ session: { id }, user: { id: 'user-1' } }) };
}

/** A handshake we control: nothing happens until `release()` is called. */
function pendingHandshake() {
  let release: (value: unknown) => void = () => {};
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  vi.stubGlobal('fetch', vi.fn(() => promise));
  return release;
}

let events: ScopeEvent[] = [];
let unwatchers: Array<() => void> = [];

beforeEach(() => {
  events = [];
  unwatchers = [];
  db.get.mockReset().mockResolvedValue(null);
  db.getAll.mockReset().mockResolvedValue([]);
  db.put.mockReset().mockResolvedValue(undefined);
  db.clear.mockReset().mockResolvedValue(undefined);
  persisted.clearPersistedEntries.mockReset().mockResolvedValue(undefined);
  persisted.clearQueue.mockReset().mockResolvedValue(undefined);
  persisted.resumeQueue.mockReset();
  persisted.startQueuePump.mockReset();
  /*
   * `runInit` is a browser-only path: it reads `window.location` to tell the
   * worker which document to keep. `navigator` stays absent, so the worker
   * messages resolve immediately instead of waiting for a worker that is not
   * there.
   */
  vi.stubGlobal('window', { location: { href: 'http://localhost/tasks' } });
  __resetSessionScopeForTests();
});

afterEach(() => {
  for (const unwatch of unwatchers) unwatch();
  vi.unstubAllGlobals();
  __resetSessionScopeForTests();
});

function watch(): void {
  unwatchers.push(onScopeEvent((event) => events.push(event)));
}

describe('a cold start with a stored scope', () => {
  it('announces the stored scope before the handshake resolves', async () => {
    const stored = hashScope('previous-sign-in');
    db.get.mockResolvedValue({ key: SCOPE_META_KEY, value: stored });
    const release = pendingHandshake();
    watch();

    const init = ensureOfflineSupport();
    await settle();

    // The handshake is still in flight — and the restore has already been told
    // which scope the on-disk reads belong to.
    expect(events).toEqual([{ type: 'resolved', scope: stored }]);
    expect(currentSessionScope()).toBe(stored);

    release(sessionResponse('previous-sign-in'));
    await init;
    // The same session: re-tagging and re-announcing is all that is left.
    expect(events).toEqual([
      { type: 'resolved', scope: stored },
      { type: 'resolved', scope: stored },
    ]);
  });

  it('keeps the stored scope when the handshake fails', async () => {
    const stored = hashScope('previous-sign-in');
    db.get.mockResolvedValue({ key: SCOPE_META_KEY, value: stored });
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('offline'))));
    watch();

    await ensureOfflineSupport();

    expect(events).toEqual([{ type: 'resolved', scope: stored }]);
    expect(currentSessionScope()).toBe(stored);
    expect(persisted.clearPersistedEntries).not.toHaveBeenCalled();
  });

  it('re-tags reads written under the placeholder scope, then resolves to the live scope', async () => {
    const stored = hashScope('previous-sign-in');
    const live = hashScope('previous-sign-in');
    db.get.mockResolvedValue({ key: SCOPE_META_KEY, value: stored });
    db.getAll.mockResolvedValue([
      { key: '/api/calendar/items?x', scope: UNVERIFIED_SCOPE },
      { key: '/api/tasks', scope: stored },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => sessionResponse('previous-sign-in')));
    watch();

    await ensureOfflineSupport();

    expect(db.put).toHaveBeenCalledWith('entries', { key: '/api/calendar/items?x', scope: live });
    expect(db.put).toHaveBeenCalledWith('meta', { key: SCOPE_META_KEY, value: live });
    expect(events.at(-1)).toEqual({ type: 'resolved', scope: live });
    expect(persisted.startQueuePump).toHaveBeenCalled();
  });

  it('purges and announces the change when a different session signed in', async () => {
    const stored = hashScope('previous-sign-in');
    const live = hashScope('someone-else');
    db.get.mockResolvedValue({ key: SCOPE_META_KEY, value: stored });
    vi.stubGlobal('fetch', vi.fn(async () => sessionResponse('someone-else')));
    watch();

    await ensureOfflineSupport();

    expect(events).toEqual([
      { type: 'resolved', scope: stored },
      { type: 'changed', from: stored, to: live },
    ]);
    expect(currentSessionScope()).toBe(live);
    expect(persisted.clearPersistedEntries).toHaveBeenCalled();
    expect(persisted.clearQueue).toHaveBeenCalled();
  });

  it('adopts the placeholder scope without waiting when nothing is stored', async () => {
    const live = hashScope('sess-1');
    const release = pendingHandshake();
    watch();

    const init = ensureOfflineSupport();
    await settle();

    // Nothing to restore, and the placeholder is what reads are already tagged
    // with — so there is no event, only the handshake left to decide.
    expect(events).toEqual([]);
    expect(currentSessionScope()).toBeNull();
    expect(persisted.startQueuePump).not.toHaveBeenCalled();

    release(sessionResponse('sess-1'));
    await init;

    expect(events).toEqual([{ type: 'resolved', scope: live }]);
    expect(currentSessionScope()).toBe(live);
  });
});
