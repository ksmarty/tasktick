/**
 * A write must drop the service worker's cached copy of the reads it invalidates,
 * and then refetch whatever is on screen.
 *
 * The worker cannot see a write — non-GET requests are never intercepted — so a
 * cache-first read would replay the pre-write body unless the store tells it.
 * The worker end of that wire is pinned in `pwa-sw.test.ts`; this pins the store
 * end, which has three parts and an order:
 *
 *   1. `invalidate(prefix)` posts the prefix and waits for the worker's
 *      acknowledgement.
 *   2. It refetches every mounted resource under the prefix — but only *after*
 *      that acknowledgement, because a refetch that races the drop is answered
 *      from the copy the write just invalidated. That race is what made a habit
 *      check-in and a calendar's eye toggle appear to need a second tap.
 *   3. It touches only what the prefix covers.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { invalidate, registerLoader } from '@/lib/store';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

afterEach(() => {
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
});

interface Post {
  message: unknown;
  transfer: Transferable[];
  acked: boolean;
}

/** Installs a fake worker whose `postMessage` acknowledges on the transferred port. */
function installWorker(ack = true): Post[] {
  const posts: Post[] = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        controller: {
          postMessage(message: unknown, transfer: Transferable[]) {
            const record: Post = { message, transfer, acked: false };
            posts.push(record);
            if (ack) {
              const port = transfer[0] as MessagePort | undefined;
              queueMicrotask(() => {
                record.acked = true;
                port?.postMessage({ ok: true });
              });
            }
          },
        },
        ready: Promise.resolve(null),
      },
    },
  });
  return posts;
}

/**
 * A worker that acknowledges only when told to.
 *
 * The ordering assertion below needs the acknowledgement to be a step the test
 * controls; an automatic one would let the refetch happen before the test can
 * look at the world in between.
 */
function installDeferredWorker(): { posts: Post[]; ack: () => void } {
  const posts: Post[] = [];
  let port: MessagePort | undefined;
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      serviceWorker: {
        controller: {
          postMessage(message: unknown, transfer: Transferable[]) {
            posts.push({ message, transfer, acked: false });
            port = transfer[0] as MessagePort | undefined;
          },
        },
        ready: Promise.resolve(null),
      },
    },
  });
  return { posts, ack: () => port?.postMessage({ ok: true }) };
}

describe('invalidate reaches the worker cache', () => {
  it('posts an invalidate message carrying the prefix', async () => {
    const posts = installWorker();
    await invalidate('/api/tasks');

    expect(posts.map((post) => post.message)).toContainEqual({
      type: 'invalidate',
      prefixes: ['/api/tasks'],
    });
    // The acknowledgement port is what lets the refetch wait for the drop.
    expect(posts[0].transfer).toHaveLength(1);
  });

  it('resolves without a worker, so a refetch is never held hostage', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await expect(invalidate('/api/tasks')).resolves.toBeUndefined();
  });

  it('does not block a forced refetch on an unresponsive worker', async () => {
    // No ack: the promise still settles, because the timeout is the fallback.
    const posts = installWorker(false);
    await expect(invalidate('/api/tasks')).resolves.toBeUndefined();
    expect(posts.length).toBeGreaterThan(0);
  });
});

/**
 * Lets queued microtasks run until `predicate` holds.
 *
 * The message to the worker travels a promise chain (`postQueue`), so the post is
 * not observable in the same tick as the `invalidate` call that asked for it.
 */
async function until(predicate: () => boolean): Promise<boolean> {
  for (let i = 0; i < 50 && !predicate(); i += 1) await Promise.resolve();
  return predicate();
}

describe('invalidate refetches what is on screen', () => {
  it('wakes a mounted loader, and only after the worker has dropped its copy', async () => {
    const worker = installDeferredWorker();
    const forces: boolean[] = [];
    const unregister = registerLoader('/api/habits', (force) => {
      forces.push(force);
    });

    try {
      const settled = invalidate('/api/habits');

      // The drop has been asked for but not acknowledged. Refetching now would
      // be answered from the copy the worker still holds, which is the race that
      // made the second tap necessary.
      await until(() => worker.posts.length > 0);
      expect(worker.posts).toHaveLength(1);
      expect(forces).toEqual([]);

      worker.ack();
      await settled;

      // Forced, so a fresh-enough `loadedAt` cannot make the refetch a no-op.
      expect(forces).toEqual([true]);
    } finally {
      unregister();
    }
  });

  it('leaves a resource outside the prefix alone', async () => {
    installWorker();
    const forces: boolean[] = [];
    const unregister = registerLoader('/api/tasks', (force) => {
      forces.push(force);
    });

    try {
      await invalidate('/api/habits');
      expect(forces).toEqual([]);
    } finally {
      unregister();
    }
  });

  it('accepts a list of prefixes, so one call can cover a task write', async () => {
    const posts = installWorker();
    const seen: boolean[] = [];
    const unregister = registerLoader('/api/bootstrap', (force) => {
      seen.push(force);
    });

    try {
      await invalidate(['/api/tasks', '/api/bootstrap']);
      expect(posts[0].message).toEqual({ type: 'invalidate', prefixes: ['/api/tasks', '/api/bootstrap'] });
      expect(seen).toEqual([true]);
    } finally {
      unregister();
    }
  });
});
