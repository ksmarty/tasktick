/**
 * Visible labels for a calendar item where a clock time would otherwise go.
 *
 * An all-day item has no meaningful time — its `startMs`/`endMs` are whole
 * days — so a detail sheet or an agenda gutter that shows a clock range, or the
 * words "All day" in the time slot, is noise. The one piece of information such
 * an item does carry is its date, and that is what this produces: the day for a
 * one-day item, the span for a multi-day one. No instant is derived: the
 * floating day comes out of `lib/dates`, exactly as everywhere else in the
 * calendar.
 *
 * Kept in one place rather than in either sheet so the day-detail sheet and the
 * agenda gutter cannot drift apart about what an all-day item reads as.
 */
import { fromDateOnly, toDateOnly } from '@/lib/dates';
import type { CalendarItem } from '@/lib/types';

/**
 * The date an all-day item covers, as a short label.
 *
 * `18 Sep` for a single day; `18–20 Sep` inside one month; `30 Sep – 2 Oct`
 * across months. `endMs` is exclusive, so the last day covered is the instant
 * just before it — the same rule the calendar's reschedule uses when it moves
 * an all-day item by whole days.
 */
export function allDayDateLabel(item: CalendarItem, zone: string): string {
  const start = fromDateOnly(toDateOnly(item.startMs, zone), zone);
  // `Math.max` guards a degenerate zero-length item without inventing a day.
  const end = fromDateOnly(toDateOnly(Math.max(item.startMs, item.endMs - 1), zone), zone);

  if (end.hasSame(start, 'day')) return start.toFormat('d LLL');
  if (end.hasSame(start, 'month')) return `${start.toFormat('d')}–${end.toFormat('d LLL')}`;
  return `${start.toFormat('d LLL')} – ${end.toFormat('d LLL')}`;
}
