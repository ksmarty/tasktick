/**
 * The date span of an all-day item, for the accessible name where a clock time
 * would otherwise go.
 *
 * An all-day item has no meaningful time — its `startMs`/`endMs` are whole
 * days — so neither surface prints a clock range: both read `all day` where the
 * range would go, and the date is the day the agenda is grouped under. What
 * still has to reach a screen reader is the exact span: sighted users can see
 * that an item covers three cells, and a name that only said "all day" would not
 * say which days. This produces that span — the day for a one-day item, the
 * range for a multi-day one. No instant is derived: the floating day comes out
 * of `lib/dates`, exactly as everywhere else in the calendar.
 *
 * Kept in one place rather than in a sheet so the surfaces cannot drift apart
 * about what an all-day item's span is.
 */
import { fromDateOnly, toDateOnly } from '@/lib/dates';
import type { CalendarItem } from '@/lib/types';

/**
 * The date an all-day item covers, as a short label for its accessible name.
 *
 * `Sep 18` for a single day; `Sep 18–20` inside one month; `Sep 30 – Oct 2`
 * across months. Month-first, like every other date the app prints. `endMs` is
 * exclusive, so the last day covered is the instant just before it — the same
 * rule the calendar's reschedule uses when it moves an all-day item by whole
 * days.
 */
export function allDayDateLabel(item: CalendarItem, zone: string): string {
  const start = fromDateOnly(toDateOnly(item.startMs, zone), zone);
  // `Math.max` guards a degenerate zero-length item without inventing a day.
  const end = fromDateOnly(toDateOnly(Math.max(item.startMs, item.endMs - 1), zone), zone);

  if (end.hasSame(start, 'day')) return start.toFormat('LLL d');
  if (end.hasSame(start, 'month')) return `${start.toFormat('LLL d')}–${end.toFormat('d')}`;
  return `${start.toFormat('LLL d')} – ${end.toFormat('LLL d')}`;
}
