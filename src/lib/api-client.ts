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
import { isReachable, reportReachable, reportUnreachable } from './network-health';

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
 * How long a request the offline queue can take is allowed to go unanswered.
 *
 * Only queueable writes are bounded (see the call site), and that is what makes
 * a short ceiling safe: an abandoned write is not lost. `queueFailedWrite` sees
 * the network error, records the request, and the caller gets the same
 * placeholder it would have got with no connection at all — so the optimistic
 * screen stays and the work replays.
 *
 * The cost, stated plainly: a request abandoned just as it was about to succeed
 * has been applied by the server and is then replayed. The window is narrow —
 * the request has to reach the server and the response has to be lost inside the
 * same three seconds — and every dispatch carries `X-Idempotency-Key`, which
 * collapses a replay to one effect *on a server that honours it*. As of this
 * writing nothing on the server reads that header (`grep -rn
 * x-idempotency-key src/` finds only the sender), so the window is real. It is
 * the price of not leaving a screen waiting on a network that has already
 * failed.
 *
 * The number is a latency budget, not an availability one — "bad cell service"
 * is a latency problem first. Three seconds is the same ceiling a *navigation*
 * gets in `public/sw.js`, which is the longest a person is expected to keep
 * waiting on a screen before something should visibly happen. A read is not
 * bounded here at all: the service worker already answers one it has cached
 * immediately and bounds an uncached one at `API_TIMEOUT_MS`.
 */
const QUEUEABLE_TIMEOUT_MS = 3000;

/**
 * Marks a read as "the origin's answer, or nothing".
 *
 * The service worker answers a `/api/**` read from this session's own copy the
 * moment it has one, and refreshes that copy in the background (see
 * `sessionRead` in `public/sw.js`). That is the right trade for a screen
 * painting on a bad link, and the wrong one for a read the app makes *because*
 * something changed: it hands back the body from before the change, and the
 * fresher one the worker fetched alongside it lands in the cache for the *next*
 * read. A screen that resumes and revalidates then renders pre-write data and
 * only catches up one read later — "I added it, switched apps, came back, and it
 * was not there until later".
 *
 * So a forced revalidation says so, in a header the worker can see before it
 * decides. `X-` keeps it a non-simple header, which means a cross-origin request
 * would need a preflight — irrelevant here, since the API is same-origin only,
 * and a useful property anywhere else.
 */
export const FRESH_READ_HEADER = 'X-TaskTick-Fresh';

/** Headers for a read that must not be answered from the worker's copy. */
export function freshReadHeaders(fresh: boolean): Record<string, string> | undefined {
  return fresh ? { [FRESH_READ_HEADER]: '1' } : undefined;
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

  /*
   * A request that hangs is the one failure `navigator.onLine` cannot see.
   *
   * Handing a phone from Wi-Fi to cellular leaves the flag `true` while the
   * socket opened on the old interface is dead, and a link like that hangs
   * rather than refuses: the fetch sits there until the browser's own timeout
   * decides, which is tens of seconds. Every screen that awaited it looked
   * frozen. Bounding it turns the hang into the network failure the offline
   * layer already knows how to handle.
   *
   * Deliberately limited to writes the queue can take. A CalDAV sync, an import
   * or a feed refresh can legitimately take many seconds and has nothing to be
   * handed to — aborting one would report a failure for work the server may
   * still be finishing — so those keep waiting, exactly as before.
   */
  const bounded = isQueueable(method, path);
  const controller = bounded ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), QUEUEABLE_TIMEOUT_MS) : null;

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
      ...(controller ? { signal: controller.signal } : {}),
    });
  } catch {
    /*
     * A thrown fetch is a network failure, not an HTTP error — and so is an
     * abort, which is the same thing one step later: the request produced no
     * response. Both are reported the same way, which is what lets the queue and
     * the offline indicator treat a hang as being offline.
     */
    reportUnreachable();
    throw new ApiClientError('You appear to be offline. Your changes were not saved.', 0, 'network');
  } finally {
    if (timer !== null) clearTimeout(timer);
  }

  if (response.status === 204) {
    reportReachable();
    return undefined as T;
  }

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      // A non-JSON body from a proxy or crash page. The server answered, so the
      // origin is up; the body is the problem.
      reportReachable();
      if (!response.ok) {
        throw new ApiClientError(`Request failed (${response.status}).`, response.status);
      }
      throw new ApiClientError('The server returned an unexpected response.', response.status);
    }
  }

  const envelope = parsed as { ok?: boolean; data?: T; error?: string; code?: string; offline?: boolean } | null;

  /*
   * The service worker answers a read it cannot reach the network for with a
   * synthetic `503 { offline: true }` (see `offlineResponse` in `public/sw.js`).
   * That is the worker saying it could not reach the server, not the server
   * saying no, so it is the one response that is evidence of an unreachable
   * origin rather than a reachable one.
   */
  if (response.status === 503 && envelope?.offline === true) reportUnreachable();
  else reportReachable();

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

