/**
 * The destination a sign-in has to preserve.
 *
 * A reminder notification opens a deep link. When the browser that opens it has
 * no session — an installed PWA on iOS keeps its own cookie store, so a tap that
 * lands in Safari is never signed in — the user was dropped on the generic task
 * list after signing in, and the reminder they tapped was gone. The middleware
 * remembers the request, `safeNextPath()` decides whether it may be followed.
 */
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { AUTH_COOKIE_PREFIX } from '@/lib/auth-cookie';
import { safeNextPath } from '@/lib/safe-next';
import { middleware } from '@/middleware';

describe('safeNextPath', () => {
  it('follows a same-origin path, query included', () => {
    expect(safeNextPath('/tasks?task=t1')).toBe('/tasks?task=t1');
    expect(safeNextPath('/calendar?date=2026-10-19&event=e1')).toBe('/calendar?date=2026-10-19&event=e1');
  });

  it('falls back when nothing was remembered', () => {
    expect(safeNextPath(undefined)).toBe('/tasks');
    expect(safeNextPath('')).toBe('/tasks');
    expect(safeNextPath([])).toBe('/tasks');
  });

  it('refuses anything that leaves the app', () => {
    // The three shapes that turn a redirect parameter into an open redirect.
    expect(safeNextPath('//evil.example/tasks')).toBe('/tasks');
    expect(safeNextPath('https://evil.example/tasks')).toBe('/tasks');
    expect(safeNextPath('/\\evil.example')).toBe('/tasks');
    expect(safeNextPath('/tasks\nSet-Cookie: x=y')).toBe('/tasks');
  });
});

describe('middleware', () => {
  const request = (path: string, cookie?: string) =>
    new NextRequest(new URL(path, 'http://127.0.0.1:3000'), {
      headers: cookie ? { cookie } : {},
    });

  it('sends a signed-out deep link to the sign-in page with the destination', () => {
    const response = middleware(request('/tasks?task=t1'));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/tasks?task=t1');
  });

  it('leaves the sign-in page and every public route alone', () => {
    // This is what keeps a matcher mistake from becoming a redirect loop.
    for (const path of ['/login', '/register', '/healthz', '/offline', '/api/tasks', '/tasks-preview']) {
      const response = middleware(request(path));
      expect(response.headers.get('location'), `${path} was redirected`).toBeNull();
    }
  });

  it('lets a request that carries a session cookie through untouched', () => {
    // The cookie name is the app's prefix (`src/lib/auth-cookie.ts`), not
    // better-auth's default: passing the wrong one would redirect every
    // signed-in request back to the sign-in page.
    for (const cookie of [
      `${AUTH_COOKIE_PREFIX}.session_token=abc`,
      // What production actually sends: `advanced.useSecureCookies` is on
      // whenever APP_URL is https, and the browser returns the `__Secure-` name.
      `__Secure-${AUTH_COOKIE_PREFIX}.session_token=abc`,
    ]) {
      const response = middleware(request('/tasks', cookie));
      expect(response.status, cookie).toBe(200);
      expect(response.headers.get('location'), cookie).toBeNull();
    }
  });
});
