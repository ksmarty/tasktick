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
 *       network-first, then this session's copy of the SAME URL, then the
 *       precached app shell (`/`), then `/offline`. `event.preloadResponse`
 *       (navigation preload) is preferred over a second fetch so the request is
 *       not serialised behind worker startup — and it is part of the SAME
 *       `NAVIGATION_TIMEOUT_MS` race, not awaited ahead of it. Awaiting it on its
 *       own meant a link that HANGS (rather than fails) held the navigation for
 *       as long as the browser's own request timeout: measured at over 40s on a
 *       link delayed by 20s, with the documented 3s ceiling never reached. The
 *       exact-URL rule is the whole
 *       safety argument: a Next.js App Router document carries the RSC payload
 *       for one specific route, so a cached document may only ever be served at
 *       the URL it was stored for. That is also why the previous version cached
 *       no documents at all and redirected every offline navigation to
 *       `/offline` — which meant an offline RELOAD of a screen the user was
 *       looking at a second earlier landed on a dead end. Documents are stored
 *       in the session's cache (they are rendered per user), never in the shared
 *       runtime cache.
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
 *       network-first with a per-session cache fallback. A read that already has
 *       a cached copy is answered on `CACHED_RESPONSE_GRACE_MS` if the network
 *       has not answered by then (the request stays in flight to refresh it); a
 *       read with nothing cached is bounded by `API_TIMEOUT_MS`. Only a read
 *       with nothing cached and no answer returns 503 `{ "offline": true }`, so
 *       the client can still tell "offline" apart from "server said no".
 *
 *       The previous version of this file refused to cache the API at all, and
 *       the reason it gave was correct: ONE cache shared by every account on the
 *       device leaks between them. The cache is therefore not shared — it is
 *       named after the session (`api-<scope>-<version>`) and the previous
 *       session's cache is deleted the moment a different one is announced, and
 *       again on sign-out. See "session scoping" below. Reads that are
 *       authenticated with the session cookie are still never cached in a cache
 *       that another session could read.
 *
 *   route payloads (RSC)
 *       the App Router's own fetches for a client-side route change
 *       (`?_rsc=…`, `RSC: 1`) — network-first, with the session cache as the
 *       fallback, exactly like an API read. They are per-user route data, so they
 *       live in the session cache and are deleted with it. Without them a tab tap
 *       with no connection cannot render anything: the router has no payload for
 *       the route it was asked for.
 *
 *   /api/auth/**
 *       network-only, never cached, never replaced with an offline response.
 *       These carry credentials and session state; a cached answer to "who is
 *       signed in?" would be a lie with consequences.
 *
 *   non-GET requests, cross-origin requests
 *       never intercepted and never cached, under any circumstances. A write is
 *       never queued here: the client owns the write queue (see
 *       `src/lib/offline-queue.ts`), because a queue inside a worker is lost the
 *       moment iOS reclaims it.
 *
 *   responses with `Cache-Control: no-store`
 *       never cached by the runtime strategies (see `isCacheable`), regardless of
 *       resource class. The API cache applies its own, narrower gate
 *       (`isApiCacheable`): every API response carries `no-store, private`
 *       because it must not sit in a SHARED cache — which is exactly what a
 *       per-session cache is not.
 *
 * ---------------------------------------------------------------------------
 * Session scoping — what identifies the session from inside this worker
 * ---------------------------------------------------------------------------
 *
 * Nothing the worker can read for itself. The session cookie is `httpOnly`, so
 * there is no `document.cookie` here; `self.cookieStore` exists only in
 * Chromium; and a worker that could read the cookie would be reading a rotating
 * credential rather than an identity. So the page answers the question and sends
 * the answer:
 *
 *     GET /api/auth/get-session -> session.id -> FNV-1a hash -> "s1a2b3c4d"
 *         -> postMessage({ type: 'session', scope })
 *
 * The worker stores that opaque scope in `META_CACHE` (so it survives a worker
 * restart, which on iOS is every few minutes), names the API cache after it, and
 * deletes every other scope's cache on sight. `{ type: 'sign-out' }` drops the
 * API caches and the stored scope outright. The page runs that purge on sign-out
 * as well (`purgeSession()` in `src/lib/session-scope.ts`), so the same guarantee
 * holds even if the message never arrives.
 *
 * ---
 *
 *   `{ type: 'cache-document', url }`
 *       the page asking for its OWN document to be kept. This exists because the
 *       very first controlled load cannot cache itself: on a first visit the
 *       page starts before `clients.claim()`, so its navigation request never
 *       reached this worker. The worker only ever caches a document when a
 *       request passes through it, which is why a cold offline open had nothing
 *       to serve and fell through to `/offline`. The page therefore says "this
 *       is my URL, keep it" after the worker is in control — see
 *       `requestDocumentCache()` in `src/lib/session-scope.ts`, which rides the
 *       same message channel as the session scope.
 *
 *       It is sent once per page load, never per navigation. The document is
 *       stored under its exact URL in the session cache, exactly like one that
 *       passed through `fetch`, so it can only ever be served at that URL.
 *
 * ---------------------------------------------------------------------------
 * BUMP `VERSION` ON EVERY DEPLOY THAT CHANGES A PRECACHED FILE
 * ---------------------------------------------------------------------------
 * The name change is what retires the previous caches in `activate`; there is
 * no other invalidation mechanism, because a cache-first shell can never
 * discover a new build by itself. Keep the `tasktick-v<n>` shape.
 *
 * This is not optional bookkeeping. A deploy that changes the app but leaves
 * this string alone does not simply serve a stale page: because `sw.js` itself
 * is byte-identical, the browser never installs a new worker at all, so existing
 * clients stay pinned to the old shell AND the old content-hashed chunks
 * indefinitely. `npm run verify:sw` guards this in CI.
 *
 *   >>>  VERSION  <<<
 */

