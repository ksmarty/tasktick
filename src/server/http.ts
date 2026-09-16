/**
 * Route-handler plumbing.
 *
 * Every API route is wrapped by `route()`, which is the only place that knows
 * how to turn a thrown error into a response. That keeps handlers free of
 * try/catch noise and guarantees a consistent JSON envelope:
 *
 *   success -> { ok: true,  data: ... }
 *   failure -> { ok: false, error: "...", code?: "..." }
 *
 * Server internals (stack traces, SQL text, driver messages) are never leaked to
 * the client; they are logged server-side and replaced with a generic message.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAuth } from './auth';
import { getEnv, isAppUrlDefault } from '@/lib/env';
import type { ApiResult, SessionUser } from '@/lib/types';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const badRequest = (message: string, code?: string) => new ApiError(message, 400, code);
export const unauthorized = (message = 'You must be signed in.') => new ApiError(message, 401, 'unauthorized');
export const forbidden = (message = 'You do not have access to that.') => new ApiError(message, 403, 'forbidden');
export const notFound = (message = 'Not found.') => new ApiError(message, 404, 'not_found');
export const conflict = (message: string) => new ApiError(message, 409, 'conflict');

/* -------------------------------------------------------------------------- */
/* responses                                                                  */
/* -------------------------------------------------------------------------- */

function envelope<T>(body: ApiResult<T>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      // Authenticated data must never sit in a shared cache.
      'Cache-Control': 'no-store, private',
      Vary: 'Cookie',
    },
  });
}

export function ok<T>(data: T, status = 200): NextResponse {
  return envelope({ ok: true, data }, status);
}

export function fail(error: string, status = 400, code?: string): NextResponse {
  return envelope({ ok: false, error, code }, status);
}

/* -------------------------------------------------------------------------- */
/* session                                                                    */
/* -------------------------------------------------------------------------- */

const SESSION_TTL_MS = 60 * 60 * 24 * 30;

export interface RequestContext {
  user: SessionUser;
  req: NextRequest;
  /** Route params, already unwrapped from Next 15's promise. */
  params: Record<string, string>;
}

export type AuthedHandler = (ctx: RequestContext) => Promise<NextResponse> | NextResponse;

interface RouteOptions {
  /** Set false for genuinely public endpoints such as `/healthz`. */
  auth?: boolean;
  /** Restricts the route to admins (currently used by user management). */
  admin?: boolean;
}

/** Reads the session without throwing. Returns null when signed out. */
export async function getSessionUser(req: NextRequest): Promise<SessionUser | null> {
  const session = await getAuth().api.getSession({ headers: req.headers });
  if (!session?.user) return null;

  const user = session.user as unknown as {
    id: string;
    name?: string | null;
    email: string;
    image?: string | null;
    isAdmin?: boolean;
    timezone?: string;
  };

  if (user.isAdmin === undefined) {
    // Additional field missing means the row predates the field; treat as false.
    user.isAdmin = false;
  }

  return {
    id: String(user.id),
    name: user.name ?? user.email,
    email: user.email,
    image: user.image ?? null,
    isAdmin: Boolean(user.isAdmin),
    timezone: user.timezone ?? getEnv().DEFAULT_TIMEZONE,
  };
}

/* -------------------------------------------------------------------------- */
/* the wrapper                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Next 15 hands every route handler a context whose `params` is a promise, and
 * it type-checks the exported handler's signature against this exact shape.
 * The value union must include `undefined` (a catch-all segment can be absent)
 * and the parameter must NOT be optional, or the build fails with
 * "Expected RouteContext, got RouteContext | undefined".
 */
type NextRouteContext = { params: Promise<Record<string, string | string[] | undefined>> };

/**
 * Wraps a handler with authentication, param unwrapping and error translation.
 *
 * Usage:
 *   export const GET = route(async ({ user, params }) => ok(await listTasks(...)))
 */
