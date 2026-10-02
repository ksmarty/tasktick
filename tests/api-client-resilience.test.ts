/**
 * What the client does when the network is *present but useless*.
 *
 * `navigator.onLine` cannot see this. Handing a phone from Wi-Fi to cellular
 * leaves the flag `true` while the socket that was open on the old interface is
 * dead, and a dead socket hangs rather than refuses: the request sits there until
 * the browser's own timeout decides, tens of seconds later, with the screen
 * showing nothing. These tests pin the two things that stop that — the ceiling
 * that turns a hang into a network failure the offline layer already handles, and
 * the short-circuit that stops re-learning a network is gone on every later tap.
 *
 * The queue is mocked rather than exercised. `api-client.ts` refuses to queue at
 * all when `indexedDB` is missing, which is the case in node, and a fake
 * `indexedDB` would have to satisfy the real one's open/migrate path to say
 * anything. Asserting that the write was *handed to* the queue is the boundary
 * this file cares about; what the queue then does with it is
 * `tests/offline-queue.test.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api-client';
import { __resetNetworkHealthForTests, isReachable, reportUnreachable } from '@/lib/network-health';

const { enqueueWrite } = vi.hoisted(() => ({ enqueueWrite: vi.fn() }));

vi.mock('@/lib/offline-queue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/offline-queue')>();
  return { ...actual, enqueueWrite };
});

/** A fetch that never answers until it is aborted. */
function hangingFetch() {
  return vi.fn(
    (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
}

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
}

beforeEach(() => {
  __resetNetworkHealthForTests();
  /*
   * `api-client.ts` refuses to queue at all without `indexedDB` — a browser that
   * has denied storage must not be told its write was kept. Nothing here reaches
   * a real database (`enqueueWrite` is mocked), so a truthy stand-in is enough to
   * get past that guard and observe the hand-off.
   */
  vi.stubGlobal('indexedDB', {});
  enqueueWrite.mockReset();
  enqueueWrite.mockImplementation(async ({ method, path, body }: { method: string; path: string; body: unknown }) => ({
    entry: { id: 'q1', method, path, body },
    result: { id: 'temp:q1' },
  }));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a request that hangs', () => {
  it('is abandoned at the ceiling and handed to the queue, not left on screen', async () => {
    vi.useFakeTimers();
    const fetchMock = hangingFetch();
    vi.stubGlobal('fetch', fetchMock);

    const pending = api.post('/api/tasks', { title: 'Handed over mid-request' });

    // Still waiting one millisecond before the ceiling: the point is that it does
    // not wait forever, not that it gives up early.
    await vi.advanceTimersByTimeAsync(2_999);
    expect(enqueueWrite).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(pending).resolves.toEqual({ id: 'temp:q1' });
    expect(enqueueWrite).toHaveBeenCalledTimes(1);
    expect(enqueueWrite.mock.calls[0][0]).toMatchObject({ method: 'POST', path: '/api/tasks' });
  });

  it('is bounded only where the queue could take it', async () => {
    // A CalDAV sync, an import or a feed refresh can legitimately take many
    // seconds, and there is nothing to hand one to — aborting would report a
    // failure for work the server may still be finishing.
    const fetchMock = jsonFetch({ ok: true, data: { imported: 3 } });
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/api/import/ticktick', { uploadId: 'x' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].signal).toBeUndefined();
  });

  it('is bounded when it is queueable, which is what makes the ceiling safe', async () => {
    const fetchMock = jsonFetch({ ok: true, data: { id: 't1' } });
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/api/tasks', { title: 'A' });

    expect(fetchMock.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('a network already known to be unusable', () => {
  it('queues a queueable write without a round trip', async () => {
    reportUnreachable();
    const fetchMock = jsonFetch({ ok: true, data: {} });
    vi.stubGlobal('fetch', fetchMock);

    // This is the difference between surviving a bad network and *feeling* like
    // offline mode: spending the ceiling again to re-learn what the last request
    // already established would put a spinner on screen for every tap.
    await expect(api.post('/api/tasks', { title: 'Queued at once' })).resolves.toEqual({ id: 'temp:q1' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(enqueueWrite).toHaveBeenCalledTimes(1);
  });

  it('still tries a read, because the cache answers it and it re-probes the network', async () => {
    reportUnreachable();
    const fetchMock = jsonFetch({ ok: true, data: [{ id: 't1' }] });
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/api/tasks')).resolves.toEqual([{ id: 't1' }]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    // A response is evidence the origin is up, whatever its status.
    expect(isReachable()).toBe(true);
  });

  it('does not queue a write the queue could never take', async () => {
    reportUnreachable();
    const fetchMock = jsonFetch({ ok: true, data: { sent: true } });
    vi.stubGlobal('fetch', fetchMock);

    await api.post('/api/import/ticktick', {});

    // Not queueable, so it still goes to the network rather than being silently
    // dropped into a queue that would refuse it.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(enqueueWrite).not.toHaveBeenCalled();
  });
});

describe('what a response says about the network', () => {
  it('reads a thrown fetch as unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(api.get('/api/tasks')).rejects.toThrow();
    expect(isReachable()).toBe(false);
  });

  it('reads any real HTTP status as reached, including a 500', async () => {
    reportUnreachable();
    vi.stubGlobal('fetch', jsonFetch({ ok: false, error: 'boom' }, 500));

    await expect(api.get('/api/tasks')).rejects.toThrow();
    // The server was reached and answered; a broken server must not be mistaken
    // for no network, or the app would stop retrying a fixable problem.
    expect(isReachable()).toBe(true);
  });

  it('reads the worker’s synthetic 503 as unreachable, not as a server answer', async () => {
    // `offlineResponse` in public/sw.js: the worker could not reach the origin.
    vi.stubGlobal('fetch', jsonFetch({ ok: false, offline: true, error: 'The server is unreachable.' }, 503));

    await expect(api.get('/api/tasks')).rejects.toThrow();
    expect(isReachable()).toBe(false);
  });

  it('reads a plain 503 as reached, so a real outage is not mistaken for no network', async () => {
    reportUnreachable();
    vi.stubGlobal('fetch', jsonFetch({ ok: false, error: 'Service unavailable' }, 503));

    await expect(api.get('/api/tasks')).rejects.toThrow();
    expect(isReachable()).toBe(true);
  });
});
