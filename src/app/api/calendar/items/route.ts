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

  /*
   * Which kinds to project, and whether to bucket by day.
   *
   * Both default to the previous behaviour, so every existing caller keeps the
   * full response. They exist because two screens read this endpoint and want
   * very different halves of it: the calendar screen needs both kinds and the
   * day buckets, while the task list wants events only and drops the buckets on
   * the floor. Sending it everything anyway cost 336 KB of JSON per cold load, of
   * which 293 KB was task projections the client filtered straight back out — and
   * every item was serialised twice, once in `items` and again inside `days`.
   *
   * `includeTasks` and `includeEvents` already existed on `getCalendarItems`;
   * this only stops them being unreachable from the wire.
   */
  const kinds = searchParamList(req, 'kinds') ?? [];
  const includeEvents = kinds.length === 0 || kinds.includes('event');
  const includeTasks = kinds.length === 0 || kinds.includes('task');
  const wantsDays = new URL(req.url).searchParams.get('days') !== '0';

  const [items, calendars] = await Promise.all([
    getCalendarItems({ userId: user.id, zone, startMs, endMs, calendarIds, includeEvents, includeTasks }),
    listCalendars(user.id),
  ]);

  const days = wantsDays ? { days: groupItemsByDay(items, zone) } : {};

  if (!wantsLayout) {
    return ok({ items, calendars, ...days });
  }

  // The day/week grid needs overlap columns; the month grid does not.
  return ok({
    items,
    calendars,
    ...days,
    layout: layoutOverlaps(items),
  });
});
