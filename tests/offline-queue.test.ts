/**
 * The offline queue's rules, and the replay loop that applies them.
 *
 * These are the decisions a user's data depends on: what order writes replay in,
 * which failures are worth retrying, which are not, and how the same write is
 * prevented from happening twice. They are pure functions plus one loop over
 * them, so they are tested here directly rather than through a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetQueueForTests,
  affectsFor,
  applyTempIdMap,
  classifyStatus,
  enqueueWrite,
  flushQueue,
  isQueueable,
  isSameWrite,
  orderQueue,
  pendingAffects,
  pendingCount,
  queuedResult,
  readyForReplay,
  retryDelayMs,
  rewriteEntryTempIds,
  stableStringify,
  stopQueuePump,
  subscribeQueue,
  type QueuedMutation,
} from '@/lib/offline-queue';

function entry(overrides: Partial<QueuedMutation> = {}): QueuedMutation {
  return {
    id: 'a',
    seq: 1,
    method: 'POST',
    path: '/api/tasks',
    body: { title: 'Write me' },
    createdAt: 0,
    attempts: 0,
    nextAttemptAt: 0,
    affects: ['/api/tasks'],
    ...overrides,
  };
}

beforeEach(() => {
  __resetQueueForTests();
  stopQueuePump();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('what may be queued', () => {
  it('accepts the app’s own write endpoints', () => {
    for (const path of [
      '/api/tasks',
      '/api/tasks/abc/complete',
      '/api/tasks/bulk',
      '/api/lists',
      '/api/tags',
      '/api/habits/abc/checkin',
      '/api/events',
      '/api/calendars/abc',
      '/api/settings',
      '/api/focus/abc',
    ]) {
      expect(isQueueable('POST', path), path).toBe(true);
    }
  });

  it('refuses reads, and endpoints a queued write could not honestly answer', () => {
    expect(isQueueable('GET', '/api/tasks')).toBe(false);
    expect(isQueueable('HEAD', '/api/tasks')).toBe(false);
    expect(isQueueable('POST', '/api/auth/sign-out')).toBe(false);
    expect(isQueueable('POST', '/api/export')).toBe(false);
    // A probe: its whole value is the answer it gives now.
    expect(isQueueable('POST', '/api/settings/apprise/test')).toBe(false);
    expect(isQueueable('POST', '/api/caldav/accounts/abc/sync')).toBe(false);
    expect(isQueueable('POST', '/api/nonsense')).toBe(false);
  });

  it('maps a write onto the reads it invalidates', () => {
    expect(affectsFor('POST', '/api/tasks')).toEqual(['/api/tasks', '/api/bootstrap', '/api/calendar/items', '/api/lists']);
    expect(affectsFor('PATCH', '/api/tasks/abc?verbose=1')).toEqual([
      '/api/tasks',
      '/api/bootstrap',
      '/api/calendar/items',
      '/api/lists',
    ]);
    expect(affectsFor('PATCH', '/api/habits/abc')).toEqual(['/api/habits', '/api/stats', '/api/bootstrap']);
    // An unknown endpoint still invalidates itself.
    expect(affectsFor('POST', '/api/whatever?x=1')).toEqual(['/api/whatever']);
  });

  it('holds exactly the reads a pending write invalidates', async () => {
    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });
    expect(pendingAffects('/api/tasks')).toBe(true);
    expect(pendingAffects('/api/tasks?window=today')).toBe(true);
    expect(pendingAffects('/api/tasks/abc')).toBe(true);
    expect(pendingAffects('/api/bootstrap')).toBe(true);
    expect(pendingAffects('/api/calendar/items?from=1')).toBe(true);
    expect(pendingAffects('/api/habits')).toBe(false);
    expect(pendingAffects('/api/tasks-archive')).toBe(false);
  });
});

describe('replay order', () => {
  it('is oldest-first by sequence, not by insertion into an array', () => {
    const queued = [entry({ id: 'c', seq: 3 }), entry({ id: 'a', seq: 1 }), entry({ id: 'b', seq: 2 })];
    expect(orderQueue(queued).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('breaks a tie deterministically, so two tabs agree', () => {
    const queued = [entry({ id: 'b', seq: 1 }), entry({ id: 'a', seq: 1 })];
    expect(orderQueue(queued).map((item) => item.id)).toEqual(['a', 'b']);
  });

  it('skips an entry that is leased or backing off', () => {
    const now = 1000;
    expect(readyForReplay(entry({ nextAttemptAt: 0 }), now)).toBe(true);
    expect(readyForReplay(entry({ nextAttemptAt: now + 1 }), now)).toBe(false);
    expect(readyForReplay(entry({ leaseUntil: now + 1 }), now)).toBe(false);
    expect(readyForReplay(entry({ leaseUntil: now - 1 }), now)).toBe(true);
  });
});

describe('de-duplication', () => {
  it('matches the same write regardless of key order in the body', () => {
    expect(isSameWrite({ method: 'POST', path: '/api/tasks', body: { a: 1, b: 2 } }, { method: 'POST', path: '/api/tasks', body: { b: 2, a: 1 } })).toBe(
      true,
    );
  });

  it('does not match a different method, path or body', () => {
    const base = { method: 'POST', path: '/api/tasks', body: { title: 'A' } };
    expect(isSameWrite(base, { ...base, method: 'PATCH' })).toBe(false);
    expect(isSameWrite(base, { ...base, path: '/api/tasks/1' })).toBe(false);
    expect(isSameWrite(base, { ...base, body: { title: 'B' } })).toBe(false);
    expect(isSameWrite(base, { ...base, body: undefined })).toBe(false);
  });

  it('queues an identical write once', async () => {
    const first = await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });
    const second = await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });

    expect(second.deduplicated).toBe(true);
    expect(second.entry.id).toBe(first.entry.id);
    expect(pendingCount()).toBe(1);
  });

  it('keeps two different writes apart', async () => {
    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });
    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'B' } });
    expect(pendingCount()).toBe(2);
  });

  it('sends the entry id as the idempotency key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true, data: { id: 'real-1' } }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const { entry: queued } = await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });
    await flushQueue();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/tasks');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Idempotency-Key']).toBe(queued.id);
  });
});

describe('retry classification', () => {
  it('treats the network, rate limits and server faults as retryable', () => {
    for (const status of [0, 408, 425, 429, 500, 502, 503]) {
      expect(classifyStatus(status), String(status)).toBe('retry');
    }
  });

  it('treats a rejected request as final', () => {
    for (const status of [400, 403, 404, 409, 413, 422]) {
      expect(classifyStatus(status), String(status)).toBe('drop');
    }
  });

  it('pauses on an expired session rather than discarding the work', () => {
    expect(classifyStatus(401)).toBe('auth');
  });

  it('accepts every 2xx', () => {
    expect(classifyStatus(200)).toBe('success');
    expect(classifyStatus(201)).toBe('success');
    expect(classifyStatus(204)).toBe('success');
  });

  it('backs off exponentially, with a ceiling and jitter', () => {
    const noJitter = () => 0;
    expect(retryDelayMs(1, noJitter)).toBe(1000);
    expect(retryDelayMs(2, noJitter)).toBe(2000);
    expect(retryDelayMs(3, noJitter)).toBe(4000);
    expect(retryDelayMs(20, noJitter)).toBe(60_000);
    // Jitter adds at most 20% and never exceeds the ceiling.
    expect(retryDelayMs(1, () => 1)).toBe(1200);
    expect(retryDelayMs(20, () => 1)).toBe(60_000);
  });
});

describe('replaying', () => {
  it('sends queued writes in order, one at a time', async () => {
    const sent: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        sent.push(`${init.method} ${url} ${String(init.body)}`);
        return new Response(JSON.stringify({ ok: true, data: { id: `real-${sent.length}` } }), { status: 200 });
      }),
    );

    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });
    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'B' } });
    await enqueueWrite({ method: 'POST', path: '/api/tasks/reorder', body: { orderedIds: ['1', '2'] } });

    const report = await flushQueue();

    expect(report).toEqual({ synced: 3, failed: 0, retried: 0, skipped: false });
    expect(sent).toEqual([
      'POST /api/tasks {"title":"A"}',
      'POST /api/tasks {"title":"B"}',
      'POST /api/tasks/reorder {"orderedIds":["1","2"]}',
    ]);
    expect(pendingCount()).toBe(0);
  });

  it('stops the pass on a retryable failure and keeps everything', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        return new Response(JSON.stringify({ ok: false, error: 'boom' }), { status: 503 });
      }),
    );

    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });
    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'B' } });

    const report = await flushQueue();

    expect(report.retried).toBe(1);
    expect(report.synced).toBe(0);
    // The second write was never sent: it may depend on the first.
    expect(urls).toEqual(['/api/tasks']);
    expect(pendingCount()).toBe(2);
  });

  it('drops a write the server rejects, and reports it', async () => {
    const failures: string[] = [];
    subscribeQueue((event) => {
      if (event.type === 'failed') failures.push(`${event.status}`);
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'That list does not exist.' }), { status: 422 })),
    );

    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });
    const report = await flushQueue();

    expect(report.failed).toBe(1);
    expect(report.retried).toBe(0);
    expect(pendingCount()).toBe(0);
    expect(failures).toEqual(['422']);
  });

  it('pauses on 401 and resumes on demand', async () => {
    let status = 401;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ok: false, error: 'signed out' }), { status })),
    );

    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'A' } });
    await flushQueue();

    // Kept, paused, and not retried while the session is gone.
    expect(pendingCount()).toBe(1);
    expect((await flushQueue()).skipped).toBe(true);

    status = 200;
    const { resumeQueue } = await import('@/lib/offline-queue');
    resumeQueue();
    await vi.waitFor(() => expect(pendingCount()).toBe(0));
  });

  it('renames a temporary id everywhere it was referenced', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit) => {
        bodies.push(`${init.method} ${url} ${String(init.body ?? '')}`);
        if (init.method === 'POST' && url === '/api/lists') {
          return new Response(JSON.stringify({ ok: true, data: { id: 'real-list-1' } }), { status: 200 });
        }
        return new Response(JSON.stringify({ ok: true, data: { id: 'real-task-1' } }), { status: 200 });
      }),
    );

    const list = await enqueueWrite({ method: 'POST', path: '/api/lists', body: { name: 'Groceries' } });
    const tempListId = list.entry.tempId!;
    expect(tempListId).toMatch(/^temp:/);

    await enqueueWrite({ method: 'POST', path: '/api/tasks', body: { title: 'Milk', listId: tempListId } });
    await enqueueWrite({ method: 'PATCH', path: `/api/tasks/${tempListId}`, body: { isPinned: true } });

    await flushQueue();

    // The list is created first, then both references carry its real id.
    expect(bodies[0]).toBe('POST /api/lists {"name":"Groceries"}');
    expect(bodies[1]).toBe('POST /api/tasks {"title":"Milk","listId":"real-list-1"}');
    expect(bodies[2]).toBe('PATCH /api/tasks/real-list-1 {"isPinned":true}');
  });

  it('rewrites only an exact temporary id, never a substring of one', () => {
    const map = new Map([['temp:abc', 'real-1']]);
    expect(applyTempIdMap({ id: 'temp:abc', other: 'prefix-temp:abc-suffix', list: ['temp:abc'] }, map)).toEqual({
      id: 'real-1',
      other: 'prefix-temp:abc-suffix',
      list: ['real-1'],
    });
    expect(rewriteEntryTempIds({ path: '/api/tasks/temp:abc', body: { parentId: 'temp:abc' } }, map)).toEqual({
      path: '/api/tasks/real-1',
      body: { parentId: 'real-1' },
    });
  });

  it('leaves the pass alone when there is nothing to send', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await flushQueue()).toEqual({ synced: 0, failed: 0, retried: 0, skipped: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('what a queued write hands back to its caller', () => {
  it('never resolves to undefined, so an optimistic update is not rolled back', () => {
    expect(queuedResult('DELETE', '/api/tasks/1', undefined, undefined)).toMatchObject({ deleted: true, queued: true });
    expect(queuedResult('POST', '/api/tasks/1/complete', undefined, undefined)).toEqual({
      task: null,
      recurred: false,
      queued: true,
    });
    expect(queuedResult('POST', '/api/tasks/bulk', { ids: ['1', '2'] }, undefined)).toMatchObject({ affected: 2 });
    expect(queuedResult('POST', '/api/tasks/reorder', { orderedIds: ['1'] }, undefined)).toMatchObject({ reordered: 1 });
  });

  it('is renderable: a created task carries every field the row renderer reads', () => {
    const result = queuedResult('POST', '/api/tasks', { title: 'Milk', listId: null }, 'temp:1') as Record<string, unknown>;
    expect(result).toMatchObject({
      id: 'temp:1',
      title: 'Milk',
      status: 'todo',
      priority: 'none',
      dueAtMs: null,
      dueDate: null,
      isAllDay: false,
      isPinned: false,
      queued: true,
    });
  });

  it('keeps the submitted fields but never lets them overwrite the identity', () => {
    const result = queuedResult('PATCH', '/api/tasks/real-1', { title: 'Renamed', id: 'server-said-so' }, undefined) as Record<
      string,
      unknown
    >;
    expect(result.id).toBe('real-1');
    expect(result.title).toBe('Renamed');
  });
});

describe('stable stringify', () => {
  it('is key-order independent and survives a circular body', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(stableStringify(circular)).toBe('');
    expect(stableStringify(undefined)).toBe('');
  });
});
