/**
 * The Web Push sender.
 *
 * Nothing here touches the network, a VAPID key or a browser: the subscription
 * list and the transport are both injected, the same way `settings-apprise.test.ts`
 * scripts its `fetchImpl`. The three contracts that matter are that a stale
 * subscription is deleted, that a transient failure is *not* deleted, and that
 * no outcome — including a transport that rejects — escapes as a thrown error
 * into the reminder loop.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildWebPushPayload,
  isWebPushLoaded,
  loadWebPush,
  resetWebPushCache,
  sendWebPush,
  WEB_PUSH_TIMEOUT_MS,
  type WebPushModule,
  type WebPushTarget,
  type WebPushTransport,
} from '@/server/services/web-push';
import type { NotificationPayload } from '@/server/services/notifications';
import { resetEnvCache } from '@/lib/env';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { pushSubscriptions, user } from '@/server/db/schema';

const PAYLOAD: NotificationPayload = { title: 'Task due', body: 'Buy milk', type: 'info' };

const TARGET: WebPushTarget = {
  endpoint: 'https://push.example.com/one',
  p256dh: 'p256dh-one',
  auth: 'auth-one',
};

interface SentPush {
  endpoint: string;
  payload: string;
  timeoutMs: number;
}

/** What the transport should answer with: a status, or a rejection. */
type Outcome = { statusCode: number } | { throw: Error | unknown };

/** Scripted deps that record everything the sender does to the rows. */
function makeDeps(targets: WebPushTarget[], respond: (target: WebPushTarget) => Outcome) {
  const listed: string[] = [];
  const sent: SentPush[] = [];
  const used: string[] = [];
  const failed: string[] = [];
  const removed: string[] = [];

  const sendNotification: WebPushTransport = async (subscription, payload, timeoutMs) => {
    sent.push({ endpoint: subscription.endpoint, payload, timeoutMs });
    const outcome = respond(subscription);
    if ('throw' in outcome) throw outcome.throw;
    return outcome;
  };

  const deps = {
    isConfigured: () => true,
    listSubscriptions: async (userId: string) => {
      listed.push(userId);
      return targets;
    },
    sendNotification,
    markUsed: async (_userId: string, endpoint: string) => {
      used.push(endpoint);
    },
    recordFailure: async (_userId: string, endpoint: string) => {
      failed.push(endpoint);
    },
    removeSubscription: async (_userId: string, endpoint: string) => {
      removed.push(endpoint);
    },
  };

  return { deps, listed, sent, used, failed, removed };
}

/** The rejection shape `web-push` produces for a non-2xx push service answer. */
function pushError(statusCode: number): Error {
  return Object.assign(new Error(`push service responded ${statusCode}`), { statusCode });
}

function target(endpoint: string): WebPushTarget {
  return { endpoint, p256dh: `${endpoint}-key`, auth: `${endpoint}-auth` };
}

beforeEach(() => {
  resetWebPushCache();
});

afterEach(() => {
  resetWebPushCache();
});

describe('buildWebPushPayload', () => {
  it('emits exactly the keys public/sw.js renders', () => {
    expect(JSON.parse(buildWebPushPayload(PAYLOAD))).toEqual({
      title: 'Task due',
      body: 'Buy milk',
      tag: 'tasktick',
      url: '/',
    });
  });

  it('omits the Apprise-only type, which the worker has no path for', () => {
    expect(JSON.parse(buildWebPushPayload(PAYLOAD))).not.toHaveProperty('type');
  });
});

