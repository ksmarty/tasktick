import { resolveCalendarColor } from '@/lib/colors';
import type { AccentColor, CalendarItem } from '@/lib/types';
import type { CalendarLookup } from './types';

/**
 * The colour an item is actually drawn in.
 *
 * The server resolves a colour for every item, but a task's colour is always its
 * calendar's base colour — the calendar's `colorOverride` (the user's "show this
 * calendar as green" preference) is only honoured for events there. Applying it
 * here covers both kinds from one place.
 *
 * An explicit per-event colour still wins: it is the only case where the item's
 * colour differs from its calendar's base colour.
 */
export function itemColor(item: CalendarItem, calendars: CalendarLookup): AccentColor {
  const calendar = item.calendarId ? calendars.get(item.calendarId) : undefined;
  if (!calendar || calendar.colorOverride === null) return item.color;
  if (item.color !== calendar.color) return item.color;
  return resolveCalendarColor(calendar.color, calendar.colorOverride);
}
