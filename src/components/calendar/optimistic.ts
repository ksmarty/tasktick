'use client';

import { eachDayInclusive, toDateOnly } from '@/lib/dates';
import type { CalendarItem, Millis } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';

export interface MovedInstants {
  startMs: Millis;
  /** Exclusive end. */
  endMs: Millis;
}

/**
 * Applies a reschedule to the cached payload so the grid moves the instant the
 * finger lifts, before the server has answered.
 *
 * This is an *optimistic patch of one item*, not a second calendar engine: it
 * re-points the item's bucket in `days` and its entry in `layout`, but it never
 * expands a recurrence and never recomputes overlap columns — the server
 * response (which `invalidate` + `refresh` fetch immediately afterwards) is the
 * only authority for those.
 */
export function moveItemInPayload(
  payload: CalendarItemsPayload,
  key: string,
  next: MovedInstants,
  zone: string,
): CalendarItemsPayload {
  const items = payload.items.map((item) =>
    item.key === key ? { ...item, startMs: next.startMs, endMs: next.endMs } : item,
  );
  const moved = items.find((item) => item.key === key);
  if (!moved) return payload;

  const layout = payload.layout?.map((entry) =>
    entry.item.key === key ? { ...entry, item: { ...entry.item, startMs: next.startMs, endMs: next.endMs } } : entry,
  );

  const days: Record<string, CalendarItem[]> = {};
  for (const [day, list] of Object.entries(payload.days)) {
    days[day] = list.filter((item) => item.key !== key);
  }

  const firstDay = toDateOnly(moved.startMs, zone);
  const lastDay = toDateOnly(Math.max(moved.startMs, moved.endMs - 1), zone);
  for (const day of eachDayInclusive(firstDay, lastDay, zone)) {
    // Only days the server actually returned are re-pointed, so a drag cannot
    // conjure a bucket outside the requested window.
    if (!(day in days)) continue;
    days[day] = [...days[day], moved].sort(compareItems);
  }

  return { ...payload, items, days, layout };
}

/** The server's bucket order: all-day first, then by start, then longest first. */
function compareItems(a: CalendarItem, b: CalendarItem): number {
  if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
  if (a.startMs !== b.startMs) return a.startMs - b.startMs;
  return b.endMs - b.startMs - (a.endMs - a.startMs);
}
