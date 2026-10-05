/**
 * Outbound notification transport: Web Push.
 *
 * ## Why this exists beside Apprise
 *
 * Apprise fans a reminder out to ~100 services but nothing shows it on the
 * device itself. The browser `push_subscriptions` path (`POST
 * /api/push/subscribe` → `public/sw.js` `push` handler) was complete except for
 * the sender: rows were written, listed and deleted and nothing ever sent to
 * them. This is that sender, and it lives beside `notifications.ts` so a user
 * with both configured gets both.
 *
 * ## Why `web-push` is imported lazily
 *
 * The `web-push` package exists in `package.json` but an instance with no VAPID
 * keys — which is every default install — never sends a push. Importing it at
 * module scope would therefore pay its cost on every boot for a code path that
 * cannot run. So the import happens inside the send path, after the VAPID check,
 * exactly as `src/server/services/scheduler.ts` defers the ~7 MB CalDAV stack.
 * `loadWebPush()` is exported with `resetWebPushCache()` as the test seam that
 * proves the deferral.
 *
 * ## Why 404/410 prunes and other failures back off
 *
 * A push service answers 404 (Not Found) or 410 (Gone) for exactly one reason:
 * the subscription this server holds no longer exists — the browser was
 * uninstalled, the permission revoked, or the endpoint expired. RFC 8030 §7.3
 * names those two as the deletion signal. Retrying is pointless (the endpoint
 * will never come back) and keeping the row means the account carries a device
 * that can never receive a reminder, with no way for the user to see it. So the
 * row is deleted and counted as `pruned`.
 *
 * Every other status — 429 rate limit, 500, 503, a TLS failure, a socket
 * timeout — is transient, at least possibly. Deleting on one of those would
 * silently unsubscribe a working device because a push service had a bad
 * minute, so instead `failure_count` is incremented (`failureCount`) and the row
 * is kept. Nothing reads that counter yet; it is the hook a back-off policy
 * needs, and it is deliberately not a delete.
 *
 * ## Failure is never fatal
 *
 * Nothing here throws. A push service that is down, a malformed payload or a
 * hung socket all come back as a `WebPushDelivery` result and are logged by the
 * caller. The reminder loop must not break because one subscription is stale.
 */
import { and, eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { pushSubscriptions } from '../db/schema';
import { getEnv, pushConfigured } from '@/lib/env';
import type { NotificationPayload } from './notifications';

/** The result of one fan-out attempt. Never thrown — always returned. */
export interface WebPushDelivery {
  /** False when Web Push is unconfigured or the user has no subscriptions. */
  attempted: boolean;
  /** Subscriptions the push service accepted. */
  delivered: number;
  /** Subscriptions deleted because the push service said they are gone. */
  pruned: number;
  /** Subscriptions whose delivery failed transiently; their row is kept. */
  failed: number;
  /** Present only when nothing was attempted, or the batch itself broke. */
  error?: string;
}

/** The subset of a `push_subscriptions` row this sender needs. */
export interface WebPushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * The two `web-push` functions used here, stated structurally so the transport
 * is injectable. `loadWebPush()` returns the real module, so `tsc` still checks
 * this shape against `@types/web-push` and cannot drift.
 */
export interface WebPushModule {
  setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
  sendNotification(
    subscription: { endpoint: string; keys: { p256dh: string; auth: string } },
    payload: string,
    options?: { timeout?: number },
  ): Promise<{ statusCode: number }>;
}

/** Sends one encrypted push. Rejects with a `statusCode` on a non-2xx answer. */
export type WebPushTransport = (
  subscription: WebPushTarget,
  payload: string,
  timeoutMs: number,
) => Promise<{ statusCode: number }>;

/** Injectable seams. Every one of them has a real default; none is required. */
export interface WebPushDeps {
  /** Defaults to `pushConfigured()`. */
  isConfigured?: () => boolean;
  /** Defaults to the user's rows in `push_subscriptions`. */
  listSubscriptions?: (userId: string) => Promise<WebPushTarget[]>;
  /** Defaults to the lazy `web-push` import. */
  loadWebPush?: () => Promise<WebPushModule>;
  /** Defaults to a `sendNotification` through the loaded module. */
  sendNotification?: WebPushTransport;
  /** Defaults to stamping `lastUsedAtMs` on the row. */
  markUsed?: (userId: string, endpoint: string) => Promise<void>;
  /** Defaults to incrementing the row's `failure_count`. */
  recordFailure?: (userId: string, endpoint: string) => Promise<void>;
  /** Defaults to deleting the row. */
  removeSubscription?: (userId: string, endpoint: string) => Promise<void>;
}

/** A hung push service must not hold the reminder loop open. */
export const WEB_PUSH_TIMEOUT_MS = 10_000;

/** The tag the service worker falls back to, so sends coalesce the same way. */
const WEB_PUSH_TAG = 'tasktick';

/**
 * The body `public/sw.js` renders. The worker's `push` handler reads
 * `title`, `body`, `tag` and `data.url` (from `url`) and nothing else — a
 * payload keyed differently arrives as a blank notification. `type` is an
 * Apprise concept and has no rendering path in the worker, so it is not sent.
 */
export function buildWebPushPayload(payload: NotificationPayload): string {
  return JSON.stringify({
    title: payload.title,
    body: payload.body,
    tag: WEB_PUSH_TAG,
    url: '/',
  });
}

let webPushPromise: Promise<WebPushModule> | null = null;
let vapidReady = false;

/**
 * Loads `web-push` on first use. The promise is memoized so a fan-out to ten
 * subscriptions imports once. A failed import is not memoized — a module that
 * failed to load once must be able to load on the next tick rather than pinning
 * the process to a rejected promise forever.
 */
export function loadWebPush(): Promise<WebPushModule> {
  if (!webPushPromise) {
    webPushPromise = import('web-push').catch((error: unknown) => {
      webPushPromise = null;
      throw error;
    }) as Promise<WebPushModule>;
  }
  return webPushPromise;
}

/** Test seam: has the `web-push` import been requested? */
export function isWebPushLoaded(): boolean {
  return webPushPromise !== null;
}

/** Test seam: forget the memoized module and VAPID configuration. */
export function resetWebPushCache(): void {
  webPushPromise = null;
  vapidReady = false;
}

/**
 * Configures VAPID once per process. `sendNotification` reads the details set
 * here, so doing it per push would re-encode the JWT for every subscription of
 * every reminder. Reached only after `pushConfigured()` said the keys are
 * present, and the guard makes that assumption explicit rather than assumed.
 */
function configureVapid(module: WebPushModule): void {
  if (vapidReady) return;
  const env = getEnv();
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) throw new Error('VAPID keys are not configured');
  module.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY);
  vapidReady = true;
}