const VERSION = 'tasktick-v10';

const PRECACHE_CACHE = `precache-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;
/** Tiny cache holding the scope of the session the API cache belongs to. */
const META_CACHE = `meta-${VERSION}`;
/** Prefix of every per-session API cache: `api-<scope>-<version>`. */
const API_CACHE_PREFIX = 'api-';
/** Key inside META_CACHE holding the opaque session scope. */
const SESSION_KEY = '/__session';
/**
 * How long a read with NOTHING cached waits for the network before answering
 * the machine-readable "offline" response.
 *
 * A read that already has a cached copy is answered on the much shorter
 * `CACHED_RESPONSE_GRACE_MS` below; this is the hard ceiling for the case with
 * no local copy to fall back on, so a link that HANGS rather than refuses still
 * resolves instead of holding the screen until the browser's own timeout. It
 * keeps running and warms the entry for the next read, so a connection that
 * recovers mid-request is not wasted.
 *
 * The value is a latency budget, not an availability one: "bad cell service" is
 * a latency problem first. A healthy connection answers well inside this window.
 */
const API_TIMEOUT_MS = 1500;

/**
 * How long a *navigation* waits for the network before falling back to cache.
 *
 * Navigations had no timeout at all, so on a connection that hangs rather than
 * refuses — which is what a weak signal does — the browser's own timeout decided
 * and the user watched a frozen screen for tens of seconds. A hard ceiling here
 * is what turns "everything froze, then it switched" into a screen that appears.
 */
const NAVIGATION_TIMEOUT_MS = 3000;
/**
 * How long a request that ALREADY HAS a cached answer waits for the network
 * before that answer is served.
 *
 * This is the number a person feels. The hard ceilings above exist for the case
 * with nothing to fall back on; a cached answer does not need them to learn the
 * network is not coming. Measured on a link that accepts the connection and then
 * goes silent (which is what a weak signal does, and where `navigator.onLine`
 * stays `true` so no `offline` event ever fires): a cold document navigation
 * spent the full `NAVIGATION_TIMEOUT_MS` (document response at 3010ms) with the
 * document already in the cache.
 *
 * A healthy connection answers far inside this window (measured: a document
 * navigation in ~330ms, a tab tap in ~250ms), so online the fresh response still
 * wins and nothing about what is cached changes. On a link slower than this the
 * cached copy is served and the outstanding request is kept alive to refresh the
 * entry — the deliberate cost of not freezing, and the same trade the old
 * ceiling made, just paid sooner.
 */
const CACHED_RESPONSE_GRACE_MS = 700;
/**
 * Whether the page currently believes it has a network.
 *
 * A service worker has no `navigator.onLine`, so the page tells us: it posts on
 * `online`/`offline` and once on registration. Before we hear anything the
 * assumption is online, because guessing "offline" on a good connection would
 * serve stale data to everyone.
 *
 * This is the difference between "offline mode works" and "offline mode is
 * usable". Network-first with six seconds of patience is right on a working
 * connection and wrong on a broken one: every read and every navigation paid the
 * full timeout before falling back to data already on the device.
 */
let networkOnline = true;

/**
 * Learn the connection's state from requests, not only from the page.
 *
 * The page's `online`/`offline` events are the best signal when they fire, but
 * on a weak signal they never do: the OS still reports a connection, every
 * request just hangs, and `navigator.onLine` stays `true`. A request that has
 * actually settled is the truth — one that rejects proves the link is down, one
 * that answers proves it is up. Feeding those outcomes back is what makes the
 * worker stop waiting out a ceiling it can already see is hopeless, and what
 * lets it recover on its own the moment the network answers again.
 */
function noteReachable() {
  networkOnline = true;
}

function noteUnreachable() {
  networkOnline = false;
}

/** `fetch`, with the worker's connectivity flag updated from the outcome. */
function trackedFetch(request, init) {
  return fetch(request, init).then(
    (response) => {
      noteReachable();
      return response;
    },
    (error) => {
      noteUnreachable();
      throw error;
    },
  );
}

/** Older entries are dropped once the API cache grows past this many reads. */
const API_CACHE_MAX_ENTRIES = 120;

/** The app shell: one HTML document that boots the client router offline. */
const SHELL_URL = '/';
/**
 * Where the root sends a signed-in visitor, and therefore where an offline
 * launch of the installed app is sent too.
 *
 * `/` is a redirect route (`src/app/page.tsx` sends a signed-in user to
 * `/tasks`, a signed-out one to `/login`). A redirect is deliberately never
 * cached, so there is no document for `/` — which used to leave an offline
 * cold start of the INSTALLED app (whose `start_url` is `/`) staring at the
 * last-resort "couldn't load its app shell" page, even though the very screen
 * it wanted was sitting in the session cache. Redirecting `/` to the landing
 * route keeps the exact-URL rule intact — `/tasks` is served only at `/tasks` —
 * and lets the ordinary exact-path lookup answer it.
 */
const LANDING_URL = '/tasks';
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

      /*
       * The two HTML documents are precached together with the assets they
       * reference.
       *
       * Caching the HTML alone is not enough to render a page offline. A Next.js
       * document pulls content-hashed chunks (`/_next/static/chunks/...`), and
       * those hashes do not exist until a build does, so they cannot be listed
       * above. The result was an offline page that loaded its HTML and then died
       * with `ChunkLoadError` — "Application error: a client-side exception has
       * occurred" — because the script it needed had never been cached.
       *
       * Reading each document's own asset references at install time is what
       * closes that gap. `/offline` is otherwise never visited online, so its
       * chunks would never enter the runtime cache either.
       */
      await Promise.all(PRECACHE_URLS.map((url) => precacheOne(cache, url)));
      await Promise.all([precacheDocumentTree(cache, SHELL_URL), precacheDocumentTree(cache, OFFLINE_URL)]);
      await self.skipWaiting();
    })(),
  );
});

/**
 * Caches an HTML document together with every build asset it references.
 *
 * Deliberately one level deep: this covers the page's own entry chunk, which is
 * what the offline fallback needs. Chunks pulled in later by client-side
 * navigation are handled by the runtime cache on the way through, as they always
 * were.
 */
async function precacheDocumentTree(cache, url) {
  try {
    const response = await fetch(new Request(url, { cache: 'reload' }));
    if (!response.ok || response.redirected) {
      throw new Error(`${response.status}${response.redirected ? ' (redirected)' : ''}`);
    }

    const html = await response.clone().text();
    await cache.put(url, response);

    const assets = new Set();
    for (const match of html.matchAll(/(?:src|href)="(\/_next\/[^"]+)"/g)) {
      assets.add(match[1]);
    }
    await Promise.all([...assets].map((asset) => precacheOne(cache, asset)));
  } catch (error) {
    console.warn('[sw] document precache skipped', url, error);
  }
}

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
      /*
       * Only this version's caches survive, and only the three the worker owns
       * by name. Every per-session API cache is deliberately NOT kept: its name
       * carries the version, so a deploy retires it, and the page re-announces
       * its session on the next load and starts a fresh one. Carrying an old
       * session's cached reads across a deploy would be exactly the kind of
       * long-lived leak this design exists to avoid.
       */
      const keep = new Set([PRECACHE_CACHE, RUNTIME_CACHE, META_CACHE]);
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
 * over; the page reloads on `controllerchange`. The `session`/`sign-out`
 * messages are the page telling this worker which session the local data belongs
 * to — see "Session scoping" at the top of the file. */
self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data !== 'object') return;

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

    if (data.type === 'connectivity') {
      networkOnline = data.online !== false;
      return;
    }

  const work =
    data.type === 'session' && typeof data.scope === 'string' && data.scope
      ? setSessionScope(data.scope)
      : data.type === 'sign-out'
        ? clearSessionScope()
        : data.type === 'cache-document' && typeof data.url === 'string' && data.url
          ? cacheCurrentDocument(data.url)
          : null;

  if (work && typeof event.waitUntil === 'function') event.waitUntil(work);
});

/* ==========================================================================
 * session scope
 * ========================================================================== */

/**
 * The current session's scope, memoised for this worker's lifetime and persisted
 * in `META_CACHE` so a restarted worker does not have to wait for the page to
 * tell it again.
 */
let sessionScope;

async function readSessionScope() {
  if (sessionScope !== undefined) return sessionScope;
  try {
    const meta = await caches.open(META_CACHE);
    const stored = await meta.match(SESSION_KEY);
    sessionScope = stored ? (await stored.text()) || null : null;
  } catch (error) {
    console.warn('[sw] session scope unavailable', error);
    sessionScope = null;
  }
  return sessionScope;
}

function apiCacheName(scope) {
  return `${API_CACHE_PREFIX}${scope}-${VERSION}`;
}

/**
 * Adopts `scope` as the session this worker caches for, and deletes every other
 * session's cache. This is the moment the previous account's data stops being
 * reachable from this device.
 */
async function setSessionScope(scope) {
  sessionScope = scope;
  try {
    const meta = await caches.open(META_CACHE);
    await meta.put(SESSION_KEY, new Response(scope, { headers: { 'Content-Type': 'text/plain' } }));
  } catch (error) {
    console.warn('[sw] could not persist the session scope', error);
  }

  const mine = apiCacheName(scope);
  const names = await caches.keys();
  await Promise.all(
    names.filter((name) => name.startsWith(API_CACHE_PREFIX) && name !== mine).map((name) => caches.delete(name)),
  );
}

/** Sign-out: the cached reads and the scope they belong to both go. */
async function clearSessionScope() {
  sessionScope = null;
  try {
    const meta = await caches.open(META_CACHE);
    await meta.delete(SESSION_KEY);
  } catch (error) {
    console.warn('[sw] could not clear the session scope', error);
  }

  const names = await caches.keys();
  await Promise.all(names.filter((name) => name.startsWith(API_CACHE_PREFIX)).map((name) => caches.delete(name)));
}

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
    // Credentials and session state are never cached, and never replaced with an
    // invented offline answer: a client that cannot ask "who am I?" must be told
    // so, not handed a stale identity.
    if (url.pathname.startsWith('/api/auth/')) {
      event.respondWith(fetch(request));
      return;
    }
    event.respondWith(sessionRead(request, event));
    return;
  }

  if (isRoutePayloadRequest(request, url)) {
    event.respondWith(sessionRead(request, event));
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
 * Navigation: network-first, then this session's copy of the same URL, then the
 * precached shell, then `/offline`.
 *
 * `event.preloadResponse` is the request the browser already made for us.
 */
async function navigationNetworkFirst(event) {
  const request = event.request;
  const scope = await readSessionScope();
  // Documents are rendered per user, so they live in the session's cache and
  // nowhere else. Before the worker knows the session there is nothing safe to
  // read or write here.
  const cache = scope ? await caches.open(apiCacheName(scope)) : null;
  const key = new Request(request.url, { method: 'GET' });

  try {
    /*
     * The preload and the fallback fetch are ONE request, and both are inside
     * the same race.
     *
     * `event.preloadResponse` used to be awaited on its own, ahead of the race.
     * With navigation preload enabled it is the request that is actually in
     * flight, so a link that HANGS rather than fails held the navigation for as
     * long as the browser's own request timeout — the documented
     * `NAVIGATION_TIMEOUT_MS` ceiling was never reached. Measured on a link
     * delayed by 20s: the navigation never resolved at all (>40s) even though
     * the document was already in this session's cache. Racing the whole thing
     * is what makes the ceiling mean what the comment above says it means.
     */
    const network = (async () => {
      const preloaded = await event.preloadResponse;
      if (preloaded) return preloaded;
      return trackedFetch(request);
    })();
    // Both branches above settle for real reasons; learn from either.
    void network.then(noteReachable, noteUnreachable);
    /*
     * Offline, or the network is hanging: answer from the cache first.
     *
     * Without this the handler awaited a fetch with no ceiling, so a weak
     * signal meant the screen froze until the browser gave up. The cache is
     * consulted first when the page (or a settled request) has told us there is
     * no network, and the fetch is raced against a grace otherwise — a cached
     * screen now or a fresh one shortly, never neither.
     *
     * The request is kept alive even here, so a connection that recovers while
     * the cached document is on screen refreshes the entry for the next visit
     * instead of leaving the worker stuck believing the link is dead.
     */
    if (!networkOnline && cache) {
      const offlineCopy = await cache.match(key);
      if (offlineCopy) {
        if (typeof event.waitUntil === 'function') event.waitUntil(storeDocument(cache, key, network));
        return offlineCopy;
      }
    }
    /*
     * The loser of the race must not surface later as an unhandled rejection:
     * if the grace or ceiling wins, the request is still in flight and may yet
     * fail.
     */
    void network.catch(() => undefined);
    /*
     * A document we already have does not wait out the hard ceiling: the grace
     * is enough to know the network is not answering, and the request stays in
     * flight to refresh the cache. Whether the SHORT grace applies is decided by
     * whether THIS URL has a cached document, not merely whether a session scope
     * exists — a first visit to an uncached route on a slow link must still get
     * the fresh document rather than be pushed to /offline early.
     */
    const cachedDocument = cache ? await cache.match(key) : null;
    const ceiling = cachedDocument ? CACHED_RESPONSE_GRACE_MS : NAVIGATION_TIMEOUT_MS;
    const winner = await Promise.race([network, delay(ceiling)]);
    if (!winner) throw new Error('navigation-timeout');
    const response = winner;
    if (cache && isDocumentCacheable(response)) {
      /*
       * Not awaited. `cache.put` streams the whole document into the cache, and
       * awaiting it here meant the page's own HTML was held back until that write
       * finished — a cost the user pays on every navigation, on storage that is
       * slowest exactly where it matters. `waitUntil` keeps the worker alive to
       * finish the write without making the screen wait for it.
       */
      const store = cache
        .put(key, response.clone())
        .then(() => trimApiCache(cache))
        .catch((error) => console.warn('[sw] navigation not cached', request.url, error));
      if (typeof event.waitUntil === 'function') event.waitUntil(store);
    }
    return response;
  } catch (error) {
    const requestedPath = new URL(request.url).pathname;

    if (cache) {
      const cached = await cache.match(key);
      if (cached) return cached;
    }

    const precache = await caches.open(PRECACHE_CACHE);

    /*
     * Cached HTML is only ever valid at the URL it was cached for.
     *
     * A Next.js App Router document carries the RSC payload for one specific
     * route. Serving a cached document at a DIFFERENT path — the root shell for
     * /settings, or even /offline for /settings — hands React a payload
     * describing another route, and the client throws:
     *
     *   "Application error: a client-side exception has occurred"
     *
     * which is a page that renders nothing and responds to nothing. So the only
     * permitted reuse is an exact-path match.
     */
    if (requestedPath === SHELL_URL) {
      const cached = await precache.match(requestedPath);
      if (cached) return cached;

      /*
       * The root is a redirect route, so there is usually no document for it
       * (see LANDING_URL). Offline, answer it the way the server would — by
       * sending the browser to the landing route — instead of falling through
       * to a page that says the app shell could not be loaded. If that route is
       * not cached either it follows the ordinary path to /offline below, so
       * this can only ever improve on the last-resort document.
       */
      return Response.redirect(new URL(LANDING_URL, self.location.origin).href, 302);
    }

    if (requestedPath === OFFLINE_URL) {
      const cached = await precache.match(requestedPath);
      if (cached) return cached;

      // /offline is itself unreachable and uncached. This document is
      // payload-free, so unlike a cached route it IS safe to serve anywhere.
      return new Response(LAST_RESORT_HTML, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
      });
    }

    /*
     * Any other failing navigation is REDIRECTED to /offline rather than
     * answered with a cached document.
     *
     * The redirect is what makes it correct: the browser then requests /offline
     * itself, that request fails too, and the exact-path branch above serves the
     * precached /offline document at its own URL — so route and payload agree.
     * The user sees the offline page with a correct address bar instead of a
     * broken render.
     */
    return Response.redirect(new URL(OFFLINE_URL, self.location.origin).href, 302);
  }
}

/**
 * Whether a navigation response may be kept as this session's copy of that URL.
 *
 * Only a real HTML document is stored. A redirect is refused (`fetch` follows it
 * and reports `redirected`), which is what keeps a login redirect out of the
 * cache — offline visitors must never be shown a sign-in page that cannot work.
 */
function isDocumentCacheable(response) {
  if (!response || !response.ok || response.redirected) return false;
  const contentType = response.headers.get('Content-Type') || '';
  return contentType.includes('text/html');
}

/** Content-hashed assets: cache-first, network only on a miss. */
async function cacheFirst(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await trackedFetch(request);
  if (isCacheable(request, response)) await cache.put(request, response.clone());
  return response;
}

/**
 * Stores a document that arrived after the cached copy was already served.
 *
 * The same background write the navigation strategy does when the fresh
 * response wins the race — here it is the *loser* of the race (or a request
 * started while the worker believed it was offline) that has to land.
 */
function storeDocument(cache, key, network) {
  return network
    .then(async (response) => {
      if (!isDocumentCacheable(response)) return;
      await cache.put(key, response.clone());
      await trimApiCache(cache);
    })
    .catch(() => undefined);
}

/**
 * Everything else same-origin: answer from cache immediately, refresh in the
 * background. `event.waitUntil` keeps the worker alive for the revalidation.
 */
async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(request);

  const revalidation = trackedFetch(request)
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
 * A route payload request: the App Router asking for one route's RSC payload on
 * a client-side navigation. `RSC: 1` is the header; `_rsc` is the cache-busting
 * parameter it is paired with. Either is enough to recognise one.
 */
function isRoutePayloadRequest(request, url) {
  if (request.headers.get('RSC') === '1') return true;
  return url.searchParams.has('_rsc');
}

/**
 * A read of this session's data: `/api/**` and route payloads.
 *
 * Three outcomes, in the order they are considered:
 *
 *   1. no session scope yet -> network-only. Caching a read before the worker
 *      knows which session it belongs to is how a cache leaks between accounts,
 *      so the honest default is to store nothing.
 *   2. network answers within the timeout -> return it (and store it for later).
 *   3. network fails or is too slow, and this session has a copy -> return the
 *      copy. The outstanding network request is kept alive so the cache is
 *      refreshed for the next read.
 *
 * With no copy and no network there is nothing honest to return, so the 503 with
 * the machine-readable `offline` flag goes back, exactly as before.
 */
