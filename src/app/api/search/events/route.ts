/**
 * Calendar-event search, shaped as the calendar's own item list.
 *
 * The task list's search field used to look only at `/api/tasks`, so a query
 * could not reach a calendar event at all — and the range endpoint
 * (`/api/calendar/items`) cannot stand in, because it needs a window and refuses
 * more than 400 days of one. This route searches the event rows directly and
 * hands back `CalendarItem`s, the same shape the detail sheet opens, so a hit
 * behaves exactly like a tap on the calendar.
 *
 * Same floor as the global search: two characters, because one matches half the
 * calendar and costs the same to compute.
 */
import { ok, route, searchParam } from '@/server/http';
import { listCalendars, searchCalendarEvents } from '@/server/repos/calendars';
import { getSettings } from '@/server/repos/settings';
import { asAccentColor } from '@/lib/colors';
import { dateOnlyToMillis } from '@/lib/dates';
import type { CalendarItem, Calendar } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Enough to fill a screen and no more; the tasks below it are the point. */
const EVENT_SEARCH_LIMIT = 20;

export const GET = route(async ({ user, req }) => {
  const query = (searchParam(req, 'q') ?? '').trim();
  if (query.length < 2) return ok({ items: [] as CalendarItem[] });

  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const [events, calendars] = await Promise.all([
    searchCalendarEvents(user.id, query, EVENT_SEARCH_LIMIT),
    listCalendars(user.id),
  ]);
  const byId = new Map(calendars.map((calendar) => [calendar.id, calendar]));

  const items = events.map((event) => eventSearchItem(event, byId.get(event.calendarId), zone));
  return ok({ items });
});

/**
 * One row, as the calendar would draw it.
 *
 * An all-day event has no instants of its own — `startMs`/`endMs` are null and
 * the date is what it is — so the millisecond the list sorts and labels by comes
 * from the date at the start of the day, in the user's zone. That is the same
 * conversion the calendar screen applies, which is what keeps a hit's date from
 * disagreeing with the day it opens on.
 */
function eventSearchItem(
  event: Awaited<ReturnType<typeof searchCalendarEvents>>[number],
  calendar: Calendar | undefined,
  zone: string,
): CalendarItem {
  const startMs = event.startMs ?? (event.startDate ? dateOnlyToMillis(event.startDate, zone) : 0);
  const endMs = event.endMs ?? (event.endDate ? dateOnlyToMillis(event.endDate, zone) : startMs);

  return {
    key: `event:${event.id}:${startMs}`,
    kind: 'event',
    id: event.id,
    title: event.summary || '(No title)',
    startMs,
    endMs,
    isAllDay: event.isAllDay,
    color: asAccentColor(event.color ?? calendar?.colorOverride ?? calendar?.color ?? 'blue'),
    calendarId: event.calendarId,
    calendarName: calendar?.name,
    location: event.location,
    url: event.url,
    seriesUid: event.uid,
    isRecurringInstance: Boolean(event.rrule),
    readonly: calendar?.readOnly ?? true,
  };
}
