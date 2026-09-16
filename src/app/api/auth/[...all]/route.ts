/**
 * better-auth catch-all handler.
 *
 * Mounting it here means every auth endpoint (sign-in, sign-up, sign-out,
 * session, OIDC callback) lives under `/api/auth/*` with no per-route code, and
 * `nextCookies()` can set the session cookie from inside a Route Handler.
 */
import { getAuth } from '@/server/auth';
import { toNextJsHandler } from 'better-auth/next-js';

export const { GET, POST } = toNextJsHandler(getAuth());
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
