/**
 * HTTP core of the CalDAV transport: credentials, redirects, retries, timeouts
 * and status → typed-error mapping.
 *
 * Design constraints that shaped this file:
 *   - **HTTPS only** unless `allowInsecureTls` is set (self-signed Nextcloud on
 *     a LAN); the policy is re-checked after every redirect hop, not just on
 *     the URL the user typed.
 *   - **Redirects are followed by hand** (`redirect: 'manual'`). We must know
 *     the *final* URL to resolve relative `href`s against and to re-apply the
 *     HTTPS policy — and `fetch` only exposes that through `Response.url`,
 *     which a fake fetch cannot provide.
 *   - **Idempotent reads are retried** on 429/5xx with exponential backoff +
 *     jitter, honouring `Retry-After`; **PUT/DELETE are never retried**, since
 *     a blind replay of a write without a fresh ETag check corrupts data.
 *   - No password ever reaches a message: URLs are redacted and response
 *     snippets have the secret scrubbed out.
 */
import type { Clock, CalDavClientOptions, CalDavCredentials } from './types';
import {
  CalDavAuthError,
  CalDavError,
  CalDavNotFoundError,
  CalDavPreconditionFailedError,
  CalDavUnsupportedError,
  redactSecret,
  redactUrl,
} from './errors';
import { parseMultiStatus, type MultiStatus } from './xml';

export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_USER_AGENT = 'TaskTick/0.1 (CalDAV sync; +https://github.com/tasktick)';

/** Methods where replaying the request on 429/5xx cannot corrupt state. */
const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PROPFIND', 'REPORT']);
const MAX_ATTEMPTS = 3;
const RETRY_BASE_MS = 150;
/** Cap on a server-provided `Retry-After`, so one header cannot stall a sync. */
const MAX_RETRY_AFTER_MS = 30_000;
const MAX_REDIRECTS = 5;
const SNIPPET_LENGTH = 200;

export interface TransportConfig {
  credentials: CalDavCredentials;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  allowInsecureTls: boolean;
  userAgent: string;
  clock: Clock;
}

export interface TransportRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
  /** Base for a relative `url`; defaults to the configured server URL. */
  baseUrl?: string;
  /** Overrides the retry decision; writes pass `false`. */
  retryable?: boolean;
}

export interface TransportResponse {
  status: number;
  /** URL of the response *after* redirects. */
  finalUrl: string;
  headers: Headers;
  body: string;
}

export interface MultiStatusResult extends TransportResponse {
  /** `null` whenever the status is not `207`. */
  multistatus: MultiStatus | null;
}

export class Transport {
  readonly config: TransportConfig;
  /** Normalised base URL derived from `credentials.serverUrl`. */
  readonly baseUrl: string;
  readonly #authHeader: string;
  /** OPTIONS answers are stable per origin within one client instance. */
  readonly #optionsCache = new Map<string, TransportResponse>();

  constructor(config: TransportConfig) {
    this.config = config;
    this.baseUrl = normalizeServerUrl(config.credentials.serverUrl);
    this.#authHeader = `Basic ${base64Utf8(`${config.credentials.username}:${config.credentials.password}`)}`;
  }

  /** Resolves a possibly relative `href` against `baseUrl` (defaulting to the server URL). */
  resolve(href: string, baseUrl: string = this.baseUrl): string {
    return new URL(href, baseUrl).toString();
  }

