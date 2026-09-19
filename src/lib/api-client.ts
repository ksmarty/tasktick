/**
 * Typed browser client for the TaskTick API.
 *
 * Unwraps the `{ ok, data }` / `{ ok, error }` envelope so callers deal in plain
 * values and exceptions, and surfaces the HTTP status on the thrown error so the
 * UI can distinguish "your session expired" (401) from "that input is bad" (422).
 *
 * ## Offline writes
 *
 * This file is the single seam every mutation already goes through, which is
 * where "the write could not be sent" is turned from a failure into a queued
 * write. When a non-GET request cannot reach the server *at all* (a thrown
 * fetch: no connection, or a connection that dropped mid-request) and the
 * endpoint is one the queue understands, the request is recorded in the offline
 * queue and this function resolves with the value the endpoint would have
 * returned — a temporary id and the submitted fields, plus `queued: true`.
 *
 * That resolution value matters: callers hold an optimistic update and revert it
 * when a write resolves to `undefined` (`TasksView`, `TodayView`). Resolving with
 * `undefined` after a successful enqueue would roll the user's own change back
 * off the screen — the exact opposite of the intent.
 *
 * Only *network* failures are queued. An HTTP error means the server was reached
 * and answered; replaying it later would replace a clear message with a mystery.
 */
import { enqueueWrite, isQueueable, type QueueMethod } from './offline-queue';

export class ApiClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }

  /** True when the failure is worth retrying (network hiccup or server fault). */
  get isTransient(): boolean {
    return this.status === 0 || this.status >= 500 || this.status === 429;
  }

  get isAuthError(): boolean {
    return this.status === 401;
  }

  /** True when the failure never reached the server. */
  get isNetworkError(): boolean {
    return this.status === 0;
  }
}

export type HttpMethod = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';

type Query = Record<string, string | number | boolean | string[] | undefined | null>;

function buildUrl(path: string, query?: Query): string {
  const url = new URL(path, typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, Array.isArray(value) ? value.join(',') : String(value));
    }
  }
  // Preserve the path-only form for same-origin fetches.
  return `${url.pathname}${url.search}`;
}

/**
 * One request, no queueing. `sendNow` is the same thing exported, and is what the
 * offline queue replays through — a replayed write must not be able to re-enter
 * the queue that is currently draining.
 */
async function transport<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(path, {
      method,
      // Send the session cookie; the API is same-origin only.
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Never let a stale browser cache satisfy an authenticated read. The
      // service worker keeps its own per-session copy and is the only thing
      // allowed to answer from a cache (see `public/sw.js`).
      cache: 'no-store',
    });
  } catch {
    // A thrown fetch is a network failure, not an HTTP error.
    throw new ApiClientError('You appear to be offline. Your changes were not saved.', 0, 'network');
  }

  if (response.status === 204) return undefined as T;

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON body from a proxy or crash page.
      if (!response.ok) {
        throw new ApiClientError(`Request failed (${response.status}).`, response.status);
      }
      throw new ApiClientError('The server returned an unexpected response.', response.status);
    }
  }

  const envelope = parsed as { ok?: boolean; data?: T; error?: string; code?: string } | null;

  if (!response.ok || envelope?.ok === false) {
    throw new ApiClientError(
      envelope?.error ?? `Request failed (${response.status}).`,
      response.status,
      envelope?.code,
    );
  }

  return (envelope?.data ?? (null as T)) as T;
}

/**
 * Sends a request without touching the offline queue.
 *
 * Exported for the queue's replay loop only. The extra headers exist for
 * `X-Idempotency-Key`, which makes a replayed write a no-op on a server that
 * already applied it.
 */
export async function sendNow<T>(
  method: HttpMethod,
  path: string,
  body?: unknown,
  query?: Query,
  headers?: Record<string, string>,
): Promise<T> {
  return transport<T>(method, buildUrl(path, query), body, headers);
}

/** Queues a write that never reached the server. Returns its placeholder, if held. */
async function queueFailedWrite(method: HttpMethod, path: string, body: unknown, error: unknown): Promise<unknown | undefined> {
  if (!(error instanceof ApiClientError) || !error.isNetworkError) return undefined;
  if (!isQueueable(method, path)) return undefined;
  if (typeof indexedDB === 'undefined') return undefined;

  try {
    const { result } = await enqueueWrite({ method: method as QueueMethod, path, body });
    return result;
  } catch (queueError) {
    // The queue could not take it (no storage, quota). The original network
    // failure is the honest thing to report.
    console.warn('[offline] write could not be queued', queueError);
    return undefined;
  }
}

async function request<T>(method: HttpMethod, path: string, body?: unknown, query?: Query): Promise<T> {
  const url = buildUrl(path, query);
  try {
    return await transport<T>(method, url, body);
  } catch (error) {
    const queued = await queueFailedWrite(method, url, body, error);
    if (queued !== undefined) return queued as T;
    throw error;
  }
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, undefined, query),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, body, query),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string, query?: Query) => request<T>('DELETE', path, undefined, query),
};

/** Human-readable message for any thrown value. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
