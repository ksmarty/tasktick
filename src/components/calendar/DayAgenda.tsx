'use client';

/**
 * The agenda for one day — the bottom region of the calendar screen.
 *
 * It renders exactly the bucket the server sent for the selected date
 * (`payload.days[date]`), already ordered all-day-first. No filtering, no
 * sorting and no recurrence work happens here: the day's contents are whatever
 * the single `/api/calendar/items` response said they were.
 *
 * A row is `[time gutter] │ [card]`. The gutter is a fixed column, right-aligned
 * against a hairline rule, so the times form a clean edge down the left of the
 * list; an all-day item reads "all-day" in that same column rather than being
 * indented somewhere else. The card then leads with the time range in the
 * calendar's accent colour and the title beneath it — the reading order the
 * reference uses, and the reason the range is set in `caption-1` and the title
 * in `subhead`: the eye lands on the time first and the name second.
 *
 * Colour is never the only signal. A task is drawn with a checkbox glyph and a
 * softer leading edge than an event's solid one, so "a to-do I scheduled" is
 * never mistaken for "a meeting I was invited to".
 *
 * The whole row is one focusable button whose accessible name carries the time,
 * the title and the item's kind, because the visual layout (a gutter, a rule and
 * a two-line card) does not survive as a linear reading order on its own.
 *
 * Dragging a row horizontally moves the item by whole days. It goes through the
 * same `useItemDrag` hook as before, so the lift threshold, the click-swallow
 * and the Escape-to-cancel behaviour are identical everywhere in the calendar.
 *
 * The pane adds no bottom padding of its own. The shell's `main` already
 * reserves the tab band (`pb-tabbar`), and the floating action button now shares
 * that one row with the tab bar instead of floating above it — so reserving the
 * button's band again inside this pane was double padding, which is what left a
 * dead gap under the last row.
 *
 * There is no "New event" affordance here at all: creating an event is the
 * shell's action button (which the calendar screen answers through
 * `usePrimaryAction`), or the day detail sheet. A create button inside the
 * agenda was a third way in for a job that already had two, and it sat under the
 * last row where it read as part of the day's contents.
 *
 * The agenda also carries no header. The selected day used to be repeated here
 * ("Thursday 17 September, 2 items") directly under a grid that already shows
 * which day is selected; the screen-reader announcement of the selected day
 * lives in `CalendarToolbar`, where it belongs.
 */
import { useRef } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays } from 'lucide-react';
import { accentSoft, accentVar } from '@/lib/colors';
import { addDaysToDateOnly, formatTime, fromDateOnly, toDateOnly } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem } from '@/lib/types';
import { EmptyState } from '@/components/ui';
import { itemColor } from './colors';
import { DragGhostLabel } from './DragGhostLabel';
import { minuteOfDay } from './geometry';
import { useItemDrag } from './use-item-drag';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, ItemOpenHandler, RescheduleHandler } from './types';

/**
 * Columns the horizontal drag lattice pretends to have.
 *
 * The agenda is a list, not a grid, so there is no column to measure against.
 * Seven imaginary columns spanning the row width makes a ~55px drag equal one
 * day, and the index sits in the middle so the item can move either way.
 */
const DRAG_COLUMNS = 7;

/**
 * Alpha of a task's leading edge.
 *
 * Events get the calendar colour at full strength; tasks get the same hue as a
 * tint, which together with the checkbox glyph is what keeps the two kinds apart
 * at a glance.
 */
const TASK_EDGE_ALPHA = 0.5;

export interface DayAgendaProps {
  /** `payload.days[date] ?? []`, straight from the server. */
  items: CalendarItem[];
  prefs: CalendarPrefs;
  calendars: CalendarLookup;
  interaction: CalendarInteraction;
  onOpenItem: ItemOpenHandler;
  onReschedule: RescheduleHandler;
}