/** Queues a write that is not going to the server. Returns its placeholder, if held. */
async function queueWrite(method: HttpMethod, path: string, body: unknown): Promise<unknown | undefined> {
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

/** Queues a write that never reached the server. Returns its placeholder, if held. */
async function queueFailedWrite(method: HttpMethod, path: string, body: unknown, error: unknown): Promise<unknown | undefined> {
  if (!(error instanceof ApiClientError) || !error.isNetworkError) return undefined;
  return queueWrite(method, path, body);
}

async function request<T>(method: HttpMethod, path: string, body?: unknown, query?: Query, headers?: Record<string, string>): Promise<T> {
  const url = buildUrl(path, query);

  /*
   * A write whose network is already known to be unusable goes straight to the
   * queue, without a round trip.
   *
   * This is the difference between surviving a bad network and *feeling* like
   * offline mode. The last request already established that nothing is getting
   * through, so spending the timeout again to re-learn it leaves a spinner on
   * screen for three seconds for a write that was never going to be sent — and
   * every tap after the first pays that again. Queueing it now is what the app
   * would have done with no connection at all, which is the behaviour asked for.
   *
   * Reads are deliberately not short-circuited. A read is answered from the
   * service worker's per-session cache, which is already the offline behaviour,
   * and skipping the attempt would skip the cache with it. A read is also the
   * cheapest way to find out the network came back, so it keeps trying.
   */
  if (!isReachable() && isQueueable(method, url)) {
    const queued = await queueWrite(method, url, body);
    if (queued !== undefined) return queued as T;
  }

  try {
    return await transport<T>(method, url, body, headers);
  } catch (error) {
    const queued = await queueFailedWrite(method, url, body, error);
    if (queued !== undefined) return queued as T;
    throw error;
  }
}

/**
 * Uploads a file as `multipart/form-data`.
 *
 * Deliberately *not* routed through `request()`/`transport()`: those JSON-encode
 * the body, set `Content-Type: application/json` and, for queueable paths, would
 * hold the payload for replay. None of that can apply to bytes — a queued write
 * stores JSON in IndexedDB, and a `File` put back through it would arrive as an
 * object with no file in it. So an upload is a live request or it is a failure,
 * and the UI disables the control while the app believes it is offline.
 *
 * The envelope, reachability reporting and `ApiClientError` handling are the same
 * as everywhere else, because a failed upload should read exactly like any other
 * failed write.
 */
export interface UploadProgress {
  /** Bytes the browser has handed to the socket. */
  loaded: number;
  /** Bytes in the whole request body, headers aside. */
  total: number;
  /** `loaded / total`, clamped to 0…1. 0 when the browser cannot say. */
  fraction: number;
}

export interface UploadOptions {
  /**
   * Called as the request body leaves the browser. Absent for a small file,
   * which finishes in one tick — the caller draws the bar only while it can.
   */
  onProgress?: (progress: UploadProgress) => void;
  /** Cancels the request; the promise then rejects with code `aborted`. */
  signal?: AbortSignal;
}

export async function uploadFile<T>(
  path: string,
  form: FormData,
  options: UploadOptions = {},
): Promise<T> {
  /*
   * `XMLHttpRequest`, not `fetch`, for one reason: `fetch` reports how much of
   * the *response* has arrived and nothing about the request body, and this is
   * the only request in the app whose body is large. A file upload with no
   * number attached is a button that says "wait" for as long as the user's
   * uplink says so, which on a phone is indistinguishable from a frozen screen —
   * the exact report this replaced.
   *
   * Everything else stays the same as `transport()`: same envelope, same
   * `ApiClientError`, same reachability reporting, and still never queued.
   */
  return new Promise<T>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', path, true);
    request.withCredentials = true;
    request.setRequestHeader('Accept', 'application/json');

    const onAbort = () => request.abort();
    options.signal?.addEventListener('abort', onAbort, { once: true });

    const cleanup = () => {
      options.signal?.removeEventListener('abort', onAbort);
    };

    request.upload.addEventListener('progress', (event) => {
      if (!options.onProgress) return;
      const total = event.lengthComputable ? event.total : 0;
      options.onProgress({
        loaded: event.loaded,
        total,
        fraction: total > 0 ? Math.min(1, event.loaded / total) : 0,
      });
    });

    request.addEventListener('error', () => {
      cleanup();
      reportUnreachable();
      reject(new ApiClientError('You appear to be offline. That file was not uploaded.', 0, 'network'));
    });

    request.addEventListener('abort', () => {
      cleanup();
      reject(new ApiClientError('The upload was cancelled.', 0, 'aborted'));
    });

    request.addEventListener('timeout', () => {
      cleanup();
      reportUnreachable();
      reject(new ApiClientError('The upload timed out. Nothing was saved.', 0, 'network'));
    });

    request.addEventListener('load', () => {
      cleanup();
      const status = request.status;
      let parsed: unknown = null;
      if (request.responseText) {
        try {
          parsed = JSON.parse(request.responseText);
        } catch {
          reportReachable();
          reject(new ApiClientError(`Upload failed (${status}).`, status));
          return;
        }
      }

      const envelope = parsed as { ok?: boolean; data?: T; error?: string; code?: string } | null;
      if (status === 503) reportUnreachable();
      else reportReachable();

      if (status < 200 || status >= 300 || envelope?.ok === false) {
        reject(
          new ApiClientError(
            envelope?.error ?? `Upload failed (${status}).`,
            status,
            envelope?.code,
          ),
        );
        return;
      }

      resolve((envelope?.data ?? (null as T)) as T);
    });

    request.send(form);
  });
}

