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
 * press-highlight region, the rounded first/last corner) and adds the per-row
 * colour strip the tasks have, in the event's calendar colour.
 *
 * ## The title is one line
 *
 * Both rows keep the title to one ellipsised line. The task title used to wrap,
 * on the argument that a task list is where you read what the task is; that is
 * overruled (see `TaskRow`), so the two rows now agree on typography rather than
 * diverging here.
 */
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { accentHex } from '@/lib/colors';
import { formatTime } from '@/lib/dates';
import type { CalendarItem } from '@/lib/types';
import { cn } from '@/lib/utils';

export interface EventRowProps {
  event: CalendarItem;
  zone: string;
  timeFormat: '12h' | '24h';
  /** Opens the event's detail sheet. */
  onOpen?: (event: CalendarItem) => void;
  /** Rounds the top corner of the first row of a card. */
  first?: boolean;
  /** Rounds the bottom corner of the last row of a card. */
  last?: boolean;
  className?: string;
}

export function EventRow({
  event,
  zone,
  timeFormat,
  onOpen,
  first = false,
  last = false,
  className,
}: EventRowProps) {
  const timeLabel = event.isAllDay
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
        'relative isolate overflow-hidden',
        first && 'rounded-t-xl',
        last && 'rounded-b-xl',
        className,
      )}
    >
      <div className="relative z-10 flex min-h-11 w-full items-center gap-1 px-row">
        {/* The per-row colour strip: the event's calendar colour. */}
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: accentHex(event.color) }}
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
          className="group/row-content relative flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
