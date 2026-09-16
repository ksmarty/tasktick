/**
 * Typed browser client for the TaskTick API.
 *
 * Unwraps the `{ ok, data }` / `{ ok, error }` envelope so callers deal in plain
 * values and exceptions, and surfaces the HTTP status on the thrown error so the
 * UI can distinguish "your session expired" (401) from "that input is bad" (422).
 */

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
}

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

async function request<T>(method: string, path: string, body?: unknown, query?: Query): Promise<T> {
  let response: Response;

  try {
    response = await fetch(buildUrl(path, query), {
      method,
      // Send the session cookie; the API is same-origin only.
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      // Never let a stale service-worker cache satisfy an authenticated read.
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
