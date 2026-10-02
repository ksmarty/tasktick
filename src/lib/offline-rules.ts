/**
 * The pure rules the offline layer is built from.
 *
 * Separated from `offline-queue.ts` (which owns state, IndexedDB and the
 * network) for one reason: these are the decisions that must not silently drift
 * — what may be queued, what a replayed status means, in what order entries
 * replay, how two writes are recognised as the same, and how a temporary id is
 * rewritten once the server hands back a real one. No imports, no globals, no
 * browser: every one of them is unit-testable as it stands.
 */

/** HTTP methods this app writes with. */
export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

/** A write the queue is allowed to hold. */
export type QueueMethod = Extract<HttpMethod, 'POST' | 'PATCH' | 'PUT' | 'DELETE'>;

export type ReplayOutcome = 'success' | 'retry' | 'auth' | 'drop';

/** How long a claimed entry is owned before it may be claimed again. */
export const LEASE_MS = 30_000;
/** Ceiling for the exponential retry delay. */
export const MAX_BACKOFF_MS = 60_000;
/** How often a pending queue is retried while the page is visible. */
export const PUMP_INTERVAL_MS = 20_000;

/**
 * Which cached reads a write invalidates. **The single source of truth.**
 *
 * Two callers read it, and they must not diverge:
 *
 * 1. `affectsFor()` here, which the offline queue uses to decide what a
 *    *replayed* write invalidates — that write has no component left to
 *    invalidate anything.
 * 2. Every live writer in the app, which passes `affectsFor(method, path)` as
 *    its `invalidates` list instead of hand-copying prefixes.
 *
 * It used to be the other way round: each screen kept its own literal array and
 * this table was a second copy kept in step by hand. They drifted, and the drift
 * was invisible because a missing prefix is not an error — it just leaves a
 * screen showing pre-write data until something else happens to refetch it.
 * `tests/invalidation-coverage.test.ts` now pins the two together.
 *
 * Ordered so the most specific route matches first.
 */
const AFFECTS: { test: RegExp; prefixes: string[] }[] = [
  { test: /^\/api\/tasks(\/|$|\?)/, prefixes: ['/api/tasks', '/api/bootstrap', '/api/calendar/items', '/api/lists'] },
  { test: /^\/api\/lists(\/|$|\?)/, prefixes: ['/api/lists', '/api/bootstrap', '/api/tasks'] },
  { test: /^\/api\/tags(\/|$|\?)/, prefixes: ['/api/tags', '/api/bootstrap', '/api/tasks'] },
  { test: /^\/api\/habits(\/|$|\?)/, prefixes: ['/api/habits', '/api/stats', '/api/bootstrap'] },
  { test: /^\/api\/events(\/|$|\?)/, prefixes: ['/api/events', '/api/calendar/items', '/api/bootstrap'] },
  { test: /^\/api\/calendars(\/|$|\?)/, prefixes: ['/api/calendars', '/api/calendar/items', '/api/bootstrap'] },
  { test: /^\/api\/settings(\/|$|\?)/, prefixes: ['/api/settings', '/api/bootstrap'] },
  { test: /^\/api\/focus(\/|$|\?)/, prefixes: ['/api/focus', '/api/stats'] },
  // A CalDAV account is a calendar collection and a mirror of events *and*
  // tasks, so any write under it (discover, sync, enable, remove) can change
  // all of them. The union is deliberately wider than any single operation
  // needs: a stale calendar after a sync is the bug this table exists to
  // prevent, and an extra refetch is not.
  {
    test: /^\/api\/caldav(\/|$|\?)/,
    prefixes: ['/api/caldav/accounts', '/api/calendars', '/api/calendar/items', '/api/events', '/api/tasks', '/api/bootstrap'],
  },
  // A subscription token is a credential for *this* account's feed; writing one
  // changes only the token list. Note this must not be folded into the `/api/ical`
  // row below — `/api/ical-tokens` does not match that test (`-`, not `/`), and
  // widening it to catch both would make a token write drop the calendar.
  { test: /^\/api\/ical-tokens(\/|$|\?)/, prefixes: ['/api/ical-tokens'] },
  // A subscription *is* a calendar and a pile of mirrored events.
  {
    test: /^\/api\/ical(\/|$|\?)/,
    prefixes: ['/api/ical', '/api/calendars', '/api/calendar/items', '/api/bootstrap'],
  },
  { test: /^\/api\/period(\/|$|\?)/, prefixes: ['/api/period'] },
  { test: /^\/api\/tokens(\/|$|\?)/, prefixes: ['/api/tokens'] },
  { test: /^\/api\/invites(\/|$|\?)/, prefixes: ['/api/invites'] },
  { test: /^\/api\/push(\/|$|\?)/, prefixes: ['/api/push'] },
  { test: /^\/api\/admin\/users(\/|$|\?)/, prefixes: ['/api/admin/users', '/api/bootstrap'] },
];

