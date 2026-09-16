/**
 * Everything the app shell needs on first paint, in one round trip.
 *
 * Collapsing four calls (settings, lists, tags, counts) into one is what keeps
 * the installed PWA feeling instant on a cold start over a slow connection.
 */
import { ok, route } from '@/server/http';
import { getSettings } from '@/server/repos/settings';
import { listLists, listTags } from '@/server/repos/lists';
import { listCalendars } from '@/server/repos/calendars';
import { buildAgenda } from '@/server/repos/tasks';
import { startSyncScheduler } from '@/server/sync';
import { getEnv, pushConfigured, oidcConfigured } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const [lists, tags, calendars, agenda] = await Promise.all([
    listLists(user.id),
    listTags(user.id),
    listCalendars(user.id),
    buildAgenda(user.id, zone),
  ]);

  // The scheduler is process-wide and idempotent; this is the most reliable
  // place to make sure it is running, since every session hits this endpoint.
  if (getEnv().SYNC_ENABLED) {
    try {
      startSyncScheduler();
    } catch (error) {
      console.warn('[bootstrap] sync scheduler failed to start:', error);
    }
  }

  const inboxListId = lists.find((l) => l.isInbox)?.id ?? lists[0]?.id ?? null;

  return ok({
    user,
    settings,
    lists,
    tags,
    calendars,
    inboxListId,
    agenda,
    capabilities: {
      push: pushConfigured(),
      oidc: oidcConfigured(),
      // Read from the server-side variable, not a NEXT_PUBLIC_ one: those are
      // inlined at BUILD time, so a container configured at runtime would hand the
      // browser an undefined key and push would silently stay disabled.
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    },
  });
});
