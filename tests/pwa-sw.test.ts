/**
 * `public/sw.js`, executed in a `node:vm` sandbox with stub Cache/Response/fetch
 * globals.
 *
 * The service worker drifts silently: nothing in the app fails when the API
 * starts being cached, when `no-store` is ignored, or when a navigation stops
 * falling back to the shell. It only shows up as a data leak or a blank screen
 * on a bad connection, so the strategy table at the top of the file is pinned
 * here instead.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
const ORIGIN = 'https://tasks.example.com';

/**
 * Read from the worker's own source rather than pinned here.
 *
 * `VERSION` exists to change on every deploy that alters a precached file; a
 * test that hardcodes it would have to be edited on every release, which is
 * exactly when nobody is reading the diff carefully.
 */
const SW_VERSION = /const VERSION = '([^']+)'/.exec(SOURCE)?.[1];
if (!SW_VERSION) throw new Error('could not read VERSION out of public/sw.js');
/** Read too, so "the ceiling" in a test is the one the worker actually uses. */
const NAVIGATION_TIMEOUT_MS = Number(/const NAVIGATION_TIMEOUT_MS = (\d+)/.exec(SOURCE)?.[1]);
if (!NAVIGATION_TIMEOUT_MS) throw new Error('could not read NAVIGATION_TIMEOUT_MS out of public/sw.js');
/** The cached-read ceiling — the one that decides how long a tab tap waits. */
const API_TIMEOUT_MS = Number(/const API_TIMEOUT_MS = (\d+)/.exec(SOURCE)?.[1]);
if (!API_TIMEOUT_MS) throw new Error('could not read API_TIMEOUT_MS out of public/sw.js');
/** How long a response that ALREADY has a cached copy waits for the network. */
const CACHED_RESPONSE_GRACE_MS = Number(/const CACHED_RESPONSE_GRACE_MS = (\d+)/.exec(SOURCE)?.[1]);
if (!CACHED_RESPONSE_GRACE_MS) throw new Error('could not read CACHED_RESPONSE_GRACE_MS out of public/sw.js');
const PRECACHE = `precache-${SW_VERSION}`;
const RUNTIME = `runtime-${SW_VERSION}`;
const META = `meta-${SW_VERSION}`;

/* -------------------------------------------------------------------------- */
/* stubs                                                                      */
/* -------------------------------------------------------------------------- */

class FakeHeaders {
  private readonly map: Map<string, string>;

  constructor(init: Record<string, string> = {}) {
    this.map = new Map(Object.entries(init).map(([key, value]) => [key.toLowerCase(), value]));
  }

  get(name: string): string | null {
    return this.map.get(name.toLowerCase()) ?? null;
  }
}

class FakeResponse {
  ok: boolean;
  status: number;
  type = 'basic';
  redirected: boolean;
  headers: FakeHeaders;

  constructor(
    public body = '',
    init: { status?: number; headers?: Record<string, string>; redirected?: boolean } = {},
  ) {
    this.status = init.status ?? 200;
    this.ok = this.status >= 200 && this.status < 300;
    this.headers = new FakeHeaders(init.headers);
    this.redirected = init.redirected ?? false;
  }

  static error(): FakeResponse {
    const response = new FakeResponse('', { status: 0 });
    response.ok = false;
    response.type = 'error';
    return response;
  }

  /**
   * Mirrors the real `Response.redirect`, which the worker uses to send a failed
   * navigation to `/offline` instead of answering it with a cached document from
   * a different route.
   */
  static redirect(url: string, status = 302): FakeResponse {
    const response = new FakeResponse('', { status, headers: { location: url } });
    response.type = 'default';
    return response;
  }

  clone(): FakeResponse {
    const copy = new FakeResponse(this.body, { status: this.status, redirected: this.redirected });
    copy.headers = this.headers;
    copy.type = this.type;
    return copy;
  }

  json(): unknown {
    return JSON.parse(this.body);
  }

  text(): string {
    return this.body;
  }
}

class FakeRequest {
  readonly method: string;
  readonly url: string;
  readonly mode: string;
  readonly headers: FakeHeaders;

  constructor(url: string, init: { method?: string; mode?: string; headers?: Record<string, string> } = {}) {
    this.url = new URL(url, ORIGIN).href;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'no-cors';
    this.headers = new FakeHeaders(init.headers ?? {});
  }
}

interface Harness {
  /** Dispatch an event; resolves with the response passed to respondWith(). */
  dispatch(type: string, event: unknown): Promise<FakeResponse | undefined>;
  /** Everything written to any cache, in order. */
  writes: string[];
  /** Cache name -> URL -> response. */
  caches: Map<string, Map<string, FakeResponse>>;
  fetchCalls: string[];
  /** Fire `install` with the network presumably up. */
  install(route: (url: string, request: FakeRequest) => FakeResponse | Error): Promise<void>;
  activate(): Promise<void>;
  navigation(url: string, route: Route, preload?: Promise<FakeResponse | undefined>): Promise<FakeResponse | undefined>;
  get(url: string, route: Route, init?: { mode?: string; headers?: Record<string, string>; awaitWaits?: boolean }): Promise<FakeResponse | undefined>;
  request(url: string, init?: { method?: string }): Promise<FakeResponse | undefined>;
  /** Point the fake network at a route without dispatching anything. */
  setRoute(route: Route): void;
  /** Deliver a `message` event from the page (session scope, sign-out, …). */
  message(data: unknown): Promise<void>;
}

