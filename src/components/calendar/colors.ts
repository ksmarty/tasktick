import { accentHex, asAccentColor, resolveCalendarColor } from '@/lib/colors';
import type { AccentColor, Calendar, CalendarItem } from '@/lib/types';
import type { CalendarLookup } from './types';

/**
 * The colour an item is actually drawn in, as a palette token.
 *
 * The server resolves a colour for every item, but a task's colour is always its
 * calendar's base colour — the calendar's `colorOverride` (the user's "show this
 * calendar as green" preference) is only honoured for events there. Applying it
 * here covers both kinds from one place.
 *
 * An explicit per-event colour still wins: it is the only case where the item's
 * colour differs from its calendar's base colour.
 *
 * A *token* is all this can return. A calendar whose custom colour is a literal
 * (`#ff00aa`, which is what a CalDAV collection's `calendar-color` is) cannot be
 * expressed as one — use `itemHex` for painting.
 */
export function itemColor(item: CalendarItem, calendars: CalendarLookup): AccentColor {
  const calendar = item.calendarId ? calendars.get(item.calendarId) : undefined;
  if (!calendar || calendar.colorOverride === null) return item.color;
  if (item.color !== calendar.color) return item.color;
  return resolveCalendarColor(calendar.color, calendar.colorOverride);
}

/**
 * A calendar's custom colour, when the stored override is a literal colour
 * rather than one of the twelve palette tokens.
 *
 * ## Why this exists rather than `resolveCalendarColor`
 *
 * `colorOverride` is free-form text (`updateCalendarSchema` allows any string up
 * to 32 characters) and the CalDAV sync writes the remote collection's own
 * `calendar-color` into it — `#RRGGBB`, sometimes with an alpha byte. Reads go
 * through `resolveCalendarColor`, which narrows the override with
 * `asAccentColor`; anything that is not one of the twelve palette names falls
 * back to `blue`. So a custom calendar colour reached the database, was returned
 * by the API, and then silently became blue in every place the calendar feature
 * painted it: the agenda's row edge, the day sheet's dot, the sidebar's dot, the
 * event editor's calendar list and the calendar screen's filter chip.
 *
 * A literal colour is therefore passed through verbatim. A token-shaped override
 * (the palette's own spelling, e.g. `gray`) still resolves through the accent
 * map, so both spellings of a custom colour work.
 */
export function customCalendarHex(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(trimmed) ? trimmed : null;
}

/**
 * The hex a calendar is drawn in: its custom colour when it has one, otherwise
 * its accent token.
 */
export function calendarColorHex(calendar: Calendar | null | undefined, dark = false): string {
  return customCalendarHex(calendar?.colorOverride) ?? accentHex(asAccentColor(calendar?.color), dark);
}

/**
 * The hex an item is drawn in, custom calendar colours included.
 *
 * The same rule as `itemColor` — an explicit per-event colour wins, otherwise
 * the calendar's colour — with one extra step: when the calendar's custom colour
 * is a literal, that literal is what gets painted. The server has already
 * narrowed it to a token by the time the item arrives, so the item's own colour
 * cannot be used to detect it; what the item's colour *can* say is whether it is
 * derived at all. It is derived when it equals the calendar's base colour (the
 * server's answer for tasks, and for events with no colour of their own) or the
 * narrowed override (the server's answer for events when one is set) — either
 * way, no explicit colour was given, so the calendar's custom one is the answer.
 */
export function itemHex(item: CalendarItem, calendars: CalendarLookup, dark = false): string {
  const calendar = item.calendarId ? calendars.get(item.calendarId) : undefined;
  const custom = customCalendarHex(calendar?.colorOverride);
  if (custom && calendar) {
    const derived =
      item.color === calendar.color ||
      item.color === resolveCalendarColor(calendar.color, calendar.colorOverride);
    if (derived) return custom;
  }
  return accentHex(itemColor(item, calendars), dark);
}
