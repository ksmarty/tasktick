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
 * reference uses, and the reason the range is set apart from the title: the eye
 * lands on the time first and the name second.
 *
 * Colour is never the only signal. A task is drawn with a checkbox glyph and a
 * softer card surface than an event's, so "a to-do I scheduled" is never
 * mistaken for "a meeting I was invited to".
 *
 * The whole row is one real `button` whose accessible name carries the time, the
 * title and the item's kind, because the visual layout (a gutter, a rule and a
 * two-line card) does not survive as a linear reading order on its own.
 *
 * ## The stripe
 *
 * The per-calendar stripe is `border-l-4` in a `--edge-color` custom property
 * written inline — the colour is a runtime accent lookup, so it is the one thing
 * here that genuinely cannot be a class. Four pixels rather than the old three
 * because three is not on Tailwind's scale. It stays a border rather than an
 * inset shadow so it follows the card's own corner, and the accent is reused for
 * the range line so stripe and time agree.
 *
 * Dragging a row horizontally moves the item by whole days. It goes through the
 * same `useItemDrag` hook as before, so the lift threshold, the click-swallow
 * and the Escape-to-cancel behaviour are identical everywhere in the calendar.
 * The drag measures `listRef`, so that ref stays on the scrolling `<ul>` node.
 *
 * The pane adds no bottom padding of its own. The shell's `main` already
 * reserves the tab band, and the floating action button shares that one row with
 * the tab bar instead of floating above it — so reserving the button's band
 * again inside this pane was double padding, which is what left a dead gap under
 * the last row.
 *
 * There is no "New event" affordance here at all: creating an event is the
 * shell's action button (which the calendar screen answers through
 * `usePrimaryAction`), or the day detail sheet. A create button inside the
 * agenda was a third way in for a job that already had two, and it sat under the
 * last row where it read as part of the day's contents.
 *
 * The agenda also carries no header. The selected day used to be repeated here
 * directly under a grid that already shows which day is selected; the
 * screen-reader announcement of the selected day lives in `CalendarToolbar`,
 * where it belongs.
 */
import { useRef, type CSSProperties } from 'react';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckboxIcon } from '@svg-animated-icons/react/checkbox';
import { useAppearance } from '@/app/providers';
import { Separator } from '@/components/ui/separator';
import { accentHex } from '@/lib/colors';
import { addDaysToDateOnly, formatTime, fromDateOnly, toDateOnly } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { CalendarItem } from '@/lib/types';
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

/** The gutter column's width; the times are right-aligned inside it. */
const GUTTER_WIDTH_CLASS = 'w-14';

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
  /** The resolved appearance, so an accent token maps to the right hex. */
  const dark = useAppearance().resolvedTheme === 'dark';

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
      <ul
        ref={listRef}
        /*
         * `touch-pan-y` belongs on the scroller, not on the section around it:
         * touch-action is resolved up to the nearest scrolling element, so a
         * value on an ancestor of this `ul` is ignored. Without it the browser
         * claims a horizontal touch as a pan and cancels the pointer series,
         * which killed the day-swipe; with it, vertical scrolls still pass
         * through to the list and the horizontal drag stays ours.
         *
         * The scrollbar is hidden because the list is a thin column on a phone
         * and a persistent bar in it reads as a layout defect, not as a
         * scrollbar.
         */
        className="flex min-h-0 flex-1 flex-col gap-stack touch-pan-y overflow-y-auto overscroll-contain px-gutter pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map((item) => {
          const color = itemColor(item, calendars);
          const hex = accentHex(color, dark);
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
                data-item-block="true"
                aria-label={accessibleName}
                onClick={() => onOpenItem(item)}
                onPointerDown={(event) =>
                  drag.begin(item, event, {
                    startMinute: item.isAllDay ? 0 : minuteOfDay(item.startMs, prefs.zone),
                    durationMinutes: 0,
                    cellIndex: Math.floor(DRAG_COLUMNS / 2),
                  })
                }
                className={cn(
                  'flex w-full cursor-pointer items-stretch gap-3 text-left',
                  // Tasks read softer than events — together with the checkbox
                  // glyph it is what keeps the two kinds apart at a glance.
                  done && 'opacity-60',
                  dragging && 'relative z-40',
                )}
                style={dragging ? { transform: `translate3d(${drag.ghost?.offsetX ?? 0}px, 0, 0)` } : undefined}
              >
                <span
                  className={cn(
                    GUTTER_WIDTH_CLASS,
                    'shrink-0 pt-2 text-right text-xs text-muted-foreground tabular-nums',
                  )}
                >
                  {gutterLabel}
                </span>

                {/* The hairline the times are aligned against. */}
                <Separator orientation="vertical" />

                <span
                  className="flex min-w-0 flex-1 flex-col justify-center rounded-lg border-l-4 border-l-[var(--edge-color)] bg-accent px-row py-2"
                  style={{ '--edge-color': hex } as CSSProperties}
                >
                  {/* An all-day row has no range to show; the gutter says it. */}
                  {rangeLabel ? (
                    <span className="block truncate text-xs font-semibold" style={{ color: hex }}>
                      {rangeLabel}
                    </span>
                  ) : null}

                  <span
                    className={cn(
                      /*
                       * No `truncate`: an event title is the content of the
                       * agenda, and ellipsising it hides the one word that tells
                       * two similar entries apart. It wraps instead.
                       */
                      'mt-0.5 block text-sm text-foreground',
                      done && 'line-through',
                    )}
                  >
                    {isTask ? (
                      <span
                        aria-hidden
                        className={cn('mr-1 inline-flex align-[-0.15em]', done ? 'text-primary' : 'text-muted-foreground')}
                      >
                        <CheckboxIcon className="size-3.5 text-sm" disableHover />
                      </span>
                    ) : null}
                    {item.title}
                  </span>

                  {item.location ? (
                    <span className="mt-0.5 block truncate text-xs text-muted-foreground">{item.location}</span>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}

        {items.length === 0 ? (
          <li className="flex flex-col items-center gap-2 px-gutter py-8 text-center">
            <CalendarIcon aria-hidden className="size-8 text-3xl text-muted-foreground" disableHover />
            <p className="text-sm font-semibold text-foreground">Nothing scheduled</p>
            <p className="text-sm text-muted-foreground">
              This day is clear. Add an event, or drag one here from another day.
            </p>
          </li>
        ) : null}
      </ul>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </div>
  );
}
