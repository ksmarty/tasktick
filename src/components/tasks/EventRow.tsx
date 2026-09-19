'use client';

/**
 * A calendar event rendered as a task-list row.
 *
 * Events and tasks share the list, so the row has to say which is which without
 * a second legend. The one mark is the leading glyph: a task carries the shadcn
 * `Checkbox`, an event carries a calendar icon in the *same* 44px touch target
 * and at the same 20px (`size-5`) the checkbox paints. That is the whole
 * "not completable" signal — there is no checkbox, no swipe-to-complete and no
 * row menu here, because there is nothing to complete.
 *
 * The row keeps the list's shape (44px tall, the `px-row` inset, the same
 * press-highlight region, the rounded last corner) and adds the per-row colour
 * strip the tasks have, in the event's calendar colour. That colour is resolved
 * through `itemHex`, which honours a calendar's custom `#rrggbb`
 * `colorOverride` rather than narrowing it to one of the twelve palette tokens.
 *
 * The title button carries the same `-ml-2` the task row does, so the
 * glyph-to-title gap here is the same 12px as the glyph-to-strip gap and the two
 * row shapes stay in step with each other (see `TaskRow`).
 *
 * ## The title is one line
 *
 * Both rows keep the title to one ellipsised line. The task title used to wrap,
 * on the argument that a task list is where you read what the task is; that is
 * overruled (see `TaskRow`), so the two rows now agree on typography rather than
 * diverging here.
 */
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { itemHex } from '@/components/calendar/colors';
import type { CalendarLookup } from '@/components/calendar/types';
import { formatTime, toDateOnly } from '@/lib/dates';
import type { CalendarItem } from '@/lib/types';
import { cn } from '@/lib/utils';
import { absoluteDayLabel } from './due-label';

/** A stable empty lookup, so an event with no calendars passed still paints. */
const EMPTY_CALENDARS: CalendarLookup = new Map();

export interface EventRowProps {
  event: CalendarItem;
  zone: string;
  timeFormat: '12h' | '24h';
  /** Opens the event's detail sheet. */
  onOpen?: (event: CalendarItem) => void;
  /**
   * The calendars, so the strip can resolve the calendar's own colour — a custom
   * `#rrggbb` `colorOverride` included. See `itemHex`.
   */
  calendars?: CalendarLookup;
  /** Whether the resolved appearance is dark, for the accent hex lookup. */
  dark?: boolean;
  /** Squares the top of the first row's press region (it is not at a corner). */
  first?: boolean;
  /** Rounds the bottom corner of the last row, so its strip follows the card. */
  last?: boolean;
  /**
   * The row is outside the Today section, so its trailing label is the date
   * rather than "All day" or a clock time. The section knows this; the row does
   * not (see `TaskListSection`).
   */
  showDate?: boolean;
  className?: string;
}

export function EventRow({
  event,
  zone,
  timeFormat,
  onOpen,
  calendars,
  dark = false,
  first = false,
  last = false,
  showDate = false,
  className,
}: EventRowProps) {
  const timeLabel = showDate
    ? absoluteDayLabel(toDateOnly(event.startMs, zone), zone)
    : event.isAllDay
      ? 'All day'
      : formatTime(event.startMs, { zone, timeFormat, weekStartsOn: 0 });

  const accessibleName = [
    timeLabel,
    event.title,
    'event',
    event.location ? `at ${event.location}` : null,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <li
      className={cn(
        // Only the last row sits on the card's corner, so only it rounds.
        'relative isolate overflow-hidden',
        last && 'rounded-b-lg',
        className,
      )}
    >
      <div className="relative z-10 flex min-h-11 w-full items-center gap-1 px-row">
        {/* The per-row colour strip: the event's calendar colour, custom hexes
            included (see `itemHex`). */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: itemHex(event, calendars ?? EMPTY_CALENDARS, dark) }}
        />

        {/*
         * The calendar glyph stands where the checkbox stands on a task row —
         * the same `-ml-3` + `size-11` target, so the two shapes line up down
         * the list. `disableHover` because the glyph is a label, not a control:
         * the whole row is the hit target.
         */}
        <span className="-ml-3 grid size-11 shrink-0 place-items-center text-muted-foreground">
          <CalendarIcon className="size-5 text-xl" disableHover aria-hidden />
        </span>

        <button
          type="button"
          onClick={() => onOpen?.(event)}
          aria-label={accessibleName}
          // `-ml-2` cancels the 4px track gap and the button's own 4px left
          // padding, so the title begins 12px from the calendar glyph — the same
          // 12px that separates the glyph from the colour strip (see `TaskRow`).
          className="group/row-content relative -ml-2 flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {/* The same inset press region the task row uses; its top edge is
              squared on the first row of the group (see `TaskRow`). */}
          <span
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-x-1.5 inset-y-1 rounded-md bg-accent/0 transition-colors group-hover/row-content:bg-accent/30 group-active/row-content:bg-accent/50',
              first && 'rounded-t-none',
            )}
          />
          <span className="relative flex min-w-0 flex-1 items-center gap-1">
            {/* Single line, ellipsised: an event is a point in time, not prose. */}
            <span className="min-w-0 flex-1 truncate text-base leading-tight">{event.title}</span>
            <span className="shrink-0 text-xs leading-5 whitespace-nowrap tabular-nums text-muted-foreground">
              {timeLabel}
            </span>
          </span>
        </button>
      </div>
    </li>
  );
}