type Route = (url: string, request: FakeRequest) => FakeResponse | Error;

function createHarness(): Harness {
  const listeners = new Map<string, (event: any) => void>();
  const store = new Map<string, Map<string, FakeResponse>>();
  const writes: string[] = [];
  const fetchCalls: string[] = [];

  const cacheFor = (name: string): Map<string, FakeResponse> => {
    if (!store.has(name)) store.set(name, new Map());
    return store.get(name)!;
  };

  const normalize = (target: unknown): string =>
    typeof target === 'string' ? new URL(target, ORIGIN).href : (target as FakeRequest).url;

  const caches = {
    open: async (name: string) => {
      const entries = cacheFor(name);
      return {
        put: async (target: unknown, response: FakeResponse) => {
          writes.push(`${name} ${normalize(target)}`);
          entries.set(normalize(target), response);
        },
        match: async (target: unknown) => entries.get(normalize(target)),
        delete: async (target: unknown) => entries.delete(normalize(target)),
        keys: async () => [...entries.keys()].map((url) => new FakeRequest(url)),
        add: async () => undefined,
      };
    },
    keys: async () => [...store.keys()],
    delete: async (name: string) => store.delete(name),
    match: async (target: unknown) => {
      for (const entries of store.values()) {
        const hit = entries.get(normalize(target));
        if (hit) return hit;
      }
      return undefined;
    },
  };

  let route: Route = () => new FakeResponse('network');

  const fetchStub = (target: unknown) => {
    const request =
      typeof target === 'string'
        ? new FakeRequest(target)
        : (target as FakeRequest & { clone?: () => FakeRequest });
    fetchCalls.push(`${request.method} ${request.url}`);
    const result = route(request.url, request as FakeRequest);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  };

  const sandbox: Record<string, unknown> = {
    self: {
      addEventListener: (type: string, handler: (event: any) => void) => listeners.set(type, handler),
      skipWaiting: async () => undefined,
      location: { origin: ORIGIN },
      clients: {
        claim: async () => undefined,
        matchAll: async () => [],
        openWindow: async () => undefined,
      },
      registration: {
        navigationPreload: { enable: async () => undefined },
        showNotification: async () => undefined,
      },
    },
    caches,
    fetch: fetchStub,
    Request: FakeRequest,
    Response: FakeResponse,
    URL,
    // The worker's API-cache timeout races the network against a timer; a test
    // that wants the cached branch drives this with fake timers.
    setTimeout: (fn: () => void, ms?: number) => setTimeout(fn, ms),
    clearTimeout: (handle: unknown) => clearTimeout(handle as never),
    console: { warn: () => undefined, error: () => undefined, log: () => undefined },
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  /** Resolves once the event's respondWith() and any waitUntil() work settles. */
  const dispatch = async (type: string, event: unknown, awaitWaits = true): Promise<FakeResponse | undefined> => {
    const handler = listeners.get(type);
    if (!handler) throw new Error(`no ${type} listener registered`);
    await handler(event as never);

    const { response, waits } = event as {
      response?: Promise<FakeResponse>;
      waits?: Promise<unknown>[];
    };
    const result = response ? await response : undefined;
    // Background work (stale-while-revalidate, activation cleanup) must settle
    // before a test inspects the caches. A test that intentionally leaves a
    // background request hanging passes awaitWaits=false.
    if (awaitWaits && waits && waits.length > 0) await Promise.all(waits);
    return result;
  };

  const makeEvent = (request: FakeRequest, preload?: FakeResponse) => {
    const event: {
      request: FakeRequest;
      preloadResponse: Promise<FakeResponse | undefined>;
      response?: Promise<FakeResponse>;
      waits: Promise<unknown>[];
      respondWith: (value: Promise<FakeResponse>) => void;
      waitUntil: (value: Promise<unknown>) => void;
    } = {
      request,
      preloadResponse: Promise.resolve(preload),
      waits: [],
      respondWith(value) {
        this.response = value;
      },
      waitUntil(value) {
        this.waits.push(value);
      },
    };
    return event;
  };

  return {
    writes,
    caches: store,
    fetchCalls,
    dispatch,
    async install(installRoute) {
      route = installRoute;
      const waits: Promise<unknown>[] = [];
      await dispatch('install', { waitUntil: (value: Promise<unknown>) => void waits.push(value) });
      await Promise.all(waits);
    },
    async activate() {
      const waits: Promise<unknown>[] = [];
      await dispatch('activate', { waitUntil: (value: Promise<unknown>) => void waits.push(value) });
      await Promise.all(waits);
    },
    async navigation(url, navigationRoute, preload) {
      route = navigationRoute;
      return dispatch('fetch', makeEvent(new FakeRequest(url, { mode: 'navigate' }), preload as never));
    },
    async get(url, getRoute, init = {}) {
      route = getRoute;
      return dispatch('fetch', makeEvent(new FakeRequest(url, { mode: init.mode ?? 'cors', headers: init.headers })), init.awaitWaits !== false);
    },
    async request(url, init = {}) {
      return dispatch('fetch', makeEvent(new FakeRequest(url, init)));
    },
    setRoute(next) {
      route = next;
    },
    async message(data) {
      const waits: Promise<unknown>[] = [];
      await dispatch('message', {
        data,
        waits,
        waitUntil(value: Promise<unknown>) {
          waits.push(value);
        },
      });
    },
  };
}

/** Precache install with a network that only serves the shell and /offline. */
async function installedHarness(): Promise<Harness> {
  const harness = createHarness();
  await harness.install((url) => {
    if (url.endsWith('/') || url.endsWith('/offline')) return new FakeResponse(`<html>${url}</html>`);
    return new FakeResponse('asset');
  });
  // Only runtime writes are interesting from here on.
  harness.writes.length = 0;
  return harness;
}

/** Create-or-extend a named cache with canned entries. */
function seedCache(harness: Harness, name: string, entries: Record<string, string>): void {
  const cache = harness.caches.get(name) ?? new Map<string, FakeResponse>();
  for (const [url, body] of Object.entries(entries)) cache.set(url, new FakeResponse(body));
  harness.caches.set(name, cache);
}

const shellResponse = async (harness: Harness, url = `${ORIGIN}/`) => {
  const cache = await harness.caches.get(PRECACHE)!.get(new URL(url, ORIGIN).href);
  return cache;
};

/* -------------------------------------------------------------------------- */
/* tests                                                                      */
/* -------------------------------------------------------------------------- */

describe('service worker scope', () => {
  it('does not intercept non-GET requests', async () => {
    const harness = createHarness();
    const response = await harness.request(`${ORIGIN}/api/tasks`, { method: 'POST' });
    expect(response).toBeUndefined();
    expect(harness.writes).toEqual([]);
  });

  it('does not intercept cross-origin requests', async () => {
    const harness = createHarness();
    const response = await harness.get('https://cdn.example.net/app.js', () => new FakeResponse('x'));
    expect(response).toBeUndefined();
    expect(harness.writes).toEqual([]);
  });
});

const API_CACHE = `api-s1-${SW_VERSION}`;

/** An HTML document as the server really sends it. */
function html(body: string): FakeResponse {
  return new FakeResponse(body, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

/**
 * Announces the session scope and forgets the bookkeeping write it causes, so a
 * test only sees the API cache writes made by the reads it performs.
 */
async function announce(harness: Harness, scope: string): Promise<void> {
  await harness.message({ type: 'session', scope });
  harness.writes.length = 0;
}

/** An API response as the server really sends it: 200, JSON, `no-store`. */
function json(body: string, status = 200): FakeResponse {
  return new FakeResponse(body, {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private', Vary: 'Cookie' },
  });
}

describe('/api/** reads are network-first with a per-session cache', () => {
  it('stores nothing before the worker knows which session it is caching for', async () => {
    const harness = createHarness();
    const response = await harness.get(`${ORIGIN}/api/tasks`, () => json('[1,2,3]'));
    expect(response?.status).toBe(200);
    expect(response?.body).toBe('[1,2,3]');
    expect(harness.writes).toEqual([]);
  });

  it('caches a read under the announced session, and serves it when the network fails', async () => {
    const harness = createHarness();
    await announce(harness, 's1');

    const online = await harness.get(`${ORIGIN}/api/tasks`, () => json('[1,2,3]'));
    expect(online?.body).toBe('[1,2,3]');
    expect(harness.writes).toEqual([`${API_CACHE} ${ORIGIN}/api/tasks`]);

    const offline = await harness.get(`${ORIGIN}/api/tasks`, () => new Error('offline'));
    expect(offline?.status).toBe(200);
    expect(offline?.body).toBe('[1,2,3]');
  });

  it('falls back to the cached copy after the short grace, well before the hard ceiling', async () => {
    vi.useFakeTimers();
    try {
      const harness = createHarness();
      await announce(harness, 's1');
      await harness.get(`${ORIGIN}/api/tasks`, () => json('["cached"]'));

      // A network that answers, but only after 10 seconds: "bad cell service".
      const slow = new Promise<FakeResponse>((resolve) => {
        setTimeout(() => resolve(json('["fresh"]')), 10_000);
      });
      const pending = harness.get(`${ORIGIN}/api/tasks`, () => slow as never, { awaitWaits: false });

      // Let the worker's own async setup (reading the scope, opening the cache)
      // finish before the clock moves, or the timeout timer would be created
      // after the jump and lose the race it is supposed to win.
      await vi.advanceTimersByTimeAsync(1);
      /*
       * Just past the GRACE: the cached copy is what the page gets. That the
       * page does not wait the full hard ceiling is the whole point of the
       * grace — on a link that hangs, that ceiling was the multi-second freeze.
       */
      await vi.advanceTimersByTimeAsync(CACHED_RESPONSE_GRACE_MS + 50);
      const response = await pending;
      expect(response?.body).toBe('["cached"]');
      // The slow answer is still used to refresh the cache for next time.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(harness.caches.get(API_CACHE)!.get(`${ORIGIN}/api/tasks`)?.body).toBe('["fresh"]');
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves a cached read after a failed request without waiting at all', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    await harness.get(`${ORIGIN}/api/tasks`, () => json('[1,2,3]'));
    // One settled failure is enough for the worker to learn the link is down.
    await harness.get(`${ORIGIN}/api/habits`, () => new Error('offline'));

    vi.useFakeTimers();
    try {
      // A network that never answers. If the worker had not learned, this would
      // wait out the grace before serving the cache.
      const pending = harness.get(`${ORIGIN}/api/tasks`, () => new Promise<FakeResponse>(() => undefined) as never, {
        awaitWaits: false,
      });
      const response = await pending;
      expect(response?.body).toBe('[1,2,3]');
      // Nothing on the clock: no timer was created, so no wait was paid.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the cached-response grace short, and the hard ceilings bounded', () => {
    // The grace is the number a person feels on a link that hangs. It must stay
    // small enough to be imperceptible next to the old multi-second freeze,
    // while a healthy connection (measured ~250ms for a tab tap, ~330ms for a
    // document navigation) still wins the race.
    expect(CACHED_RESPONSE_GRACE_MS).toBeLessThanOrEqual(1000);
    expect(CACHED_RESPONSE_GRACE_MS).toBeLessThan(API_TIMEOUT_MS);
    // Six seconds was the reported "~5 seconds"; the hard ceiling is pinned so
    // it cannot creep back up unnoticed.
    expect(API_TIMEOUT_MS).toBeLessThanOrEqual(2000);
    // A navigation with nothing cached still needs a ceiling, but it should not
    // be an open-ended one.
    expect(NAVIGATION_TIMEOUT_MS).toBeLessThanOrEqual(5000);
  });

  it('answers 503 with a JSON offline flag when there is nothing cached', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    const response = await harness.get(`${ORIGIN}/api/tasks`, () => new Error('offline'));
    expect(response?.status).toBe(503);
    expect(response?.headers.get('Content-Type')).toBe('application/json');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    expect(response?.json()).toEqual({ offline: true, error: 'network-unavailable' });
  });

  it('never caches a non-200 or a non-JSON API response', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    await harness.get(`${ORIGIN}/api/tasks`, () => json('boom', 500));
    await harness.get(`${ORIGIN}/api/export?format=ics`, () =>
      new FakeResponse('BEGIN:VCALENDAR', { headers: { 'Content-Type': 'text/calendar' } }),
    );
    expect(harness.writes).toEqual([]);
  });

  it('does not cache reads from a different query string at the same URL', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    await harness.get(`${ORIGIN}/api/tasks?window=today`, () => json('["today"]'));
    const other = await harness.get(`${ORIGIN}/api/tasks?window=all`, () => new Error('offline'));
    expect(other?.status).toBe(503);
  });

  it('deletes another session\'s cache as soon as a new session is announced', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    await harness.get(`${ORIGIN}/api/tasks`, () => json('["account-a"]'));
    expect([...harness.caches.keys()]).toContain(API_CACHE);

    await announce(harness, 's2');
    expect([...harness.caches.keys()]).not.toContain(API_CACHE);

    // The new session cannot be served account A's data even offline.
    const offline = await harness.get(`${ORIGIN}/api/tasks`, () => new Error('offline'));
    expect(offline?.status).toBe(503);
  });

  it('drops every API cache and the stored scope on sign-out', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    await harness.get(`${ORIGIN}/api/tasks`, () => json('["account-a"]'));

    await harness.message({ type: 'sign-out' });
    expect([...harness.caches.keys()].filter((name) => name.startsWith('api-'))).toEqual([]);
    harness.writes.length = 0;

    // With the scope gone the worker is back to "no session known", so it does
    // not even try to cache a fresh read.
    await harness.get(`${ORIGIN}/api/habits`, () => json('[]'));
    expect(harness.writes.filter((write) => write.startsWith('api-'))).toEqual([]);
  });

  it('keeps the scope across a worker restart (it is read from META_CACHE)', async () => {
    const first = createHarness();
    await announce(first, 's1');
    const stored = await first.caches.get(META)!.get(`${ORIGIN}/__session`);
    expect(stored?.body).toBe('s1');

    // A fresh worker (same caches, empty memory) picks the scope back up.
    const second = createHarness();
    second.caches.set(META, first.caches.get(META)!);
    await second.get(`${ORIGIN}/api/tasks`, () => json('[]'));
    expect(second.writes).toEqual([`${API_CACHE} ${ORIGIN}/api/tasks`]);
  });
});