  /** Sends a request without judging the status. Retries idempotent reads. */
  async request(request: TransportRequest): Promise<TransportResponse> {
    const method = request.method.toUpperCase();
    const retryable = request.retryable ?? RETRYABLE_METHODS.has(method);
    const attempts = retryable ? MAX_ATTEMPTS : 1;
    let last: TransportResponse | null = null;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const response = await this.#attempt({ ...request, method });
      if (!retryable || attempt === attempts || !isRetryableStatus(response.status)) return response;
      last = response;
      await sleep(retryDelayMs(response.headers.get('retry-after'), attempt, this.config.clock.now()));
    }
    // Unreachable: the loop always returns on its last attempt.
    return last!;
  }

  /** Like {@link request}, but throws the matching typed error on a failure status. */
  async expect(request: TransportRequest): Promise<TransportResponse> {
    const response = await this.request(request);
    const ok = response.status === 207 || (response.status >= 200 && response.status < 300);
    if (!ok) this.throwForStatus(response, request.method);
    return response;
  }

  /** PROPFIND returning the parsed multistatus, or `null` when the answer was not 207. */
  async multistatus(request: TransportRequest): Promise<MultiStatusResult> {
    const response = await this.request(request);
    if (response.status !== 207) return { ...response, multistatus: null };
    try {
      return { ...response, multistatus: parseMultiStatus(response.body) };
    } catch (cause) {
      throw this.errorFor(response, request.method, 'server returned malformed WebDAV XML', false, cause);
    }
  }

  /** Like {@link multistatus}, but a non-207 answer becomes a typed error. */
  async expectMultistatus(request: TransportRequest): Promise<MultiStatusResult> {
    const result = await this.multistatus(request);
    if (!result.multistatus) this.throwForStatus(result, request.method);
    return result;
  }

  /** `OPTIONS` with the `DAV:` capability header, cached per origin. */
  async options(url: string, baseUrl?: string): Promise<TransportResponse> {
    const absolute = this.resolve(url, baseUrl);
    const cacheKey = new URL(absolute).origin;
    const cached = this.#optionsCache.get(cacheKey);
    if (cached) return cached;
    const response = await this.request({ method: 'OPTIONS', url: absolute });
    if (response.status >= 200 && response.status < 300) this.#optionsCache.set(cacheKey, response);
    return response;
  }

  /** Maps a failure status to the typed error the sync layer expects. */
  throwForStatus(response: TransportResponse, method: string): never {
    throw this.errorFor(response, method, undefined, isRetryableStatus(response.status));
  }

  errorFor(
    response: TransportResponse,
    method: string,
    override?: string,
    retryable = isRetryableStatus(response.status),
    cause?: unknown,
  ): CalDavError {
    const status = response.status;
    const url = redactUrl(response.finalUrl);
    const snippet = this.snippet(response.body);
    const detail = override ? `${override} (${status})` : `HTTP ${status}${snippet ? `: ${snippet}` : ''}`;
    const context = `${method} ${url}`;
    const options = { status, method, url, retryable, cause };

    if (status === 401 || status === 403) {
      return new CalDavAuthError(`CalDAV authentication failed — ${context} → ${detail}`, options);
    }
    if (status === 404 || status === 410) {
      return new CalDavNotFoundError(`CalDAV resource not found — ${context} → ${detail}`, options);
    }
    if (status === 412) {
      return new CalDavPreconditionFailedError(`CalDAV precondition failed (ETag mismatch) — ${context}`, options);
    }
    if (status === 405 || status === 501) {
      return new CalDavUnsupportedError(`CalDAV method not supported — ${context} → ${detail}`, options);
    }
    return new CalDavError(`CalDAV request failed — ${context} → ${detail}`, options);
  }

  /** One status line's worth of response body, scrubbed of the password. */
  private snippet(body: string): string {
    if (!body) return '';
    const flattened = body.replace(/\s+/g, ' ').trim().slice(0, SNIPPET_LENGTH);
    return redactSecret(flattened, this.config.credentials.password);
  }

  async #attempt(request: TransportRequest): Promise<TransportResponse> {
    let url = this.resolve(request.url, request.baseUrl);
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      this.#enforceTransportPolicy(request.method, url);
      const response = await this.#fetchOnce(request, url);
      const location = response.headers.get('location');
      if (isRedirectStatus(response.status) && location && hop < MAX_REDIRECTS) {
        // Method is preserved, as the fetch spec requires for non-POST requests:
        // iCloud's `/.well-known/caldav` 301s to the real host and the PROPFIND
        // must survive the hop.
        url = new URL(location, url).toString();
        continue;
      }
      return response;
    }
    throw new CalDavError(`CalDAV too many redirects — ${request.method} ${redactUrl(url)}`, {
      status: 0,
      method: request.method,
      url: redactUrl(url),
      retryable: false,
    });
  }

  async #fetchOnce(request: TransportRequest, url: string): Promise<TransportResponse> {
    const headers: Record<string, string> = {
      Authorization: this.#authHeader,
      'User-Agent': this.config.userAgent,
      Accept: '*/*',
      ...(request.body ? { 'Content-Type': 'application/xml; charset=utf-8' } : {}),
      ...request.headers,
    };
    let response: Response;
    try {
      response = await this.config.fetchImpl(url, {
        method: request.method,
        headers,
        body: request.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (cause) {
      throw new CalDavError(`CalDAV request failed — ${request.method} ${redactUrl(url)} → ${describeNetworkError(cause)}`, {
        status: 0,
        method: request.method,
        url: redactUrl(url),
        retryable: true,
        cause,
      });
    }
    let body: string;
    try {
      body = await response.text();
    } catch (cause) {
      throw new CalDavError(`CalDAV response could not be read — ${request.method} ${redactUrl(url)}`, {
        status: response.status,
        method: request.method,
        url: redactUrl(url),
        retryable: true,
        cause,
      });
    }
    return { status: response.status, finalUrl: url, headers: response.headers, body };
  }

  #enforceTransportPolicy(method: string, url: string): void {
    if (new URL(url).protocol === 'https:' || this.config.allowInsecureTls) return;
    throw new CalDavError(
      `Refusing to talk to ${redactUrl(url)} over plain HTTP — use https:// or set CALDAV_ALLOW_INSECURE_TLS=1`,
      { status: 0, method, url: redactUrl(url), retryable: false },
    );
  }
}