async function sessionRead(request, event) {
  const scope = await readSessionScope();
  const url = new URL(request.url);
  // No session known: store nothing. An API read gets the machine-readable
  // offline answer; a route payload is passed straight through so the client
  // router sees an ordinary network failure and falls back the way it would
  // without a worker at all.
  if (!scope) return isRoutePayloadRequest(request, url) ? fetch(request) : apiNetworkOnly(request);

  const cache = await caches.open(apiCacheName(scope));

  /*
   * Route payloads prime their route's DOCUMENT as a side effect.
   *
   * A client-side navigation never asks this worker for a document, so `/calendar`
   * would have no cached document however often it was visited — and an offline
   * RELOAD of it would therefore land on `/offline`, losing the screen the user
   * was looking at. The payload request is the signal that the user is going to
   * that route, so the document is fetched and stored once, in the background,
   * only when it is not already cached.
   *
   * The URL is the one the payload was requested for, minus `_rsc` — the app puts
   * state in the query string (`/calendar?date=2026-09-19`), and a reload asks for
   * exactly that URL. Priming the bare pathname would cache a document nobody
   * ever requests.
   */
  if (isRoutePayloadRequest(request, url)) {
    const documentUrl = new URL(url.href);
    documentUrl.searchParams.delete('_rsc');
    event.waitUntil(primeDocument(cache, documentUrl.href));
  }

  /*
   * The cache key is the URL with the request's headers stripped.
   *
   * API responses are sent with `Vary: Cookie`, and the Cache API honours Vary
   * when matching. Keying on the live request would therefore store the cookie
   * with the entry and stop matching the moment better-auth rotates it — a cache
   * that silently empties itself every day. A cookie-less GET key is the same URL
   * for every read in this session's cache, which is sound precisely because the
   * cache itself belongs to one session.
   */
  const key = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(key);

  const network = trackedFetch(request)
    .then((response) => {
      if (isSessionReadCacheable(request, response)) {
        /*
         * Off the response path, for the same reason as a navigation: the caller
         * must not wait for a disk write it did not ask for.
         */
        const store = cache
          .put(key, response.clone())
          .then(() => trimApiCache(cache))
          .catch((error) => console.warn('[sw] read not cached', request.url, error));
        if (typeof event.waitUntil === 'function') event.waitUntil(store);
      }
      return response;
    })
    .catch(() => undefined);

  /*
   * Offline: the cache is the answer, and a miss is an answer too.
   *
   * `network` is already in flight above and stores whatever it gets, so a
   * connection that returns mid-request still warms the entry. What must not
   * happen is the *page* waiting for it — that wait is the freeze.
   */
  if (!networkOnline) {
    if (cached) {
      // Keep the request alive so a connection that returns mid-flight still
      // warms the entry rather than being cancelled by the early return.
      if (typeof event.waitUntil === 'function') event.waitUntil(network);
      return cached;
    }
    return (await network) || offlineResponse();
  }

  if (!cached) {
    /*
     * Nothing cached to serve sooner, so wait for the network — but not
     * forever. A read that is going to fail should not hold a screen until the
     * browser's own timeout decides; the hard ceiling turns it into the
     * machine-readable offline answer the client already understands.
     */
    const fresh = await Promise.race([network, delay(API_TIMEOUT_MS)]);
    if (fresh) return fresh;
    if (typeof event.waitUntil === 'function') event.waitUntil(network);
    return offlineResponse();
  }

  /*
   * A cached answer is served after the short grace, not the hard ceiling: the
   * cached copy is on its way out to the page, and the request that is still in
   * flight is kept alive so the entry is fresh next time.
   */
  const winner = await Promise.race([network, delay(CACHED_RESPONSE_GRACE_MS)]);
  if (winner) return winner;

  event.waitUntil(network);
  return cached;
}