describe('route payloads, so a tab tap works offline', () => {
  const PAYLOAD = `${ORIGIN}/calendar?_rsc=abc123`;
  const rsc = (body: string) =>
    new FakeResponse(body, {
      headers: { 'Content-Type': 'text/x-component', 'Cache-Control': 'no-store, private', Vary: 'RSC, Next-Router-State-Tree' },
    });

  it('recognises a payload request by its header or its query parameter', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    // `_rsc` only.
    await harness.get(PAYLOAD, () => rsc('flight-payload'));
    expect(harness.caches.get(API_CACHE)!.get(PAYLOAD)?.body).toBe('flight-payload');
    // The `RSC: 1` header only, with no `_rsc` parameter on the URL.
    await harness.get(`${ORIGIN}/habits`, () => rsc('habits-payload'), { headers: { RSC: '1' } });
    expect(harness.caches.get(API_CACHE)!.get(`${ORIGIN}/habits`)?.body).toBe('habits-payload');
  });

  it('serves a payload from cache when the network is gone', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    await harness.get(PAYLOAD, () => rsc('flight-payload'));

    const offline = await harness.get(PAYLOAD, () => new Error('offline'));
    expect(offline?.status).toBe(200);
    expect(offline?.body).toBe('flight-payload');
  });

  it('primes the route’s own document, at the URL a reload would ask for', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');

    // The app puts its state in the query string, and the payload request carries
    // that state plus `_rsc`. The document must be primed for the URL a reload
    // will use, not for the bare pathname.
    const themed = `${ORIGIN}/calendar?date=2026-09-19&_rsc=abc123`;
    await harness.get(themed, (url) => (url.includes('_rsc') ? rsc('flight-payload') : html('<html>calendar</html>')));

    const cached = harness.caches.get(API_CACHE)!.get(`${ORIGIN}/calendar?date=2026-09-19`);
    expect(cached?.body).toBe('<html>calendar</html>');

    // Which is what makes an offline RELOAD of that route possible.
    const reload = await harness.navigation(`${ORIGIN}/calendar?date=2026-09-19`, () => new Error('offline'));
    expect(reload?.status).toBe(200);
    expect(reload?.body).toBe('<html>calendar</html>');
  });

  it('does not store an error or a non-payload body as a route payload', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    await harness.get(PAYLOAD, () => json('{"ok":false}', 500));
    expect(harness.writes).toEqual([]);
  });
});