/** Prefixes whose writes are safe to hold and to replay. */
const QUEUEABLE_PREFIXES = [
  '/api/tasks',
  '/api/lists',
  '/api/tags',
  '/api/habits',
  '/api/events',
  '/api/calendars',
  '/api/focus',
  '/api/settings',
];

/**
 * Endpoints that look queueable but are not.
 *
 * These either cannot be answered offline at all (an export is a download), or
 * are probes whose *result* is the point (`/apprise/test` tells the user whether
 * their notification settings work). Holding one of those and replaying it
 * minutes later would produce a result nobody is waiting for, or no result where
 * one was promised.
 */
const NEVER_QUEUEABLE = ['/api/settings/apprise/test', '/api/settings/push', '/api/push'];

/** The pathname of a path, without its query string. */
export function pathnameOf(path: string): string {
  const query = path.indexOf('?');
  return query === -1 ? path : path.slice(0, query);
}

/** Whether a failed write may be held in the queue. */
export function isQueueable(method: string, path: string): boolean {
  if (method === 'GET' || method === 'HEAD') return false;
  const pathname = pathnameOf(path);
  if (NEVER_QUEUEABLE.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  return QUEUEABLE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Cache prefixes a write invalidates.
 *
 * The one thing a writer needs to say about invalidation: pass its own method
 * and path and use the result as the `invalidates` list. `method` is part of the
 * signature because some writes read as GETs elsewhere; today no rule needs it.
 *
 * Falls back to the exact pathname for a route with no rule — correct for a
 * resource read at that exact path, but a route that reaches here usually wants
 * a row in `AFFECTS`, which `tests/invalidation-coverage.test.ts` enforces.
 */
export function affectsFor(_method: string, path: string): string[] {
  const pathname = pathnameOf(path);
  for (const rule of AFFECTS) {
    if (rule.test.test(pathname)) return [...rule.prefixes];
  }
  return [pathname];
}

/**
 * Whether `AFFECTS` has a rule for this path.
 *
 * Exposed so `tests/invalidation-coverage.test.ts` can require that a new write
 * route is a deliberate row rather than falling back to its own pathname — a
 * fallback that is correct for a self-only read and silently wrong for anything
 * that reaches a second one.
 */
export function hasRule(path: string): boolean {
  const pathname = pathnameOf(path);
  return AFFECTS.some((rule) => rule.test.test(pathname));
}

/**
 * The same prefix rule `invalidate()` uses in the store, so a pending write
 * holds exactly the reads it is about to invalidate.
 */
export function matchesPrefix(key: string, prefix: string): boolean {
  return key === prefix || key.startsWith(`${prefix}?`) || key.startsWith(`${prefix}/`);
}

/** The one place a replayed HTTP status is turned into a decision. */
export function classifyStatus(status: number): ReplayOutcome {
  if (status >= 200 && status < 300) return 'success';
  if (status === 401) return 'auth';
  if (status === 0 || status === 408 || status === 425 || status === 429) return 'retry';
  if (status >= 500) return 'retry';
  return 'drop';
}

/**
 * Exponential backoff, capped, with jitter.
 *
 * `random` is injected so the schedule is testable; the jitter matters because a
 * device that comes back onto a flaky network otherwise retries every queued
 * write on exactly the same tick.
 */
export function retryDelayMs(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.max(0, attempts - 1));
  const jitter = base * 0.2 * random();
  return Math.round(Math.min(MAX_BACKOFF_MS, base + jitter));
}

/** Replay order: oldest first, ties broken by id so it is deterministic. */
export function orderQueue<T extends { seq: number; id: string }>(entries: readonly T[]): T[] {
  return [...entries].sort((a, b) => (a.seq === b.seq ? a.id.localeCompare(b.id) : a.seq - b.seq));
}

/** Whether an entry may be dispatched right now. */
export function readyForReplay(entry: { leaseUntil?: number; nextAttemptAt: number }, now: number): boolean {
  if (entry.leaseUntil && entry.leaseUntil > now) return false;
  return entry.nextAttemptAt <= now;
}

/** JSON with sorted object keys, so two equal bodies compare equal. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(sortKeys(value)) ?? '';
  } catch {
    return '';
  }
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/** Two writes are the same request if method, path and body all agree. */
export function isSameWrite(
  a: { method: string; path: string; body?: unknown },
  b: { method: string; path: string; body?: unknown },
): boolean {
  if (a.method !== b.method) return false;
  if (a.path !== b.path) return false;
  return stableStringify(a.body) === stableStringify(b.body);
}

/**
 * Replaces every occurrence of a temporary id with the server's real one.
 *
 * Deep and exact-match only: `temp:abc` becomes the real id, while a longer
 * string that merely contains it is left alone.
 */
export function applyTempIdMap<T>(value: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return value;
  return rewrite(value) as T;

  function rewrite(node: unknown): unknown {
    if (typeof node === 'string') return map.get(node) ?? node;
    if (Array.isArray(node)) return node.map(rewrite);
    if (node && typeof node === 'object') {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of Object.entries(node as Record<string, unknown>)) out[key] = rewrite(entry);
      return out;
    }
    return node;
  }
}