describe('sendWebPush', () => {
  it('counts one delivery and stamps the row as used', async () => {
    const { deps, listed, sent, used, failed, removed } = makeDeps([TARGET], () => ({ statusCode: 201 }));

    const result = await sendWebPush('user-1', PAYLOAD, deps);

    expect(result).toEqual({ attempted: true, delivered: 1, pruned: 0, failed: 0 });
    expect(listed).toEqual(['user-1']);
    expect(sent).toEqual([
      { endpoint: TARGET.endpoint, payload: buildWebPushPayload(PAYLOAD), timeoutMs: WEB_PUSH_TIMEOUT_MS },
    ]);
    expect(used).toEqual([TARGET.endpoint]);
    expect(failed).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('does nothing at all when Web Push is not configured', async () => {
    const { deps, listed, sent } = makeDeps([TARGET], () => ({ statusCode: 201 }));

    const result = await sendWebPush('user-1', PAYLOAD, { ...deps, isConfigured: () => false });

    expect(result).toEqual({ attempted: false, delivered: 0, pruned: 0, failed: 0, error: 'not-configured' });
    expect(listed).toEqual([]);
    expect(sent).toEqual([]);
    expect(isWebPushLoaded()).toBe(false);
  });

  it('does not load web-push or list rows when the VAPID keys are absent', async () => {
    // The ambient shell may happen to define these; remove them for this case
    // rather than assuming an unconfigured machine.
    const savedPublic = process.env.VAPID_PUBLIC_KEY;
    const savedPrivate = process.env.VAPID_PRIVATE_KEY;
    delete process.env.VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;
    resetEnvCache();
    let loads = 0;

    try {
      const result = await sendWebPush('user-1', PAYLOAD, {
        loadWebPush: async () => {
          loads += 1;
          throw new Error('web-push must not be loaded without VAPID keys');
        },
        listSubscriptions: async () => [TARGET],
      });

      expect(result).toEqual({ attempted: false, delivered: 0, pruned: 0, failed: 0, error: 'not-configured' });
      expect(loads).toBe(0);
      expect(isWebPushLoaded()).toBe(false);
    } finally {
      if (savedPublic === undefined) delete process.env.VAPID_PUBLIC_KEY;
      else process.env.VAPID_PUBLIC_KEY = savedPublic;
      if (savedPrivate === undefined) delete process.env.VAPID_PRIVATE_KEY;
      else process.env.VAPID_PRIVATE_KEY = savedPrivate;
      resetEnvCache();
    }
  });

  it('reports a user with no devices as nothing attempted, with a reason', async () => {
    const { deps, sent } = makeDeps([], () => ({ statusCode: 201 }));

    const result = await sendWebPush('user-1', PAYLOAD, deps);

    expect(result).toEqual({ attempted: false, delivered: 0, pruned: 0, failed: 0, error: 'no-subscriptions' });
    expect(sent).toEqual([]);
  });

  it('prunes the row on 410, the push service saying the subscription is gone', async () => {
    const { deps, used, failed, removed } = makeDeps([TARGET], () => ({ throw: pushError(410) }));

    const result = await sendWebPush('user-1', PAYLOAD, deps);

    expect(result).toEqual({ attempted: true, delivered: 0, pruned: 1, failed: 0 });
    expect(removed).toEqual([TARGET.endpoint]);
    expect(used).toEqual([]);
    expect(failed).toEqual([]);
  });

  it('prunes the row on 404 as well', async () => {
    const { deps, removed } = makeDeps([TARGET], () => ({ throw: pushError(404) }));

    const result = await sendWebPush('user-1', PAYLOAD, deps);

    expect(result).toEqual({ attempted: true, delivered: 0, pruned: 1, failed: 0 });
    expect(removed).toEqual([TARGET.endpoint]);
  });

  it('keeps the row and back off on 500', async () => {
    const { deps, used, failed, removed } = makeDeps([TARGET], () => ({ throw: pushError(500) }));

    const result = await sendWebPush('user-1', PAYLOAD, deps);

    expect(result).toEqual({ attempted: true, delivered: 0, pruned: 0, failed: 1 });
    expect(failed).toEqual([TARGET.endpoint]);
    expect(used).toEqual([]);
    expect(removed).toEqual([]);
  });

  it('keeps the row on a rejection with no status, which is a socket problem not a gone device', async () => {
    const { deps, failed, removed } = makeDeps([TARGET], () => ({ throw: new Error('ECONNREFUSED') }));

    const result = await sendWebPush('user-1', PAYLOAD, deps);

    expect(result).toEqual({ attempted: true, delivered: 0, pruned: 0, failed: 1 });
    expect(failed).toEqual([TARGET.endpoint]);
    expect(removed).toEqual([]);
  });

  it('classifies a mixed batch per subscription', async () => {
    const [ok, gone, broken] = [target('https://push.example.com/ok'), target('https://push.example.com/gone'), target('https://push.example.com/broken')];
    const { deps, sent, used, failed, removed } = makeDeps([ok, gone, broken], (subject) => {
      if (subject.endpoint === ok.endpoint) return { statusCode: 201 };
      if (subject.endpoint === gone.endpoint) return { throw: pushError(410) };
      return { throw: pushError(503) };
    });

    const result = await sendWebPush('user-1', PAYLOAD, deps);

    expect(result).toEqual({ attempted: true, delivered: 1, pruned: 1, failed: 1 });
    expect(sent.map((s) => s.endpoint)).toEqual([ok.endpoint, gone.endpoint, broken.endpoint]);
    expect(used).toEqual([ok.endpoint]);
    expect(removed).toEqual([gone.endpoint]);
    expect(failed).toEqual([broken.endpoint]);
  });

  it('never throws when the transport rejects with a non-Error', async () => {
    const deps = makeDeps([TARGET], () => ({ statusCode: 201 })).deps;
    deps.sendNotification = async () => {
      throw 'ECONNRESET';
    };

    const result = await sendWebPush('user-1', PAYLOAD, deps);

    expect(result).toEqual({ attempted: true, delivered: 0, pruned: 0, failed: 1 });
  });

  it('never throws when the subscription lookup itself fails', async () => {
    const result = await sendWebPush('user-1', PAYLOAD, {
      isConfigured: () => true,
      listSubscriptions: async () => {
        throw new Error('database is locked');
      },
    });

    expect(result).toEqual({ attempted: true, delivered: 0, pruned: 0, failed: 0, error: 'database is locked' });
  });
});

describe('the default transport', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.VAPID_PUBLIC_KEY = 'vapid-public';
    process.env.VAPID_PRIVATE_KEY = 'vapid-private';
    process.env.VAPID_SUBJECT = 'mailto:ops@example.com';
    resetEnvCache();
  });

  afterEach(() => {
    process.env.VAPID_PUBLIC_KEY = saved.VAPID_PUBLIC_KEY;
    process.env.VAPID_PRIVATE_KEY = saved.VAPID_PRIVATE_KEY;
    process.env.VAPID_SUBJECT = saved.VAPID_SUBJECT;
    resetEnvCache();
  });

  it('configures VAPID once, then passes the socket timeout to web-push per send', async () => {
    const vapidCalls: string[][] = [];
    const sends: unknown[] = [];
    const module: WebPushModule = {
      setVapidDetails: (subject, publicKey, privateKey) => {
        vapidCalls.push([subject, publicKey, privateKey]);
      },
      sendNotification: async (subscription, payload, options) => {
        sends.push({ subscription, payload, options });
        return { statusCode: 201 };
      },
    };
    const targets = [target('https://push.example.com/a'), target('https://push.example.com/b')];

    const result = await sendWebPush('user-1', PAYLOAD, {
      loadWebPush: async () => module,
      listSubscriptions: async () => targets,
      markUsed: async () => {},
      recordFailure: async () => {},
      removeSubscription: async () => {},
    });

    expect(result).toEqual({ attempted: true, delivered: 2, pruned: 0, failed: 0 });
    expect(vapidCalls).toEqual([['mailto:ops@example.com', 'vapid-public', 'vapid-private']]);
    expect(sends).toHaveLength(2);
    expect(sends[0]).toEqual({
      subscription: { endpoint: targets[0].endpoint, keys: { p256dh: targets[0].p256dh, auth: targets[0].auth } },
      payload: buildWebPushPayload(PAYLOAD),
      options: { timeout: WEB_PUSH_TIMEOUT_MS },
    });
  });

  it('loads the real web-push module once, and it has the shape the interface claims', async () => {
    const first = await loadWebPush();
    const second = await loadWebPush();

    expect(first).toBe(second);
    expect(typeof first.sendNotification).toBe('function');
    expect(typeof first.setVapidDetails).toBe('function');
    expect(isWebPushLoaded()).toBe(true);
  });
});