describe('/api/auth/** is never intercepted for caching', () => {
  it('passes the session endpoint straight through, cached or not', async () => {
    const harness = createHarness();
    await announce(harness, 's1');
    const response = await harness.get(`${ORIGIN}/api/auth/get-session`, () => new FakeResponse('{"user":null}'));
    expect(response?.body).toBe('{"user":null}');
    expect(harness.writes).toEqual([]);
  });
});

describe('navigations are network-first with a shell fallback', () => {
  it('returns the network response when it is reachable', async () => {
    const harness = await installedHarness();
    const response = await harness.navigation(`${ORIGIN}/today`, () => new FakeResponse('<html>today</html>'));
    expect(response?.body).toBe('<html>today</html>');
    expect(harness.writes).toEqual([]); // navigations are never written at runtime
  });

  it('races a hanging navigation preload against the grace instead of awaiting it forever', async () => {
    vi.useFakeTimers();
    try {
      const harness = await installedHarness();
      await announce(harness, 's1');
      // A visit that cached the document, so there is something valid to fall
      // back to.
      await harness.navigation(`${ORIGIN}/tasks`, () => html('<html>tasks</html>'));

      /*
       * Navigation preload is the request that is actually in flight, so a link
       * that HANGS rather than fails used to hold the screen for as long as the
       * browser's own request timeout: `event.preloadResponse` was awaited
       * AHEAD of the race. Measured against a link delayed by 20s, the
       * navigation never resolved at all (>40s) even though the document was
       * already cached.
       */
      const preload = new Promise<FakeResponse | undefined>(() => undefined);
      const pending = harness.navigation(`${ORIGIN}/tasks`, () => new Error('offline'), preload);

      // Let the worker's own async setup run, then step past the GRACE. A
      // cached document is served on the grace, not the 3s hard ceiling.
      await vi.advanceTimersByTimeAsync(1);
      await vi.advanceTimersByTimeAsync(CACHED_RESPONSE_GRACE_MS + 50);

      const response = await pending;
      expect(response?.status).toBe(200);
      expect(response?.body).toBe('<html>tasks</html>');
    } finally {
      vi.useRealTimers();
    }
  });

  it('lets a slow-but-alive uncached navigation wait for the fresh document', async () => {
    vi.useFakeTimers();
    try {
      const harness = await installedHarness();
      await announce(harness, 's1');

      // /settings has never been cached. Its document answers later than the
      // grace but well inside the hard ceiling — a slow-but-ALIVE link.
      const slow = new Promise<FakeResponse>((resolve) => {
        setTimeout(() => resolve(html('<html>settings</html>')), CACHED_RESPONSE_GRACE_MS + 500);
      });
      const pending = harness.navigation(`${ORIGIN}/settings`, () => slow as never);

      await vi.advanceTimersByTimeAsync(1);
      // Past the grace: an uncached route must NOT be answered with the offline
      // redirect just because the link is slow. Only a document we already have
      // may be served early.
      await vi.advanceTimersByTimeAsync(CACHED_RESPONSE_GRACE_MS + 100);
      await vi.advanceTimersByTimeAsync(1000);

      const response = await pending;
      expect(response?.status).toBe(200);
      expect(response?.body).toBe('<html>settings</html>');
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves an offline reload of a visited URL from this session\'s own copy', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');

    // The screen the user is looking at, fetched while online.
    await harness.navigation(`${ORIGIN}/tasks`, () =>
      html('<html>tasks for account A</html>'),
    );

    // Reload with no network: same URL, same payload, so React can hydrate it.
    const reloaded = await harness.navigation(`${ORIGIN}/tasks`, () => new Error('offline'));
    expect(reloaded?.status).toBe(200);
    expect(reloaded?.body).toBe('<html>tasks for account A</html>');
  });

  it('never serves one URL\'s document at another URL', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');
    await harness.navigation(`${ORIGIN}/tasks`, () => html('<html>tasks</html>'));

    // /settings was never visited, so there is nothing valid to serve there and
    // the worker redirects to /offline instead of handing React the wrong route.
    const settings = await harness.navigation(`${ORIGIN}/settings`, () => new Error('offline'));
    expect(settings?.status).toBe(302);
    expect(settings?.headers.get('location')).toBe(`${ORIGIN}/offline`);
  });

  it('keeps documents in the session cache, never the shared runtime cache', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');
    await harness.navigation(`${ORIGIN}/tasks`, () => html('<html>tasks</html>'));

    expect(harness.writes).toEqual([`${API_CACHE} ${ORIGIN}/tasks`]);
    expect(harness.caches.get(RUNTIME)?.size ?? 0).toBe(0);

    // And a different session starts with nothing.
    await announce(harness, 's2');
    const other = await harness.navigation(`${ORIGIN}/tasks`, () => new Error('offline'));
    expect(other?.status).toBe(302);
  });

  it('never stores the login redirect a signed-out visit produces', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');
    await harness.navigation(`${ORIGIN}/tasks`, () => new FakeResponse('<html>login</html>', { redirected: true }));
    expect(harness.writes).toEqual([]);
  });

  it('redirects a failed non-root navigation to /offline rather than serving foreign HTML', async () => {
    const harness = await installedHarness();

    /*
     * Serving cached HTML at a URL it was not cached for hands React an RSC
     * payload for a different route, and the client throws
     * "Application error: a client-side exception has occurred" — a page that
     * renders nothing and responds to nothing. The redirect is what keeps route
     * and payload in agreement.
     */
    const other = await harness.navigation(`${ORIGIN}/settings`, () => new Error('offline'));
    expect(other?.status).toBe(302);
    expect(other?.headers.get('location')).toBe(`${ORIGIN}/offline`);
  });

  it('serves the precached /offline document at its own URL, after the redirect', async () => {
    const harness = await installedHarness();
    // What the browser requests once it follows the redirect above.
    const offlinePage = await harness.navigation(`${ORIGIN}/offline`, () => new Error('offline'));
    expect(offlinePage?.status).toBe(200);
    expect(offlinePage?.body).toBe(`<html>${ORIGIN}/offline</html>`);
  });

  it('may serve the shell at the root, which is the route it belongs to', async () => {
    const harness = await installedHarness();
    const root = await harness.navigation(`${ORIGIN}/`, () => new Error('offline'));
    expect(root?.body).toBe(`<html>${ORIGIN}/</html>`);
  });

  it('sends an offline cold start at the root to the landing route it has cached', async () => {
    /*
     * The installed app's `start_url` is `/`, and `/` is a redirect route
     * (`src/app/page.tsx`). A redirect is deliberately never cached, so in
     * production the root has no precached document — and an offline cold start
     * used to be handed the last-resort "couldn't load its app shell" page even
     * when the screen it wanted was in the session cache. The install below is
     * the real one, redirecting the root.
     */
    const harness = createHarness();
    await harness.install((url) => {
      if (url.endsWith('/')) return new FakeResponse('<html>login</html>', { redirected: true });
      if (url.endsWith('/offline')) return new FakeResponse('<html>offline</html>');
      return new FakeResponse('asset');
    });
    await announce(harness, 's1');
    await harness.navigation(`${ORIGIN}/tasks`, () => html('<html>tasks</html>'));

    const root = await harness.navigation(`${ORIGIN}/`, () => new Error('offline'));
    expect(root?.status).toBe(302);
    expect(root?.headers.get('location')).toBe(`${ORIGIN}/tasks`);

    // The browser's follow-up is served at its own URL, so route and payload
    // still agree.
    const landing = await harness.navigation(`${ORIGIN}/tasks`, () => new Error('offline'));
    expect(landing?.status).toBe(200);
    expect(landing?.body).toBe('<html>tasks</html>');
  });

  it('redirects to /offline when the precache is empty, then shows a last-resort document there', async () => {
    const harness = createHarness();

    // Nothing is precached and the network is down: a non-root navigation cannot
    // be answered with a document, so it is redirected to /offline.
    const redirect = await harness.navigation(`${ORIGIN}/today`, () => new Error('offline'));
    expect(redirect?.status).toBe(302);
    expect(redirect?.headers.get('location')).toBe(`${ORIGIN}/offline`);

    // /offline itself has nothing cached, so the payload-free document is served
    // there. It is safe at any URL precisely because it carries no RSC payload —
    // which is also why it must never be served as a substitute for a route that
    // does have one.
    const response = await harness.navigation(`${ORIGIN}/offline`, () => new Error('offline'));
    expect(response?.status).toBe(200);
    expect(response?.body).toContain('TaskTick');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
  });

  it('never stores a login redirect as the shell', async () => {
    const harness = createHarness();
    await harness.install((url) => {
      if (url.endsWith('/')) return new FakeResponse('<html>login</html>', { redirected: true });
      if (url.endsWith('/offline')) return new FakeResponse('<html>offline</html>');
      return new FakeResponse('asset');
    });
    expect(await shellResponse(harness)).toBeUndefined();

    // A rejected login redirect must not become the shell, so the root has
    // nothing to serve. It is sent to the app's landing route, which follows
    // the ordinary path to /offline when that is not cached either.
    const root = await harness.navigation(`${ORIGIN}/`, () => new Error('offline'));
    expect(root?.status).toBe(302);
    expect(root?.headers.get('location')).toBe(`${ORIGIN}/tasks`);

    const landing = await harness.navigation(`${ORIGIN}/tasks`, () => new Error('offline'));
    expect(landing?.status).toBe(302);
    expect(landing?.headers.get('location')).toBe(`${ORIGIN}/offline`);

    // Other routes redirect, and /offline serves its own precached copy.
    const elsewhere = await harness.navigation(`${ORIGIN}/today`, () => new Error('offline'));
    expect(elsewhere?.status).toBe(302);
    const offline = await harness.navigation(`${ORIGIN}/offline`, () => new Error('offline'));
    expect(offline?.body).toBe('<html>offline</html>');
  });
});

