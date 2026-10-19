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