export function DayAgenda({
  items,
  prefs,
  calendars,
  interaction,
  onOpenItem,
  onReschedule,
}: DayAgendaProps) {
  const listRef = useRef<HTMLUListElement>(null);

  const drag = useItemDrag({
    hourHeight: 0,
    gridRef: listRef,
    interaction,
    axis: (init) => {
      const rect = listRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        columns: DRAG_COLUMNS,
        index: init.cellIndex,
        count: DRAG_COLUMNS,
        cellWidth: rect.width / DRAG_COLUMNS,
        rowHeight: 0,
      };
    },
    formatLabel: (item, target) =>
      fromDateOnly(addDaysToDateOnly(toDateOnly(item.startMs, prefs.zone), target.dayDelta, prefs.zone), prefs.zone).toFormat(
        'ccc d LLL',
      ),
    onDrop: onReschedule,
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        No reserved band at the bottom: the shell's `main` already pads for the
        tab bar and the action button lives in that same row, so an extra
        `pb-20` here was pure double padding.
      */}
      {/*
        `touch-pan-y` belongs on the scroller, not on the section around it:
        touch-action is resolved up to the nearest scrolling element, so a value
        on an ancestor of this `ul` is ignored. Without it the browser claims a
        horizontal touch as a pan and cancels the pointer series, which killed
        the day-swipe; with it, vertical scrolls still pass through to the list
        and the horizontal drag stays ours.
      */}
      <ul ref={listRef} className="scroll-pane touch-pan-y min-h-0 flex-1 space-y-1.5 px-3 pb-2 lg:pb-4">
        {items.map((item) => {
          const color = itemColor(item, calendars);
          const isTask = item.kind === 'task';
          const done = Boolean(item.completed);
          // The gutter carries the start of the row; the card carries the range.
          const gutterLabel = item.isAllDay ? 'all-day' : formatTime(item.startMs, prefs);
          const rangeLabel = item.isAllDay
            ? // The gutter column already says "all-day". Repeating it on the card
              // is the kind of duplication that makes a dense list feel noisy, so
              // the card carries only the title for an all-day row.
              null
            : `${formatTime(item.startMs, prefs)} – ${formatTime(item.endMs, prefs)}`;
          const accessibleName = [
            item.isAllDay ? 'All-day' : `${formatTime(item.startMs, prefs)} to ${formatTime(item.endMs, prefs)}`,
            item.title,
            isTask ? 'task' : 'event',
            done ? 'completed' : null,
            item.location ? `at ${item.location}` : null,
          ]
            .filter(Boolean)
            .join(', ');
          const dragging = drag.ghost?.item.key === item.key;

          return (
            <li key={item.key}>
              <button
                type="button"
                aria-label={accessibleName}
                data-item-block="true"
                onClick={() => onOpenItem(item)}
                onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) =>
                  drag.begin(item, event, {
                    startMinute: item.isAllDay ? 0 : minuteOfDay(item.startMs, prefs.zone),
                    durationMinutes: 0,
                    cellIndex: Math.floor(DRAG_COLUMNS / 2),
                  })
                }
                className={cn(
                  'flex w-full items-stretch gap-2 text-left pressable-row',
                  done && 'opacity-60',
                  dragging && 'relative z-40',
                )}
                style={dragging ? { transform: `translate3d(${drag.ghost?.offsetX ?? 0}px, 0, 0)` } : undefined}
              >
                <span className="tnum w-14 shrink-0 pt-1.5 text-right text-caption-1 text-secondary">
                  {gutterLabel}
                </span>

                {/* The hairline the times are aligned against. */}
                <span aria-hidden className="w-px shrink-0 self-stretch bg-separator" />

                <span
                  className="card-edge flex min-w-0 flex-1 flex-col justify-center py-1.5 pr-2.5 pl-3"
                  style={{ '--edge-color': isTask ? accentSoft(color, TASK_EDGE_ALPHA) : accentVar(color) } as CSSProperties}
                >
                  {/* An all-day row has no range to show; the gutter says it. */}
                  {rangeLabel ? (
                    <span className="block truncate text-caption-1 font-semibold" style={{ color: accentVar(color) }}>
                      {rangeLabel}
                    </span>
                  ) : null}
                  <span className={cn('mt-0.5 block truncate text-subhead text-label', done && 'line-through')}>
                    {isTask ? (
                      <span aria-hidden className="mr-1">
                        {done ? '☑' : '☐'}
                      </span>
                    ) : null}
                    {item.title}
                  </span>
                  {item.location ? (
                    <span className="mt-0.5 block truncate text-caption-2 text-secondary">{item.location}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}

        {items.length === 0 ? (
          <li>
            <EmptyState
              icon={CalendarDays}
              title="Nothing scheduled"
              description="This day is clear. Add an event, or drag one here from another day."
            />
          </li>
        ) : null}
      </ul>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </div>
  );
}
