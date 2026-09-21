/**
 * A write must drop the service worker's cached copy of the reads it invalidates.
 *
 * The worker cannot see a write — non-GET requests are never intercepted — so a
 * cache-first read would replay the pre-write body unless the store tells it.
 * The worker end of that wire is pinned in `pwa-sw.test.ts`; this pins the store
 * end: that `invalidate(prefix)` posts the prefix, and that it waits for the
 * worker's acknowledgement so a forced refetch cannot race the drop.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { invalidate, revalidate } from '@/lib/store';

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

describe('invalidate reaches the worker cache', () => {
  it('posts an invalidate message carrying the prefix', async () => {
    const posts = installWorker();
    await invalidate('/api/tasks');

    expect(posts.map((post) => post.message)).toContainEqual({
      type: 'invalidate',
      prefixes: ['/api/tasks'],
    });
    // The acknowledgement port is what lets `revalidate` wait for the drop.
    expect(posts[0].transfer).toHaveLength(1);
  });

  it('resolves without a worker, so a refetch is never held hostage', async () => {
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
    await expect(invalidate('/api/tasks')).resolves.toBeUndefined();
  });

  it('does not block a forced refetch on an unresponsive worker', async () => {
    // No ack: the promise still settles, because the timeout is the fallback.
    const posts = installWorker(false);
    await expect(revalidate('/api/tasks')).resolves.toBeUndefined();
    expect(posts.length).toBeGreaterThan(0);
  });});
