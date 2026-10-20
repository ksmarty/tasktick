/**
 * The cookie namespace better-auth uses for this app.
 *
 * In its own module because the middleware needs it and cannot import
 * `src/server/auth.ts` — that pulls in the database driver and drizzle, which
 * have no place in the edge bundle. `src/server/auth.ts` sets
 * `advanced.cookiePrefix` from this constant, so the two can never disagree:
 * a mismatch would make the middleware redirect signed-in users to `/login`
 * forever, which looks like a broken session rather than a typo.
 */
export const AUTH_COOKIE_PREFIX = 'tasktick';

/**
 * Whether the session cookie can be marked `Secure` for *this* request.
 *
 * `Secure` is a promise to the browser that the cookie will only ever travel over
 * https, so a cookie carrying it that arrives over http is silently discarded —
 * the sign-in succeeds, the redirect looks right, and the next page is anonymous
 * again. That is the shape of "it asks for my password every time I open it".
 *
 * The app used to decide this from `APP_URL` alone, which is correct for the
 * deployment and wrong for the request: a self-hosted instance whose `APP_URL` is
 * `https://…` is also reached as `http://192.168.1.5:3000` on the LAN, and the
 * home-screen app installed from that address can never hold a session. A reverse
 * proxy in front of an http app is the same problem in the other direction, which
 * is why `X-Forwarded-Proto` wins when it is set: the proxy is the only party that
 * knows what the browser actually spoke.
 */
export function useSecureCookiesFor(input: {
  /** The request's own URL, e.g. `new Request(...).url`. */
  url: string;
  /** `X-Forwarded-Proto`, if a proxy set one. Comma lists are tolerated. */
  forwardedProto?: string | null;
  /** The configured `APP_URL`, used only when the request says nothing. */
  appUrl: string;
}): boolean {
  const forwarded = input.forwardedProto?.split(',')[0]?.trim().toLowerCase();
  if (forwarded) return forwarded === 'https';

  const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(input.url)?.[1]?.toLowerCase();
  if (protocol === 'https') return true;
  if (protocol === 'http') return false;

  /* No usable request (a server-side call, a migration script): trust the config. */
  return input.appUrl.startsWith('https://');
}
