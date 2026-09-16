'use client';

/**
 * The agenda for one day — the bottom region of the calendar screen.
 *
 * It renders exactly the bucket the server sent for the selected date
 * (`payload.days[date]`), already ordered all-day-first. No filtering, no
 * sorting and no recurrence work happens here: the day's contents are whatever
 * the single `/api/calendar/items` response said they were.
 *
 * A row is one focusable button whose accessible name carries the time and the
 * title, because the visual layout (a time gutter, a colour bar and the text)
 * does not survive as a linear reading order on its own. Tasks are drawn with a
 * checkbox glyph and a dashed edge, so "a to-do I scheduled" is never confused
 * with "a meeting I was invited to" — colour is not the only signal.
 *
 * Dragging a row horizontally moves the item by whole days. It goes through the
 * same `useItemDrag` hook as the month grid, so the lift threshold, the
 * click-swallow and the Escape-to-cancel behaviour are identical in both places.
 */
import { useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { CalendarDays, Plus, SlidersHorizontal } from 'lucide-react';
import { accentHex } from '@/lib/colors';
import { addDaysToDateOnly, formatTime, fromDateOnly, toDateOnly } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem, DateOnly } from '@/lib/types';
import { Button, EmptyState, IconButton } from '@/components/ui';
import { itemColor } from './colors';
import { DEFAULT_EVENT_START_MINUTE } from './DayDetailSheet';
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

export interface DayAgendaProps {
  date: DateOnly;
  today: DateOnly;
  /** `payload.days[date] ?? []`, straight from the server. */
  items: CalendarItem[];
  prefs: CalendarPrefs;
  calendars: CalendarLookup;
  interaction: CalendarInteraction;
  onOpenItem: ItemOpenHandler;
  onReschedule: RescheduleHandler;
  /** Opens the editor on the selected day at the given minute. */
  onCreateAt: (date: DateOnly, startMinute: number) => void;
  /** Opens the calendars sheet (visibility toggles + "only this calendar"). */
  onOpenCalendars: () => void;
}

export function DayAgenda({
  date,
  today,
  items,
  prefs,
  calendars,
  interaction,
  onOpenItem,
  onReschedule,
  onCreateAt,
  onOpenCalendars,
}: DayAgendaProps) {
  const listRef = useRef<HTMLUListElement>(null);
  const dayLabel = fromDateOnly(date, prefs.zone).toFormat('cccc d LLLL');

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
      <header className="flex shrink-0 items-center gap-2 px-4 pt-1.5 pb-2">
        <h2 className={cn('min-w-0 truncate text-subhead font-semibold', date === today ? 'text-tint' : 'text-label')}>
          {dayLabel}
        </h2>
        <span className="tnum shrink-0 text-footnote text-secondary">
          {items.length === 0 ? null : items.length === 1 ? '1 item' : `${items.length} items`}
        </span>
        <IconButton
          aria-label="Calendars"
          icon={SlidersHorizontal}
          size="sm"
          className="ml-auto"
          onClick={onOpenCalendars}
        />
      </header>

      <ul ref={listRef} className="scroll-pane min-h-0 flex-1 space-y-1.5 px-3 pb-4">
        {items.map((item) => {
          const hex = accentHex(itemColor(item, calendars));
          const isTask = item.kind === 'task';
          const done = Boolean(item.completed);
          const timeLabel = item.isAllDay ? 'All-day' : formatTime(item.startMs, prefs);
          const accessibleName = [
            item.isAllDay ? 'All-day' : `${formatTime(item.startMs, prefs)} to ${formatTime(item.endMs, prefs)}`,
            item.title,
            isTask ? 'task' : 'event',
            done ? 'completed' : null,
            item.location ? `at ${item.location}` : null,
          ]
            .filter(Boolean)
            .join(', ');

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
                  'glass-card flex w-full items-stretch gap-2 rounded-ios-md px-2.5 py-2 text-left pressable-row',
                  done && 'opacity-60',
                  drag.ghost?.item.key === item.key && 'relative z-40 shadow-ios-lg opacity-90',
                )}
                style={
                  drag.ghost?.item.key === item.key
                    ? { transform: `translate3d(${drag.ghost.offsetX}px, 0, 0)` }
                    : undefined
                }
              >
                <span className="tnum w-14 shrink-0 pt-0.5 text-right text-caption-1 text-secondary">{timeLabel}</span>
                <span
                  aria-hidden
                  className={cn('w-1 shrink-0 rounded-full', isTask && 'border border-dashed')}
                  style={isTask ? { borderColor: hex } : { backgroundColor: hex }}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-subhead text-label', done && 'text-secondary line-through')}>
                    {isTask ? (
                      <span aria-hidden className="mr-1">
                        {done ? '☑' : '☐'}
                      </span>
                    ) : null}
                    {item.title}
                  </span>
                  {item.location ? (
                    <span className="mt-0.5 block truncate text-caption-1 text-secondary">{item.location}</span>
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
              action={
                <Button
                  variant="tinted"
                  icon={Plus}
                  onClick={() => onCreateAt(date, DEFAULT_EVENT_START_MINUTE)}
                >
                  New event
                </Button>
              }
            />
          </li>
        ) : (
          <li>
            <button
              type="button"
              onClick={() => onCreateAt(date, DEFAULT_EVENT_START_MINUTE)}
              className="flex min-h-11 w-full items-center justify-center gap-2 rounded-ios-md border border-dashed border-separator px-3 text-subhead text-tint pressable"
            >
              <Plus className="size-4" aria-hidden />
              New event
            </button>
          </li>
        )}
      </ul>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </div>
  );
}