/**
 * The default deps talk to `push_subscriptions`. Those four queries are the ones
 * that actually run in production and the ones an injected transport can never
 * exercise, so they get a real migrated SQLite file rather than a stub — the
 * same setup `tests/accounts-repo.test.ts` uses. `isConfigured` and the
 * transport stay injected; nothing here needs a VAPID key.
 */
describe('the default deps against a real database', () => {
  const OWNER = 'user-web-push-owner';
  const OTHER = 'user-web-push-other';
  let tempDir = '';

  async function insertSubscription(id: string, userId: string, endpoint: string): Promise<void> {
    await getDb().insert(pushSubscriptions).values({
      id,
      userId,
      endpoint,
      p256dh: `${id}-key`,
      auth: `${id}-auth`,
      userAgent: null,
      failureCount: 0,
      lastUsedAtMs: null,
    });
  }

  async function rowsFor(userId: string) {
    return getDb().select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-web-push-'));
    const file = path.join(tempDir, 'web-push.db');
    process.env.DATABASE_URL = `file:${file}`;
    process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0001';

    resetEnvCache();
    resetDialectCache();
    await closeDb();

    const handle = new Database(file);
    try {
      handle.pragma('journal_mode = WAL');
      handle.pragma('foreign_keys = ON');
      migrate(drizzle(handle), { migrationsFolder: path.join(process.cwd(), 'drizzle', 'sqlite') });
    } finally {
      handle.close();
    }

    await getDb().insert(user).values([
      { id: OWNER, name: 'Owner', email: 'owner@example.test', emailVerified: true, timezone: 'UTC' },
      { id: OTHER, name: 'Other', email: 'other@example.test', emailVerified: true, timezone: 'UTC' },
    ]);
  });

  afterEach(async () => {
    await closeDb();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('lists only the user\'s own rows and stamps the delivered one as used', async () => {
    await insertSubscription('sub-own', OWNER, 'https://push.example.com/own');
    await insertSubscription('sub-other', OTHER, 'https://push.example.com/other');
    const sent: string[] = [];

    const result = await sendWebPush(OWNER, PAYLOAD, {
      isConfigured: () => true,
      sendNotification: async (subscription) => {
        sent.push(subscription.endpoint);
        return { statusCode: 201 };
      },
    });

    expect(result).toEqual({ attempted: true, delivered: 1, pruned: 0, failed: 0 });
    expect(sent).toEqual(['https://push.example.com/own']);

    const [own] = await rowsFor(OWNER);
    expect(typeof own.lastUsedAtMs).toBe('number');
    expect(own.failureCount).toBe(0);

    const [other] = await rowsFor(OTHER);
    expect(other.lastUsedAtMs).toBeNull();
  });

  it('deletes only the pruned row, leaving another account\'s subscription alone', async () => {
    await insertSubscription('sub-own', OWNER, 'https://push.example.com/own');
    await insertSubscription('sub-other', OTHER, 'https://push.example.com/other');

    const result = await sendWebPush(OWNER, PAYLOAD, {
      isConfigured: () => true,
      sendNotification: async () => {
        throw pushError(410);
      },
    });

    expect(result).toEqual({ attempted: true, delivered: 0, pruned: 1, failed: 0 });
    expect(await rowsFor(OWNER)).toEqual([]);
    expect(await rowsFor(OTHER)).toHaveLength(1);
  });

  it('increments failure_count on a transient status and keeps the row', async () => {
    await insertSubscription('sub-own', OWNER, 'https://push.example.com/own');

    const result = await sendWebPush(OWNER, PAYLOAD, {
      isConfigured: () => true,
      sendNotification: async () => {
        throw pushError(503);
      },
    });

    expect(result).toEqual({ attempted: true, delivered: 0, pruned: 0, failed: 1 });

    const [own] = await rowsFor(OWNER);
    expect(own.failureCount).toBe(1);
    expect(own.lastUsedAtMs).toBeNull();
  });
});