export const api = {
  /**
   * `options.fresh` asks for the origin's answer rather than the service
   * worker's copy of it — see `FRESH_READ_HEADER`. It is what a revalidation the
   * app chose to make passes, and only that: an ordinary read keeps the cached
   * answer it wants.
   */
  get: <T>(path: string, query?: Query, options?: { fresh?: boolean }) =>
    request<T>('GET', path, undefined, query, freshReadHeaders(options?.fresh === true)),
  post: <T>(path: string, body?: unknown, query?: Query) => request<T>('POST', path, body, query),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string, query?: Query) => request<T>('DELETE', path, undefined, query),
  /** Multipart upload — see `uploadFile`. Never queued; see the comment there. */
  upload: <T>(path: string, form: FormData, options?: UploadOptions) =>
    uploadFile<T>(path, form, options),
};

/** Human-readable message for any thrown value. */
/**
 * A read the worker could not reach the server for, said in a sentence.
 *
 * `offlineResponse()` in `public/sw.js` answers with `503 { offline: true,
 * error: 'network-unavailable' }` — a machine code, because the worker has no
 * business writing copy. It used to reach the screen verbatim, so an offline
 * calendar showed the string `network-unavailable` where a sentence belongs.
 * Only that one value is translated: everything else an envelope carries comes
 * from the server and is already meant for a person.
 */
const OFFLINE_READ_ERROR = 'network-unavailable';
const OFFLINE_READ_MESSAGE = 'TaskTick could not reach the server. Showing what is saved on this device.';

export function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.message === OFFLINE_READ_ERROR) return OFFLINE_READ_MESSAGE;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Something went wrong.';
}