/**
 * Stores the page's own document in its session cache, at its exact URL.
 *
 * This is the request the worker could not observe for itself. On a first visit
 * the document that booted the app was fetched before the worker was
 * controlling, so the navigation strategy never saw it and nothing was stored;
 * from then on only client-side navigations (which do go through the worker)
 * populated the cache. A fresh offline open therefore had no document for its
 * URL and fell through to `/offline`.
 *
 * Only this worker's own origin is accepted, and only a real HTML document is
 * kept (`primeDocument` applies the same `isDocumentCacheable` gate as a
 * navigation), so a login redirect or an API path can never be stored. With no
 * session known nothing is stored either — that is the same per-session rule
 * every other write follows; the page retries on its next load.
 */
async function cacheCurrentDocument(rawUrl) {
  let target;
  try {
    target = new URL(rawUrl, self.location.origin);
  } catch (error) {
    return;
  }
  if (target.origin !== self.location.origin) return;
  if (target.pathname.startsWith(API_PREFIX) || target.pathname.startsWith('/_next/')) return;

  const scope = await readSessionScope();
  if (!scope) return;

  const cache = await caches.open(apiCacheName(scope));
  await primeDocument(cache, target.href);
}

/** Fetches and stores one route's document, unless this session already has it. */
async function primeDocument(cache, url) {
  try {
    const key = new Request(url, { method: 'GET' });
    if (await cache.match(key)) return;
    const response = await trackedFetch(key, { credentials: 'same-origin' });
    if (!isDocumentCacheable(response)) return;
    await cache.put(key, response.clone());
    await trimApiCache(cache);
  } catch (error) {
    // Offline, or the route needs a session that is gone: nothing to prime.
  }
}