describe('the page can have its own document cached', () => {
  /*
   * On a first visit the document that booted the app was fetched before the
   * worker was controlling, so the navigation strategy never saw it. From then
   * on only client-side navigations populated the cache, and a fresh offline
   * open had no document for its URL — it fell through to `/offline`. The page
   * is the only thing that knows which URL that document belongs to, so it says
   * so over the same channel it uses for the session scope.
   */
  const DOC = `${ORIGIN}/tasks`;

  it('stores the page’s document at its exact URL, and serves it there offline', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');
    harness.setRoute(() => html('<html>tasks</html>'));

    await harness.message({ type: 'cache-document', url: DOC });
    expect(harness.writes).toEqual([`${API_CACHE} ${DOC}`]);

    // Which is exactly what makes a cold open at that URL render offline.
    const cold = await harness.navigation(DOC, () => new Error('offline'));
    expect(cold?.status).toBe(200);
    expect(cold?.body).toBe('<html>tasks</html>');
  });

  it('keeps the document in the session cache, and only for that session', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');
    harness.setRoute(() => html('<html>tasks</html>'));
    await harness.message({ type: 'cache-document', url: DOC });
    expect(harness.caches.get(RUNTIME)?.size ?? 0).toBe(0);

    await announce(harness, 's2');
    const other = await harness.navigation(DOC, () => new Error('offline'));
    expect(other?.status).toBe(302);
  });

  it('stores nothing before the worker knows which session it is caching for', async () => {
    const harness = await installedHarness();
    harness.setRoute(() => html('<html>tasks</html>'));
    await harness.message({ type: 'cache-document', url: DOC });
    // Caching before the session is known is the leak the whole design avoids.
    expect(harness.writes).toEqual([]);
  });

  it('does not re-fetch a document it already has', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');
    // A navigation that passed through the worker already cached it.
    await harness.navigation(DOC, () => html('<html>tasks</html>'));
    harness.fetchCalls.length = 0;
    harness.writes.length = 0;

    await harness.message({ type: 'cache-document', url: DOC });
    expect(harness.fetchCalls).toEqual([]);
    expect(harness.writes).toEqual([]);
  });

  it('refuses another origin, and never stores a non-document', async () => {
    const harness = await installedHarness();
    await announce(harness, 's1');
    harness.setRoute(() => html('<html>whatever</html>'));

    await harness.message({ type: 'cache-document', url: 'https://evil.example/tasks' });
    await harness.message({ type: 'cache-document', url: `${ORIGIN}/api/tasks` });
    await harness.message({ type: 'cache-document', url: `${ORIGIN}/_next/static/chunks/x.js` });

    expect(harness.writes.filter((write) => write.startsWith('api-'))).toEqual([]);
  });

  it('never stores the login redirect a signed-out visit produces', async () => {
    const harness = createHarness();
    await harness.install((url) => {
      if (url.endsWith('/') || url.endsWith('/offline')) return html('<html>app</html>');
      return new FakeResponse('<html>login</html>', { redirected: true });
    });
    await announce(harness, 's1');

    await harness.message({ type: 'cache-document', url: `${ORIGIN}/tasks` });
    expect(harness.writes.filter((write) => write.startsWith('api-'))).toEqual([]);
  });
});

