/**
 * Every block to render in the calendar window: events AND scheduled tasks,
 * with recurring series expanded.
 *
 * This is the single read endpoint the calendar views use. Doing the recurrence
 * expansion server-side means there is exactly one implementation of the hard
 * part, and the client never ships a calendar engine.
 */
import { badRequest, ok, route, searchParamInt, searchParamList } from '@/server/http';
import { getCalendarItems, groupItemsByDay, layoutOverlaps } from '@/server/services/calendar-items';
import { listCalendars } from '@/server/repos/calendars';
import { getSettings } from '@/server/repos/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const startMs = searchParamInt(req, 'startMs', 0);
  const endMs = searchParamInt(req, 'endMs', 0);

  if (!startMs || !endMs || endMs <= startMs) {
    throw badRequest('A valid startMs and endMs range is required.');
  }
  // Guard against a client asking for a decade of daily recurring events.
  if (endMs - startMs > 1000 * 60 * 60 * 24 * 400) {
    throw badRequest('The requested range is too large.');
  }

  const wantsLayout = new URL(req.url).searchParams.get('layout') === '1';
  const calendarIds = searchParamList(req, 'calendarIds');

  const [items, calendars] = await Promise.all([
    getCalendarItems({ userId: user.id, zone, startMs, endMs, calendarIds }),
    listCalendars(user.id),
  ]);

  if (!wantsLayout) {
    return ok({ items, calendars, days: groupItemsByDay(items, zone) });
  }

  // The day/week grid needs overlap columns; the month grid does not.
  return ok({
    items,
    calendars,
    days: groupItemsByDay(items, zone),
    layout: layoutOverlaps(items),
  });
});