/**
 * The real transport, built around a module loader so the lazy import stays
 * injectable. `timeout` is `web-push`'s socket timeout: it destroys the request
 * on a hung push service, which surfaces here as a rejection and is counted as
 * a transient failure — the reason a dead endpoint cannot stall a scheduler
 * tick.
 */
function makeTransport(load: () => Promise<WebPushModule>): WebPushTransport {
  return async (subscription, payload, timeoutMs) => {
    const module = await load();
    configureVapid(module);
    return module.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      payload,
      { timeout: timeoutMs },
    );
  };
}

/**
 * The status a rejected push carries, when it carries one. `web-push` rejects
 * with a `WebPushError` whose `statusCode` is the push service's own status; a
 * socket failure rejects with a plain `Error` and has none, which is what makes
 * "is this a delete?" a question about 404/410 specifically rather than about
 * whether an error happened at all.
 */
function pushStatusCode(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null;
  const status: unknown = (error as { statusCode?: unknown }).statusCode;
  return typeof status === 'number' ? status : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Web Push request failed';
}

async function listUserSubscriptions(userId: string): Promise<WebPushTarget[]> {
  const db = getDb();
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

async function markSubscriptionUsed(userId: string, endpoint: string): Promise<void> {
  const db = getDb();
  const now = Date.now();
  await db
    .update(pushSubscriptions)
    .set({ lastUsedAtMs: now, updatedAt: now })
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

async function bumpFailureCount(userId: string, endpoint: string): Promise<void> {
  const db = getDb();
  await db
    .update(pushSubscriptions)
    .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1`, updatedAt: Date.now() })
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

async function deleteSubscription(userId: string, endpoint: string): Promise<void> {
  const db = getDb();
  await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.userId, userId), eq(pushSubscriptions.endpoint, endpoint)));
}

/**
 * Sends one notification to every device the user has subscribed.
 *
 * Resolves on every outcome — unconfigured, no devices, some devices gone, or a
 * push service that is entirely down — because the caller is a reminder loop
 * that must keep ticking. Subscriptions are sent sequentially: a batch is one
 * reminder to a handful of devices, and a burst of parallel sockets against the
 * same push service buys nothing but a worse failure mode.
 */
export async function sendWebPush(
  userId: string,
  payload: NotificationPayload,
  deps: WebPushDeps = {},
): Promise<WebPushDelivery> {
  try {
    if (!(deps.isConfigured ?? pushConfigured)()) {
      return { attempted: false, delivered: 0, pruned: 0, failed: 0, error: 'not-configured' };
    }

    const subscriptions = await (deps.listSubscriptions ?? listUserSubscriptions)(userId);
    if (subscriptions.length === 0) {
      return { attempted: false, delivered: 0, pruned: 0, failed: 0, error: 'no-subscriptions' };
    }

    const body = buildWebPushPayload(payload);
    const send = deps.sendNotification ?? makeTransport(deps.loadWebPush ?? loadWebPush);
    const markUsed = deps.markUsed ?? markSubscriptionUsed;
    const recordFailure = deps.recordFailure ?? bumpFailureCount;
    const takeDown = deps.removeSubscription ?? deleteSubscription;

    let delivered = 0;
    let pruned = 0;
    let failed = 0;

    for (const subscription of subscriptions) {
      try {
        await send(subscription, body, WEB_PUSH_TIMEOUT_MS);
        await markUsed(userId, subscription.endpoint);
        delivered += 1;
      } catch (error) {
        const status = pushStatusCode(error);
        // 404/410 is the push service saying this subscription is gone; see the
        // file header for why that is the only case that deletes the row.
        if (status === 404 || status === 410) {
          await takeDown(userId, subscription.endpoint);
          pruned += 1;
        } else {
          await recordFailure(userId, subscription.endpoint);
          failed += 1;
        }
      }
    }

    return { attempted: true, delivered, pruned, failed };
  } catch (error) {
    return { attempted: true, delivered: 0, pruned: 0, failed: 0, error: errorMessage(error) };
  }
}