describe('immutable assets are cache-first', () => {
  it('stores a /_next/static asset and serves the copy next time', async () => {
    const harness = createHarness();
    const url = `${ORIGIN}/_next/static/chunks/main-abc123.js`;
    const first = await harness.get(url, () => new FakeResponse('chunk-v1'));
    expect(first?.body).toBe('chunk-v1');
    expect(harness.writes).toEqual([`${RUNTIME} ${url}`]);

    const second = await harness.get(url, () => new FakeResponse('chunk-v2'));
    expect(second?.body).toBe('chunk-v1'); // served from cache
  });

  it('treats /icons as immutable too', async () => {
    const harness = await installedHarness();
    seedCache(harness, RUNTIME, { [`${ORIGIN}/icons/icon-192.png`]: 'icon' });
    const response = await harness.get(`${ORIGIN}/icons/icon-192.png`, () => new FakeResponse('fresh'));
    expect(response?.body).toBe('icon');
  });
});

describe('other same-origin GETs are stale-while-revalidate', () => {
  it('answers from cache and revalidates in the background', async () => {
    const harness = createHarness();
    const url = `${ORIGIN}/api-proxy/notes.css`;
    seedCache(harness, RUNTIME, { [url]: 'cached-css' });
    const response = await harness.get(url, () => new FakeResponse('fresh-css'));
    expect(response?.body).toBe('cached-css');
    // The revalidation still ran and refreshed the entry.
    expect(harness.fetchCalls).toContain(`GET ${url}`);
    expect(harness.caches.get(RUNTIME)!.get(url)?.body).toBe('fresh-css');
  });

  it('returns a network error rather than inventing content when nothing is cached', async () => {
    const harness = createHarness();
    const response = await harness.get(`${ORIGIN}/brand.css`, () => new Error('offline'));
    expect(response?.type).toBe('error');
    expect(harness.writes).toEqual([]);
  });
});

