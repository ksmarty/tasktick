/**
 * better-auth catch-all handler.
 *
 * Mounting it here means every auth endpoint (sign-in, sign-up, sign-out,
 * session, OIDC callback) lives under `/api/auth/*` with no per-route code, and
 * `nextCookies()` can set the session cookie from inside a Route Handler.
 *
 * The wrapper is resolved per request rather than once at module load. That is
 * deliberate: `getAuth()` memoises an instance whose OIDC provider registration
 * is decided by a single discovery fetch, so a module-level constant would pin
 * the result of that one fetch for the life of the process — including a
 * failure. `withProviderHeal` can only rebuild what it can rebuild, and it needs
 * a handler that asks `getAuth()` again to do it.
 */
import { getAuth } from '@/server/auth';
import { withProviderHeal } from '@/server/oidc-heal';
import { toNextJsHandler } from 'better-auth/next-js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function handle(request: Request): Promise<Response> {
  const handlers = toNextJsHandler(getAuth());
  return request.method === 'GET' ? handlers.GET(request) : handlers.POST(request);
}

export function GET(request: Request): Promise<Response> {
  return withProviderHeal(request, handle);
}

export function POST(request: Request): Promise<Response> {
  return withProviderHeal(request, handle);
}