/** Resolves to `undefined` after `ms`, which is what makes the race above safe. */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Whether a session read may be stored: JSON API data, or a route payload.
 *
 * Stricter than `isCacheable` on purpose, and for different reasons: only a 200
 * of a known, per-session content type is stored, so an error envelope, a
 * redirect to login, or a streamed export can never be replayed to the user as
 * if it were data. The `no-store` header every API response carries is
 * deliberately ignored — it exists to keep authenticated data out of a SHARED
 * cache, and this one belongs to a single session.
 */
function isSessionReadCacheable(request, response) {
  if (request.method !== 'GET') return false;
  if (!response || response.status !== 200) return false;
  const contentType = response.headers.get('Content-Type') || '';
  return contentType.includes('application/json') || contentType.includes('x-component');
}

/**
 * Keeps the per-session API cache bounded.
 *
 * Reads are cached per exact query string (a month of calendar items, a task
 * window), so an app used for a year would otherwise accumulate one entry per
 * view it has ever opened. Cache keys come back in insertion order, so dropping
 * the first ones is a coarse least-recently-created eviction — enough to bound
 * the cache, which is all this needs to do.
 */
async function trimApiCache(cache) {
  const keys = await cache.keys();
  const excess = keys.length - API_CACHE_MAX_ENTRIES;
  if (excess <= 0) return;
  await Promise.all(keys.slice(0, excess).map((key) => cache.delete(key)));
}

/** `/api/**` with no session scope, or with nothing cached: network, or nothing. */
async function apiNetworkOnly(request) {
  try {
    return await trackedFetch(request);
  } catch (error) {
    return offlineResponse();
  }
}

/** The machine-readable "the network is gone" answer the client understands. */
function offlineResponse() {
  return new Response(JSON.stringify({ offline: true, error: 'network-unavailable' }), {
    status: 503,
    statusText: 'Service Unavailable',
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

/**
 * The single gate in front of every `cache.put` in this file.
 * `no-store` responses are never stored, only GETs are eligible, and opaque
 * cross-origin responses never reach here (they are filtered in `fetch`).
 */
function isCacheable(request, response) {
  if (request.method !== 'GET') return false;
  if (!response || !response.ok || response.type === 'opaqueredirect') return false;
  const contentType = response.headers.get('Content-Type') || '';
  /*
   * React Server Component payloads are per-user data in a shared runtime cache.
   * They are excluded by content type rather than by request header because the
   * response is what must never be reused across sessions — the header is just
   * how they are usually requested.
   */
  if (contentType.includes('x-component')) return false;
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
