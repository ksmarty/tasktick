/**
 * Demo mode — see the app populated, without touching your own data.
 *
 * ## What it is
 *
 * A cookie turns it on. While it is set, **every request runs as the sample
 * account instead of the signed-in one**: reads and writes both. So the app is
 * fully interactive — you can tick a task off, log a day, check in a habit and
 * watch the UI respond — and nothing you do can reach your own rows, because as
 * far as the server is concerned you *are* the sample user for that request.
 *
 * ## Why the server and not the client
 *
 * A client-side demo mode is a promise; this is a guarantee. There are dozens of
 * write paths in this app and one of them missing the check would edit real data —
 * which is the exact thing the user asked to avoid. The swap happens in `route()`
 * (`src/server/http.ts`), which resolves the session user for **every** API
 * handler, so a route cannot opt out of it by forgetting.
 *
 * ## Why a cookie and not a settings column
 *
 * `route()` runs on every API call, and reading a setting would mean a database
 * query per request just to decide whose data to read. The cookie is read from the
 * request that is already in hand.
 *
 * That is also why the cookie carries **only a boolean**. The sample account is
 * resolved here, server-side, from a fixed address — a client cannot name the
 * account it becomes. The worst a forged cookie achieves is viewing the sample
 * data, which is what the cookie is for; it can never reach another user.
 */
import { eq } from 'drizzle-orm';
import { getDb } from '@/server/db';
import { user } from '@/server/db/schema';

/** The cookie the app sets when demo mode is on. */
export const DEMO_COOKIE = 'tasktick-demo';

/**
 * The sample account, by address. **Not** the seeded account a user signs in as —
 * that one may be the user's own, and demo mode must never read or write it.
 */
export const SAMPLE_EMAIL = 'sample@tasktick.local';

/**
 * Cached for the life of the process: the address never changes, and this runs on
 * every request.
 *
 * `undefined` means "not looked up yet"; `null` means "looked up and absent",
 * which is a real state worth distinguishing — a database seeded before this
 * feature existed has no sample account, and the app should say so rather than
 * fall back to the user's own data.
 */
let cachedSampleId: string | null | undefined;

/** The sample account's id, or `null` when it has not been seeded. */
export async function resolveSampleUserId(): Promise<string | null> {
  if (cachedSampleId !== undefined) return cachedSampleId;
  const [row] = await getDb()
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, SAMPLE_EMAIL))
    .limit(1);
  cachedSampleId = row?.id ?? null;
  // `null` is cached deliberately: `route()` provisions on a miss, and the id it
  // gets back is stored below rather than re-queried on every request.
  return cachedSampleId;
}

/** Test seam: forget the cached lookup so a fresh database is re-read. */
/**
 * Remembers an id that was provisioned after this module had already cached a
 * miss. Without it, `resolveSampleUserId` would return the cached `null` on every
 * subsequent request and `route()` would try to create the sample account again
 * each time — which is a write per request on the demo path.
 */
export function rememberSampleUserId(id: string): void {
  cachedSampleId = id;
}

export function resetSampleCache(): void {
  cachedSampleId = undefined;
}

/** Whether this request asked for demo mode. A boolean, and nothing else. */
export function isDemoRequest(req: { cookies: { get(name: string): { value: string } | undefined } }): boolean {
  return req.cookies.get(DEMO_COOKIE)?.value === '1';
}