/** Builds the transport from the credentials and client options. */
export function createTransport(credentials: CalDavCredentials, options: CalDavClientOptions = {}): Transport {
  const allowInsecureTls = options.allowInsecureTls ?? false;
  if (allowInsecureTls) relaxTlsVerification();
  return new Transport({
    credentials,
    fetchImpl: options.fetchImpl ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    allowInsecureTls,
    userAgent: options.userAgent ?? DEFAULT_USER_AGENT,
    clock: options.clock ?? { now: () => Date.now() },
  });
}

/**
 * `allowInsecureTls` also disables certificate verification, which is what a
 * self-signed certificate on a trusted LAN needs.
 *
 * Node's global `fetch` accepts no per-request TLS options and `undici` is not a
 * dependency of this project, so the switch is made through the environment
 * variable undici itself honours. It is deliberately opt-in: an operator who
 * flips `CALDAV_ALLOW_INSECURE_TLS` has already accepted that trade.
 */
function relaxTlsVerification(): void {
  if (typeof process === 'undefined' || !process.env) return;
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

/** `https://host` — protocol defaulted to https, trailing slash trimmed. */
export function normalizeServerUrl(raw: string): string {
  const trimmed = raw.trim();
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const url = new URL(withProtocol);
  url.search = '';
  url.hash = '';
  if (url.pathname === '/') url.pathname = '';
  else url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 408 || (status >= 500 && status <= 599);
}

function isRedirectStatus(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Exponential backoff with full jitter, capped and honouring `Retry-After`. */
export function retryDelayMs(retryAfter: string | null, attempt: number, nowMs = Date.now()): number {
  const backoff = RETRY_BASE_MS * 2 ** (attempt - 1);
  const jittered = Math.round(backoff * (0.5 + Math.random() * 0.5));
  const hinted = parseRetryAfterMs(retryAfter, nowMs);
  return Math.min(Math.max(jittered, hinted ?? 0), MAX_RETRY_AFTER_MS);
}

/** `Retry-After` is either delta-seconds or an HTTP-date. */
export function parseRetryAfterMs(value: string | null, nowMs = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value.trim());
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

function describeNetworkError(cause: unknown): string {
  if (cause instanceof Error) {
    if (cause.name === 'TimeoutError') return 'request timed out';
    if (cause.name === 'AbortError') return 'request aborted';
    return cause.message;
  }
  return 'network error';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** UTF-8 safe base64 — no `Buffer`, so this module stays browser-friendly. */
export function base64Utf8(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += BASE64_ALPHABET[b0 >> 2];
    out += BASE64_ALPHABET[((b0 & 0x03) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? '=' : BASE64_ALPHABET[((b1 & 0x0f) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? '=' : BASE64_ALPHABET[b2 & 0x3f];
  }
  return out;
}
