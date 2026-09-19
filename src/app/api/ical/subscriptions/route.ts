/**
 * Calendar subscriptions: list and create.
 *
 * A subscription mirrors a remote `.ics` feed into a read-only calendar. The
 * first fetch happens on create rather than on the next scheduler tick, so a URL
 * that is wrong says so while the user is still looking at the form instead of
 * silently producing an empty calendar.
 */
import { fail, ok, parseJson, route } from '@/server/http';
import { icalSubscribeSchema } from '@/lib/schemas';
import { FeedError } from '@/server/services/ical-fetch';
import { listIcalSubscriptions, subscribeToIcal } from '@/server/services/ical-subscription';
import { ensureSyncScheduler } from '@/server/services/scheduler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A cold feed on a slow host can take a while; the fetch itself caps the wait.
export const maxDuration = 60;

export const GET = route(async ({ user }) => ok({ subscriptions: await listIcalSubscriptions(user.id) }));

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, icalSubscribeSchema);

  try {
    const { calendar, sync } = await subscribeToIcal(user.id, body);

    /*
     * The scheduler only loads the sync stack when there is something to sync, so
     * adding the FIRST subscription has to start it — otherwise refresh would
     * not run until the next restart, which reads as "subscriptions are broken"
     * much later and far from the cause. Idempotent, and a no-op once running.
     */
    try {
      await ensureSyncScheduler();
    } catch (error) {
      console.warn('[ical] could not start the sync scheduler:', error);
    }

    return ok({ calendar, imported: sync.created, sync }, 201);
  } catch (error) {
    /*
     * A feed that cannot be used is the user's problem to fix, not a server
     * fault: the URL is wrong, points somewhere private, is too large, or the
     * remote is down. Each of those has a distinct message, so the form can show
     * which rather than a generic failure.
     */
    if (error instanceof FeedError) return fail(error.message, 422, error.code);
    throw error;
  }
});
