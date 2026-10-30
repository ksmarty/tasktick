/**
 * Which calendars a *new* item may be filed into.
 *
 * Two filters, for two different reasons:
 *
 * 1. **Read-only** — a subscribed feed or a pull-only CalDAV collection is not a
 *    destination. Choosing one stores the item locally and never writes it back,
 *    which is the silent loss the editors already refuse to offer.
 * 2. **Hidden** — `isVisible` is the eye in Settings → Calendars, and a calendar
 *    the user has hidden is one they have said they do not want to see. Offering
 *    it in a picker is worse than offering nothing: the item lands in a calendar
 *    that draws no events, so from the user's side the calendar they chose was
 *    silently disregarded and the item vanished.
 *
 * The *current* value is still resolved against the unfiltered list by the
 * callers, so an item that already sits in a now-hidden or now-read-only
 * calendar keeps its name on screen while the user picks somewhere writable.
 */
import type { Calendar as CalendarRecord } from '@/lib/types';

export function selectableCalendars(calendars: readonly CalendarRecord[]): CalendarRecord[] {
  return calendars.filter((calendar) => !calendar.readOnly && calendar.isVisible);
}

/**
 * Which calendars a *task* may be filed into.
 *
 * A calendar is an event's home; a collection holds tasks only when it accepts
 * VTODOs (`supportsVtodo`). Offering an event-only calendar in the task editor
 * produced the report this function exists to end: the task was written, the
 * calendar drew it as a task row, and every editor opened it as a task — the item
 * had been filed into a calendar that has no notion of a task, and from the user's
 * side the calendar they picked had been disregarded.
 *
 * The current value is not special-cased: the combobox resolves the trigger's
 * name across *all* calendars, so a task that already sits in an event-only
 * collection still shows where it is while the user picks somewhere writable.
 */
export function calendarsThatHoldTasks(calendars: readonly CalendarRecord[]): CalendarRecord[] {
  return selectableCalendars(calendars).filter((calendar) => calendar.supportsVtodo);
}