export function route(handler: AuthedHandler, options: RouteOptions = {}) {
  const { auth = true, admin = false } = options;

  return async (req: NextRequest, ctx: NextRouteContext): Promise<NextResponse> => {
    try {
      let user: SessionUser | null = null;

      if (auth) {
        user = await getSessionUser(req);
        if (!user) return fail('You must be signed in.', 401, 'unauthorized');
        if (admin && !user.isAdmin) return fail('Administrator access required.', 403, 'forbidden');
      }

      const rawParams = (await ctx?.params) ?? {};
      const params: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawParams)) {
        params[key] = Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
      }

      return await handler({
        user: user ?? {
          id: '',
          name: '',
          email: '',
          image: null,
          isAdmin: false,
          timezone: getEnv().DEFAULT_TIMEZONE,
        },
        req,
        params,
      });
    } catch (error) {
      return handleError(error, req);
    }
  };
}

function handleError(error: unknown, req: NextRequest): NextResponse {
  if (error instanceof ApiError) {
    return fail(error.message, error.status, error.code);
  }

  if (error instanceof z.ZodError) {
    const first = error.issues[0];
    const path = first?.path.join('.') ?? '';
    return fail(path ? `${path}: ${first.message}` : (first?.message ?? 'Invalid request.'), 422, 'validation');
  }

  // Anything else is a bug. Log it fully, tell the client nothing useful.
  console.error(`[api] ${req.method} ${new URL(req.url).pathname} failed:`, error);
  return fail('Something went wrong on the server.', 500, 'internal');
}

/* -------------------------------------------------------------------------- */
/* request parsing                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Parses and validates a JSON body. Caps the payload size so a malformed or
 * hostile client cannot make us buffer an unbounded string.
 */
export async function parseJson<T extends z.ZodTypeAny>(req: NextRequest, schema: T): Promise<z.infer<T>> {
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    throw badRequest('Expected a JSON body.', 'unsupported_media_type');
  }

  const raw = await req.text();
  if (raw.length > 2_000_000) {
    throw new ApiError('Request body is too large.', 413, 'payload_too_large');
  }

  let parsed: unknown;
  try {
    parsed = raw ? JSON.parse(raw) : {};
  } catch {
    throw badRequest('Request body is not valid JSON.', 'invalid_json');
  }

  return schema.parse(parsed);
}

/** Reads a query parameter, returning undefined rather than an empty string. */
export function searchParam(req: NextRequest, key: string): string | undefined {
  const value = req.nextUrl.searchParams.get(key);
  return value === null || value === '' ? undefined : value;
}

export function searchParamInt(req: NextRequest, key: string, fallback: number): number {
  const raw = searchParam(req, key);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function searchParamBool(req: NextRequest, key: string, fallback = false): boolean {
  const raw = searchParam(req, key);
  if (raw === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

/** Parses a comma-separated list parameter into unique, non-empty values. */
export function searchParamList(req: NextRequest, key: string): string[] | undefined {
  const raw = searchParam(req, key);
  if (!raw) return undefined;
  const values = raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean);
  return values.length ? [...new Set(values)] : undefined;
}

/* -------------------------------------------------------------------------- */
/* public URL                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The origin this request actually arrived on.
 *
 * Honours `X-Forwarded-*` only when `TRUST_PROXY` is set, because those headers
 * are trivially forged by anything that is not a proxy we control.
 */
export function requestOrigin(req: NextRequest): string {
  const env = getEnv();

  if (env.TRUST_PROXY) {
    const proto = req.headers.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    if (proto && host) return `${proto}://${host}`;
  }

  const host = req.headers.get('host');
  if (host) return `${req.nextUrl.protocol}//${host}`;

  return req.nextUrl.origin;
}

/**
 * Base URL for links handed back to the user — currently the `webcal://`
 * subscription URLs shown in Settings.
 *
 * An explicitly configured `APP_URL` always wins. When it was left at its
 * default, the origin the user is actually browsing on is used instead, so a LAN
 * or Tailscale user gets a link their phone can reach rather than one pointing
 * at localhost.
 */
export function publicBaseUrl(req: NextRequest): string {
  const env = getEnv();
  const base = isAppUrlDefault() ? requestOrigin(req) : env.APP_URL;
  return base.replace(/\/$/, '');
}

export { SESSION_TTL_MS };
