import type { AccentColor, Calendar, CalendarItem } from '@/lib/types';

/** Everything the calendar views need to render times consistently. */
export interface CalendarPrefs {
  zone: string;
  weekStartsOn: number;
  timeFormat: '12h' | '24h';
}

/**
 * Shared, mutable gesture flags.
 *
 * One instance lives in `CalendarScreen` and is handed to every view, so a
 * horizontal paging swipe can tell "the user is paging" from "the user is
 * dragging a block", and a drag can swallow the click that follows it.
 */
export interface CalendarInteraction {
  /** True from the moment a block is lifted until it is dropped. */
  dragging: boolean;
  /** Set by the drop handler so the click that follows does not open a sheet. */
  suppressClick: boolean;
}

export function createInteraction(): CalendarInteraction {
  return { dragging: false, suppressClick: false };
}

/** Open an item: events open the editor, tasks are handed to the tasks view. */
export type ItemOpenHandler = (item: CalendarItem) => void;

/** Where a drag landed, in view-relative terms. */
export interface RescheduleTarget {
  /** Whole days the block moved (0 for a vertical-only drag). */
  dayDelta: number;
  /** New start, minutes from midnight; unchanged for an all-day drag. */
  startMinute: number;
}

export type RescheduleHandler = (item: CalendarItem, target: RescheduleTarget) => void;

/** A calendar lookup that already honours `colorOverride`. */
export type CalendarLookup = Map<string, Calendar>;

/** The calendar a "show only this one" filter is pinned to. */
export interface CalendarFilter {
  id: string;
  name: string;
  color: AccentColor;
}