/**
 * Rewrites the temporary ids in a path.
 *
 * Segment-wise, because a path is `/api/tasks/<id>`: the id is a whole segment,
 * never a substring of one, so an exact segment match is both sufficient and
 * safer than replacing text inside the URL.
 */
export function rewritePathTempIds(path: string, map: ReadonlyMap<string, string>): string {
  if (map.size === 0) return path;
  const query = path.indexOf('?');
  const pathname = query === -1 ? path : path.slice(0, query);
  const search = query === -1 ? '' : path.slice(query);
  const rewritten = pathname
    .split('/')
    .map((segment) => map.get(segment) ?? segment)
    .join('/');
  return rewritten + search;
}

/** Rewrites one queued entry's references to temporary ids. */
export function rewriteEntryTempIds<T extends { path: string; body?: unknown }>(entry: T, map: ReadonlyMap<string, string>): T {
  if (map.size === 0) return entry;
  return {
    ...entry,
    path: rewritePathTempIds(entry.path, map),
    body: entry.body === undefined ? undefined : applyTempIdMap(entry.body, map),
  };
}

/** The id of a created resource, if the response carries one. */
export function createdId(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/** The entity id embedded in a path such as `/api/tasks/abc/complete`. */
export function idFromPath(path: string): string | null {
  const match = /^\/api\/[^/]+\/([^/?]+)/.exec(pathnameOf(path));
  return match ? match[1] : null;
}

/**
 * What a queued write resolves to for its caller.
 *
 * The caller is a component that has already updated the screen optimistically
 * (`TasksView`, the habits page) or that will refresh. It must not see
 * `undefined`: `TasksView` treats `undefined` as "the write failed" and rolls the
 * row back, which is precisely wrong here. So a queued write answers with the
 * shape that endpoint would have answered with, built from the request body and
 * the temporary id, plus `queued: true`.
 *
 * The defaults are the ones the server applies (`status: 'todo'`, no due date)
 * so the object can be rendered by the same code that renders a saved one.
 */
export function queuedResult(method: QueueMethod, path: string, body: unknown, tempId: string | undefined): unknown {
  const pathname = pathnameOf(path);
  const patch = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};

  if (method === 'DELETE') return { deleted: true, queued: true };

  if (/\/complete$/.test(pathname)) return { task: null, recurred: false, queued: true };

  if (/^\/api\/tasks\/bulk$/.test(pathname)) {
    return { affected: Array.isArray(patch.ids) ? patch.ids.length : 0, queued: true };
  }
  if (/^\/api\/tasks\/reorder$/.test(pathname) || /^\/api\/habits$/.test(pathname)) {
    return { reordered: Array.isArray(patch.orderedIds) ? patch.orderedIds.length : 0, queued: true };
  }

  return {
    dueAtMs: null,
    dueDate: null,
    startAtMs: null,
    startDate: null,
    completedAtMs: null,
    isAllDay: false,
    status: 'todo',
    priority: 'none',
    isPinned: false,
    ...patch,
    // The identity is the endpoint's, never the caller's: a body that carries a
    // stale `id` must not make the placeholder point at the wrong entity.
    id: tempId ?? idFromPath(path),
    queued: true,
  };
}
