/**
 * Typed failures of the CalDAV transport layer.
 *
 * The sync layer above us branches on these classes, so every non-2xx answer
 * from a server must end up as one of them — nothing is swallowed and nothing
 * is turned into a bare `Error`.
 *
 * Nothing in here may ever carry the account password: URLs are passed through
 * {@link redactUrl} and response snippets through {@link redactSecret} before
 * they reach a message.
 */

export interface CalDavErrorOptions {
  /** HTTP status, or `0` for a failure that never reached the server. */
  status: number;
  method: string;
  url: string;
  /** `true` when retrying the same request may succeed (429 / 5xx / network). */
  retryable?: boolean;
  cause?: unknown;
}

export class CalDavError extends Error {
  readonly status: number;
  readonly method: string;
  /** Request URL with any `user:pass@` userinfo stripped. */
  readonly url: string;
  readonly retryable: boolean;

  constructor(message: string, options: CalDavErrorOptions) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'CalDavError';
    this.status = options.status;
    this.method = options.method;
    this.url = options.url;
    this.retryable = options.retryable ?? false;
  }
}

/** 401 / 403 — bad credentials, expired app password, revoked token. */
export class CalDavAuthError extends CalDavError {
  constructor(message: string, options: CalDavErrorOptions) {
    super(message, options);
    this.name = 'CalDavAuthError';
  }
}

/** 412 — the `If-Match` ETag no longer matches the stored resource. */
export class CalDavPreconditionFailedError extends CalDavError {
  constructor(message: string, options: CalDavErrorOptions) {
    super(message, options);
    this.name = 'CalDavPreconditionFailedError';
  }
}

/** 404 — the collection or object does not exist (or is `410 Gone`). */
export class CalDavNotFoundError extends CalDavError {
  constructor(message: string, options: CalDavErrorOptions) {
    super(message, options);
    this.name = 'CalDavNotFoundError';
  }
}

/** 405 / 501 — the server does not implement what we asked for (e.g. MKCALENDAR). */
export class CalDavUnsupportedError extends CalDavError {
  constructor(message: string, options: CalDavErrorOptions) {
    super(message, options);
    this.name = 'CalDavUnsupportedError';
  }
}

/** Drops `user:pass@` from a URL so credentials never leak into a message. */
export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    if (url.username || url.password) {
      url.username = '';
      url.password = '';
    }
    return url.toString();
  } catch {
    return rawUrl.replace(/\/\/[^/@\s]*@/, '//');
  }
}

/** Replaces every occurrence of a secret with `***`; used on response snippets. */
export function redactSecret(text: string, secret: string): string {
  if (!secret) return text;
  return text.split(secret).join('***');
}
