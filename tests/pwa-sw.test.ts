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
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'public/sw.js'), 'utf8');
const ORIGIN = 'https://tasks.example.com';

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

  constructor(url: string, init: { method?: string; mode?: string } = {}) {
    this.url = new URL(url, ORIGIN).href;
    this.method = init.method ?? 'GET';
    this.mode = init.mode ?? 'no-cors';
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
  navigation(url: string, route: Route): Promise<FakeResponse | undefined>;
  get(url: string, route: Route, init?: { mode?: string }): Promise<FakeResponse | undefined>;
  request(url: string, init?: { method?: string }): Promise<FakeResponse | undefined>;
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
    console: { warn: () => undefined, error: () => undefined, log: () => undefined },
  };
  sandbox.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(SOURCE, sandbox);

  const dispatch = async (type: string, event: unknown): Promise<FakeResponse | undefined> => {
    const handler = listeners.get(type);
    if (!handler) throw new Error(`no ${type} listener registered`);
    await handler(event as never);

    const { response, waits } = event as {
      response?: Promise<FakeResponse>;
      waits?: Promise<unknown>[];
    };
    const result = response ? await response : undefined;
    // Background work (stale-while-revalidate, activation cleanup) must settle
    // before a test inspects the caches.
    if (waits && waits.length > 0) await Promise.all(waits);
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
    async navigation(url, navigationRoute) {
      route = navigationRoute;
      return dispatch('fetch', makeEvent(new FakeRequest(url, { mode: 'navigate' })));
    },
    async get(url, getRoute, init = {}) {
      route = getRoute;
      return dispatch('fetch', makeEvent(new FakeRequest(url, { mode: init.mode ?? 'cors' })));
    },
    async request(url, init = {}) {
      return dispatch('fetch', makeEvent(new FakeRequest(url, init)));
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
  const cache = await harness.caches.get('precache-tasktick-v1')!.get(new URL(url, ORIGIN).href);
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

describe('/api/** is never cached', () => {
  it('passes a healthy response straight through without storing it', async () => {
    const harness = createHarness();
    const response = await harness.get(`${ORIGIN}/api/tasks`, () => new FakeResponse('[1,2,3]'));
    expect(response?.status).toBe(200);
    expect(response?.body).toBe('[1,2,3]');
    expect(harness.writes).toEqual([]);
  });

  it('answers 503 with a JSON offline flag when the network fails', async () => {
    const harness = createHarness();
    const response = await harness.get(`${ORIGIN}/api/tasks`, () => new Error('offline'));
    expect(response?.status).toBe(503);
    expect(response?.headers.get('Content-Type')).toBe('application/json');
    expect(response?.headers.get('Cache-Control')).toBe('no-store');
    expect(response?.json()).toEqual({ offline: true, error: 'network-unavailable' });
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

  it('falls back to the precached shell, then /offline', async () => {
    const harness = await installedHarness();
    const shell = await harness.navigation(`${ORIGIN}/today`, () => new Error('offline'));
    expect(shell?.body).toBe(`<html>${ORIGIN}/</html>`);

    // Same worker, but with the shell evicted (iOS does this): /offline is next.
    await harness.caches.get('precache-tasktick-v1')!.delete(`${ORIGIN}/`);
    const offlinePage = await harness.navigation(`${ORIGIN}/today`, () => new Error('offline'));
    expect(offlinePage?.body).toBe(`<html>${ORIGIN}/offline</html>`);
  });

  it('serves a last-resort document if the precache is empty', async () => {
    const harness = createHarness();
    const response = await harness.navigation(`${ORIGIN}/today`, () => new Error('offline'));
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
    const response = await harness.navigation(`${ORIGIN}/today`, () => new Error('offline'));
    expect(response?.body).toBe('<html>offline</html>');
  });
});

describe('immutable assets are cache-first', () => {
  it('stores a /_next/static asset and serves the copy next time', async () => {
    const harness = createHarness();
    const url = `${ORIGIN}/_next/static/chunks/main-abc123.js`;
    const first = await harness.get(url, () => new FakeResponse('chunk-v1'));
    expect(first?.body).toBe('chunk-v1');
    expect(harness.writes).toEqual([`runtime-tasktick-v1 ${url}`]);

    const second = await harness.get(url, () => new FakeResponse('chunk-v2'));
    expect(second?.body).toBe('chunk-v1'); // served from cache
  });

  it('treats /icons as immutable too', async () => {
    const harness = await installedHarness();
    seedCache(harness, 'runtime-tasktick-v1', { [`${ORIGIN}/icons/icon-192.png`]: 'icon' });
    const response = await harness.get(`${ORIGIN}/icons/icon-192.png`, () => new FakeResponse('fresh'));
    expect(response?.body).toBe('icon');
  });
});

describe('other same-origin GETs are stale-while-revalidate', () => {
  it('answers from cache and revalidates in the background', async () => {
    const harness = createHarness();
    const url = `${ORIGIN}/api-proxy/notes.css`;
    seedCache(harness, 'runtime-tasktick-v1', { [url]: 'cached-css' });
    const response = await harness.get(url, () => new FakeResponse('fresh-css'));
    expect(response?.body).toBe('cached-css');
    // The revalidation still ran and refreshed the entry.
    expect(harness.fetchCalls).toContain(`GET ${url}`);
    expect(harness.caches.get('runtime-tasktick-v1')!.get(url)?.body).toBe('fresh-css');
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
    const entries = [...harness.caches.get('precache-tasktick-v1')!.keys()].map((url) =>
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
    await harness.activate();
    expect([...harness.caches.keys()].sort()).toEqual(['precache-tasktick-v1']);
  });
});
