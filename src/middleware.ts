/**
 * Keeps the requested page across a sign-in.
 *
 * A notification tap opens a deep link (`/tasks?task=t1`). If that link reaches
 * a browser without a session, the app layout redirects to `/login` and the
 * destination — which is the whole point of the notification — was gone. The
 * layout cannot know its own URL (Next gives a layout no pathname), so the
 * remember-and-redirect happens here, before the request is rendered.
 *
 * The check is deliberately *optimistic*: `getSessionCookie()` only reports
 * whether a session cookie is present, not whether it is valid. That is the
 * documented better-auth pattern, and it is the right trade here — a forged or
 * expired cookie still fails at the app layout's real check, while a valid
 * session never pays for a database round trip in middleware. No protected
 * content is ever served on this decision alone.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';
import { AUTH_COOKIE_PREFIX } from '@/lib/auth-cookie';

/** Every signed-in route. A prefix list rather than a catch-all, so a new public page is never accidentally gated. */
const PROTECTED = ['/tasks', '/today', '/calendar', '/habits', '/matrix', '/pomodoro', '/search', '/settings'];

export function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Checked here as well as in the matcher, and not for redundancy: a matcher
  // that fails to apply (a typo, or a new middleware file the dev server has not
  // picked up yet) would otherwise redirect `/login` to `/login` forever, which
  // locks everyone out. The list is the guard; the matcher only keeps unrelated
  // requests out of this function.
  if (!PROTECTED.some((path) => pathname === path || pathname.startsWith(`${path}/`))) {
    return NextResponse.next();
  }

  if (getSessionCookie(request, { cookiePrefix: AUTH_COOKIE_PREFIX })) return NextResponse.next();

  const login = new URL('/login', request.url);
  login.searchParams.set('next', `${pathname}${search}`);
  return NextResponse.redirect(login);
}

/**
 * Written out rather than derived from `PROTECTED`: Next parses this export
 * statically at build time, and rejects a `.map()` over a variable ("the
 * exported configuration object needs a very specific format"). The two lists
 * are kept in step by hand, and the in-function check above means a drift can
 * only cost a wasted function call, never an unguarded route.
 */
export const config = {
  matcher: [
    '/tasks/:path*',
    '/today/:path*',
    '/calendar/:path*',
    '/habits/:path*',
    '/matrix/:path*',
    '/pomodoro/:path*',
    '/search/:path*',
    '/settings/:path*',
  ],
};
