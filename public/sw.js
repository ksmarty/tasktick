/* eslint-disable no-restricted-globals */
/**
 * ===========================================================================
 * TaskTick service worker — hand-written, no build step, no Workbox
 * ===========================================================================
 *
 * Shipped as a static file from `public/sw.js`. `next.config.ts` serves it with
 * `Cache-Control: no-cache, no-store, must-revalidate` and
 * `Service-Worker-Allowed: /`, so the browser always re-reads this file and the
 * worker is allowed to control the whole origin.
 *
 * The offline model follows the platform reality, not the wishful one:
 * iOS Safari has no Background Sync and evicts workers/caches aggressively, so
 * the strategy is "serve the app shell immediately, then let the *client*
 * reconcile its mutations". Nothing is ever queued in here — a queued write
 * would be silently lost the moment iOS reclaims the worker.
 *
 * ---------------------------------------------------------------------------
 * Runtime strategy — one explicit rule per resource class
 * ---------------------------------------------------------------------------
 *
 *   navigations (request.mode === 'navigate')
 *       network-first, with the precached app shell (`/`) as the fallback and
 *       `/offline` after that. `event.preloadResponse` (navigation preload) is
 *       preferred over a second fetch so the request is not serialised behind
 *       worker startup. Deliberately does NOT write anything to a runtime
 *       cache: the shell is refreshed when the next worker activates, which
 *       keeps the cache from accumulating one stale HTML copy per visited URL.
 *
 *   /_next/static/**, /icons/**
 *       cache-first and treated as immutable — these URLs are content-hashed
 *       (or hand-versioned, for the icons) so a cache hit is always correct.
 *
 *   other same-origin GETs
 *       stale-while-revalidate — instant response from cache, refreshed in the
 *       background for the next visit.
 *
 *   /api/**
 *       NEVER CACHED. Network-only; if the network is down we return
 *       503 `{ "offline": true }` so the client can tell "offline" apart from
 *       "server said no". Caching authenticated API responses in a cache shared
 *       by every account on the device is a data-leak risk, so the API is
 *       excluded from every caching path in this file.
 *
 *   non-GET requests, cross-origin requests
 *       never intercepted and never cached, under any circumstances.
 *
 *   responses with `Cache-Control: no-store`
 *       never cached (see `isCacheable`), regardless of resource class.
 *
 * ---------------------------------------------------------------------------
 * BUMP `VERSION` ON EVERY DEPLOY THAT CHANGES A PRECACHED FILE
 * ---------------------------------------------------------------------------
 * The name change is what retires the previous caches in `activate`; there is
 * no other invalidation mechanism, because a cache-first shell can never
 * discover a new build by itself. Keep the `tasktick-v<n>` shape.
 *
 *   >>>  VERSION  <<<
 */

const VERSION = 'tasktick-v1';

