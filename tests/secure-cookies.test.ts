/**
 * The `Secure` flag on the session cookie, decided per request.
 *
 * This is the one setting that can make a working sign-in look broken: a cookie
 * marked `Secure` that arrives over http is thrown away without a word, so the
 * password is accepted, the redirect happens, and the next page is anonymous.
 * The app used to decide it from `APP_URL` alone — right for the deployment,
 * wrong for the request, and wrong in exactly the setup self-hosters have (an
 * `https://` app also reached as `http://192.168.1.5:3000`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { useSecureCookiesFor } from '@/lib/auth-cookie';

const source = (relative: string): string =>
  readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const decide = (url: string, forwardedProto?: string | null, appUrl = 'https://tasks.example.com') =>
  useSecureCookiesFor({ url, forwardedProto, appUrl });

describe('useSecureCookiesFor', () => {
  it('follows the scheme the request actually used', () => {
    expect(decide('https://tasks.example.com/tasks')).toBe(true);
    expect(decide('http://192.168.1.5:3000/tasks')).toBe(false);
  });

  it('does not mark a cookie Secure for an http request just because APP_URL is https', () => {
    // The regression: the deployment is https, the browser is on the LAN over http,
    // the cookie carries `Secure`, the browser drops it, and every open asks again.
    expect(decide('http://192.168.1.5:3000/tasks', null, 'https://tasks.example.com')).toBe(false);
  });

  it('believes a proxy over the request URL, because only the proxy saw the browser', () => {
    // nginx/traefik terminate TLS and speak http to the app.
    expect(decide('http://app:3000/api/auth/get-session', 'https')).toBe(true);
    expect(decide('https://tasks.example.com/api/auth/get-session', 'http')).toBe(false);
  });

  it('reads the first entry of a forwarded list, and ignores case', () => {
    expect(decide('http://app:3000/', 'HTTPS, http')).toBe(true);
    expect(decide('http://app:3000/', 'http, https')).toBe(false);
  });

  it('falls back to the configured URL when the request says nothing', () => {
    expect(decide('', null, 'https://tasks.example.com')).toBe(true);
    expect(decide('', null, 'http://localhost:3000')).toBe(false);
  });
});

describe('the auth instance', () => {
  it('is built per cookie scheme, because the flag is baked into it', () => {
    const AUTH = source('src/server/auth.ts');
    expect(AUTH).toContain('const secureCookies = options.secureCookies ?? env.APP_URL.startsWith');
    expect(AUTH).toContain('useSecureCookies: secureCookies');
    // Two instances, keyed by the decision, and the healing path clears both.
    expect(AUTH).toContain('let cachedByScheme: { secure?: Auth; insecure?: Auth } = {};');
    expect(AUTH).toContain('export function getAuthForRequest(request: Request): Auth {');
    expect(AUTH).toMatch(/export function resetAuthCache\(\): void \{\n  cached = null;\n  cachedByScheme = \{\};\n\}/);
  });

  it('serves each auth request from the instance matching its scheme', () => {
    const ROUTE = source('src/app/api/auth/[...all]/route.ts');
    expect(ROUTE).toContain('toNextJsHandler(getAuthForRequest(request))');
    expect(ROUTE).not.toContain('toNextJsHandler(getAuth())');
  });
});

describe('the sign-in page', () => {
  it('distinguishes a rejected cookie from no cookie at all', () => {
    const PAGE = source('src/app/(auth)/login/page.tsx');
    expect(PAGE).toContain('getSessionCookie({ headers: request.headers } as Request, { cookiePrefix: AUTH_COOKIE_PREFIX })');
    expect(PAGE).toContain('expiredSession={sentSessionCookie && !oidcFailure}');
    // And the form says so, rather than showing the same bare password box.
    const FORM = source('src/components/auth/LoginForm.tsx');
    expect(FORM).toContain('Your saved session is no longer valid');
  });
});