describe('the no-store gate applies to every runtime write', () => {
  it('never caches a no-store asset', async () => {
    const harness = createHarness();
    const url = `${ORIGIN}/_next/static/chunks/private-xyz.js`;
    const response = await harness.get(
      url,
      () => new FakeResponse('secret', { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }),
    );
    expect(response?.body).toBe('secret');
    expect(harness.writes).toEqual([]);
  });

  it('never caches an error response', async () => {
    const harness = createHarness();
    await harness.get(`${ORIGIN}/_next/static/chunks/boom.js`, () => new FakeResponse('nope', { status: 500 }));
    expect(harness.writes).toEqual([]);
  });
});

describe('lifecycle', () => {
  it('precaches the shell, the manifest and every icon', async () => {
    const harness = await installedHarness();
    const entries = [...harness.caches.get(PRECACHE)!.keys()].map((url) =>
      url.replace(ORIGIN, ''),
    );
    expect(entries).toContain('/');
    expect(entries).toContain('/offline');
    expect(entries).toContain('/manifest.webmanifest');
    expect(entries).toContain('/icons/icon-192.png');
    expect(entries).toContain('/icons/icon-512.png');
    expect(entries).toContain('/icons/icon-maskable-512.png');
    expect(entries).toContain('/icons/apple-touch-icon.png');
  });

  it('deletes caches from previous versions on activate', async () => {
    const harness = await installedHarness();
    seedCache(harness, 'precache-tasktick-v0', { x: 'stale' });
    seedCache(harness, 'runtime-tasktick-v0', {});
    seedCache(harness, 'api-s1-tasktick-v0', {});
    await harness.activate();
    expect([...harness.caches.keys()].sort()).toEqual([PRECACHE]);
  });
});