const PRECACHE_CACHE = `precache-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

/** The app shell: one HTML document that boots the client router offline. */
const SHELL_URL = '/';
/** Dedicated "you are offline" route, the final fallback for navigations. */
const OFFLINE_URL = '/offline';

/** Everything needed to boot and look like TaskTick with no network at all. */
const PRECACHE_URLS = [
  SHELL_URL,
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/icons/icon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-192.png',
  '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon.png',
];

/** Content-hashed (or hand-versioned) prefixes: a hit is always correct. */
const IMMUTABLE_PREFIXES = ['/_next/static/', '/icons/'];

const API_PREFIX = '/api/';

/* ==========================================================================
 * lifecycle
 * ========================================================================== */

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_CACHE);
      await Promise.all(PRECACHE_URLS.map((url) => precacheOne(cache, url)));
      await self.skipWaiting();
    })(),
  );
});

/**
 * Install-time precache of one allow-listed URL.
 *
 * This is the ONE place that deliberately stores a response the runtime
 * strategy would refuse: Next renders the app shell with
 * `Cache-Control: no-store`, and an offline-first shell is precisely the file
 * we must keep. The list above is short, reviewed and versioned, which is a
 * very different proposition from caching arbitrary traffic in `fetch` (where
 * `isCacheable` gates every write).
 *
 * A failure here is logged and tolerated, so a single missing entry (e.g. an
 * app without `/offline`) cannot leave the device with no worker at all.
 */
async function precacheOne(cache, url) {
  try {
    // `cache: 'reload'` bypasses the HTTP cache so a redeploy cannot bake a
    // stale shell into the new worker's precache.
    const response = await fetch(new Request(url, { cache: 'reload' }));
    // Never store a login redirect under the shell's URL: offline visitors
    // would be shown a sign-in page that cannot possibly work.
    if (!response.ok || response.redirected) {
      throw new Error(`${response.status}${response.redirected ? ' (redirected)' : ''}`);
    }
    await cache.put(url, response);
  } catch (error) {
    console.warn('[sw] precache skipped', url, error);
  }
}

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([PRECACHE_CACHE, RUNTIME_CACHE]);
      const names = await caches.keys();
      await Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));

      // Navigation preload lets the browser start the HTML request in parallel
      // with worker startup instead of after it.
      if (self.registration.navigationPreload) {
        try {
          await self.registration.navigationPreload.enable();
        } catch (error) {
          console.warn('[sw] navigation preload unavailable', error);
        }
      }

      await self.clients.claim();
    })(),
  );
});

/* The update prompt in `ServiceWorkerRegistrar` asks the waiting worker to take
 * over; the page reloads on `controllerchange`. */
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ==========================================================================
 * fetch
 * ========================================================================== */

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Never touch writes, and never touch another origin — a cross-origin
  // response cannot be inspected (opaque) and must not be stored.
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(API_PREFIX)) {
    event.respondWith(apiNetworkOnly(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(navigationNetworkFirst(event));
    return;
  }

  if (IMMUTABLE_PREFIXES.some((prefix) => url.pathname.startsWith(prefix))) {
    event.respondWith(cacheFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request, event));
});

/* ==========================================================================
 * strategies
 * ========================================================================== */

/**
 * Navigation: network-first, then the precached shell, then `/offline`.
 * `event.preloadResponse` is the request the browser already made for us.
 */
async function navigationNetworkFirst(event) {
  try {
    const preloaded = await event.preloadResponse;
    if (preloaded) return preloaded;
    return await fetch(event.request);
  } catch (error) {
    const precache = await caches.open(PRECACHE_CACHE);
    const shell = await precache.match(SHELL_URL);
    if (shell) return shell;

    const offline = await precache.match(OFFLINE_URL);
    if (offline) return offline;

    // Only reachable if precaching failed entirely (e.g. first visit happened
    // while offline). Better a readable page than the browser's dino.
    return new Response(LAST_RESORT_HTML, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
}

/** Content-hashed assets: cache-first, network only on a miss. */
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(request, response)) await cache.put(request, response.clone());
  return response;
}

/**
 * Everything else same-origin: answer from cache immediately, refresh in the
 * background. `event.waitUntil` keeps the worker alive for the revalidation.
 */
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const revalidation = fetch(request)
    .then(async (response) => {
      if (isCacheable(request, response)) await cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(revalidation);
    return cached;
  }

  const fresh = await revalidation;
  // Nothing cached and no network: hand the page a real network error rather
  // than inventing content for an asset we know nothing about.
  return fresh || Response.error();
}

/**
 * `/api/**` is network-only, forever. On failure the client gets a 503 with a
 * machine-readable `offline` flag, which is the only honest thing we can say.
 */
async function apiNetworkOnly(request) {
  try {
    return await fetch(request);
  } catch (error) {
    return new Response(JSON.stringify({ offline: true, error: 'network-unavailable' }), {
      status: 503,
      statusText: 'Service Unavailable',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}

/**
 * The single gate in front of every `cache.put` in this file.
 * `no-store` responses are never stored, only GETs are eligible, and opaque
 * cross-origin responses never reach here (they are filtered in `fetch`).
 */
function isCacheable(request, response) {
  if (request.method !== 'GET') return false;
  if (!response || !response.ok || response.type === 'opaqueredirect') return false;
  const cacheControl = response.headers.get('Cache-Control') || '';
  if (/(^|,)\s*no-store\s*(,|$)/i.test(cacheControl)) return false;
  return true;
}

/* ==========================================================================
 * push
 * ========================================================================== */

/**
 * Web Push display path. `PushPermissionPrompt` subscribes the browser and
 * POSTs the subscription to `/api/push/subscribe`; this handler is what turns a
 * server push into a visible notification. iOS requires an installed (Home
 * Screen) PWA for any of this to fire at all.
 */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'TaskTick', {
      body: payload.body || '',
      tag: payload.tag || 'tasktick',
      data: { url: payload.url || '/' },
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientList) {
        if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
          await client.focus();
          if ('navigate' in client) await client.navigate(target);
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/* ==========================================================================
 * last-resort document
 * ========================================================================== */

const LAST_RESORT_HTML = [
  '<!doctype html>',
  '<html lang="en"><head><meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">',
  '<title>Offline — TaskTick</title>',
  '<style>',
  'html{color-scheme:light dark}',
  'body{margin:0;min-height:100dvh;display:grid;place-items:center;padding:24px;',
  'font:17px/1.4 -apple-system,BlinkMacSystemFont,"SF Pro Text",system-ui,sans-serif;',
  'background:#f2f2f7;color:#000;text-align:center}',
  'h1{font-size:22px;margin:0 0 8px}p{margin:0 0 20px;opacity:.6}',
  'button{font:inherit;font-weight:600;padding:12px 22px;border:0;border-radius:12px;',
  'background:#0a84ff;color:#fff}',
  '@media(prefers-color-scheme:dark){body{background:#000;color:#fff}}',
  '</style></head><body><main>',
  "<h1>You're offline</h1>",
  "<p>TaskTick couldn't load its app shell. Reconnect and try again.</p>",
  '<button onclick="location.reload()">Retry</button>',
  '</main></body></html>',
].join('');
