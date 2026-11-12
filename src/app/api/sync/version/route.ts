/**
 * `GET /api/sync/version` — has anything changed for this user?
 *
 * One opaque string, and the open page compares it with the one it last saw. That
 * is what lets a change made by an automation, another browser or a CalDAV push
 * reach a screen that never made a request of its own: see `src/lib/live-sync.ts`
 * for the poll and `src/server/repos/changes.ts` for what goes into the string.
 *
 * A read, so there is nothing to invalidate and no `AFFECTS` row to declare. It is
 * `no-store` at the HTTP level as well as forced-fresh in the service worker: a
 * cached token is a token that never changes, which would switch the whole feature
 * off while looking perfectly healthy.
 */
import { ok, route } from '@/server/http';
import { changeToken } from '@/server/repos/changes';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const response = ok({ token: await changeToken(user.id) });
  response.headers.set('Cache-Control', 'private, no-store');
  return response;
});
