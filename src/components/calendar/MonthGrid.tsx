'use client';

/**
 * The month grid.
 *
 * The day list is the one the server sent: `rangeForView` pads a month out to
 * whole weeks, so this component only *chunks* it into rows (`buildMonthRows`)
 * and never derives its own dates. That is what keeps the grid, the agenda and
 * the day detail sheet from disagreeing about which days a month contains.
 *
 * The grid is deliberately a fixed six-row height that fills the viewport, so a
 * month change never makes the layout jump and a phone in portrait never needs
 * to scroll to find the last week.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { addDaysToDateOnly, fromDateOnly, toDateOnly } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem, DateOnly } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { EventBlock } from './EventBlock';
import { DragGhostLabel } from './DragGhostLabel';
import { MONTH_COLUMNS, MONTH_ROWS, buildMonthRows, weekdayLabels, type DayAxis } from './geometry';
import { useItemDrag } from './use-item-drag';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, ItemOpenHandler, RescheduleHandler } from './types';

export interface MonthGridProps {
  /** The server's padded day list for the visible month window. */
  days: DateOnly[];
  /** A day inside the month being displayed. */
  anchor: DateOnly;
  /** The selected day: the roving keyboard focus and the "+" target. */
  selectedDate: DateOnly;
  today: DateOnly;
  payload: CalendarItemsPayload;
  prefs: CalendarPrefs;
  /** Lookup used to honour each calendar's colour override. */
  calendars: CalendarLookup;
  interaction: CalendarInteraction;
  /** Opens the day detail sheet for a day. */
  onOpenDay: (date: DateOnly) => void;
  onOpenItem: ItemOpenHandler;
  onReschedule: RescheduleHandler;
}

/** Bars shown per cell before the "+N more" row appears. */
const MAX_BARS = 3;

export function MonthGrid({
  days,
  anchor,
  selectedDate,
  today,
  payload,
  prefs,
  calendars,
  interaction,
  onOpenDay,
  onOpenItem,
  onReschedule,
}: MonthGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef(new Map<DateOnly, HTMLButtonElement>());
  const [focusDate, setFocusDate] = useState(selectedDate);
  const pendingFocus = useRef(false);

  const rows = useMemo(() => buildMonthRows(days, anchor), [days, anchor]);
  const headers = useMemo(() => weekdayLabels(prefs.weekStartsOn), [prefs.weekStartsOn]);

  // The roving focus follows the selection whenever it is changed from outside.
  useEffect(() => setFocusDate(selectedDate), [selectedDate]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    dayRefs.current.get(focusDate)?.focus();
    pendingFocus.current = false;
  }, [focusDate]);

  const drag = useItemDrag({
    hourHeight: 0,
    gridRef,
    interaction,
    axis: (init): DayAxis | null => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        columns: MONTH_COLUMNS,
        index: init.cellIndex,
        count: days.length,
        cellWidth: rect.width / MONTH_COLUMNS,
        rowHeight: rect.height / Math.max(rows.length, 1),
      };
    },
    formatLabel: (item, target) =>
      fromDateOnly(addDaysToDateOnly(toDateOnly(item.startMs, prefs.zone), target.dayDelta, prefs.zone), prefs.zone).toFormat(
        'ccc d LLL',
      ),
    onDrop: onReschedule,
  });

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // An event block is its own control: Enter there opens the item, not the day.
    if ((event.target as HTMLElement).dataset.itemBlock) return;

    const index = days.indexOf(focusDate);
    const weekStart = index - (index % MONTH_COLUMNS);
    let next: number;

    switch (event.key) {
      case 'ArrowLeft':
        next = index - 1;
        break;
      case 'ArrowRight':
        next = index + 1;
        break;
      case 'ArrowUp':
        next = index - MONTH_COLUMNS;
        break;
      case 'ArrowDown':
        next = index + MONTH_COLUMNS;
        break;
      case 'Home':
        next = weekStart;
        break;
      case 'End':
        next = weekStart + MONTH_COLUMNS - 1;
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        onOpenDay(focusDate);
        return;
      default:
        return;
    }

    event.preventDefault();
    if (next < 0 || next >= days.length || next === index) return;
    pendingFocus.current = true;
    setFocusDate(days[next]);
  }

  return (
    <div className="flex h-[calc(100dvh-var(--header-total)-var(--tabbar-total))] flex-col lg:h-[calc(100dvh-var(--header-total))]">
      <div
        aria-hidden
        className="material sticky z-30 grid shrink-0 grid-cols-7 border-b border-separator"
        style={{ top: 'var(--header-total)' }}
      >
        {headers.map((label, index) => (
          <span key={`${label}-${index}`} className="py-1 text-center text-caption-1 font-medium text-secondary">
            {label}
          </span>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label="Month"
        onKeyDown={onKeyDown}
        className="grid min-h-0 flex-1 select-none"
        style={{ gridTemplateColumns: `repeat(${MONTH_COLUMNS}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${MONTH_ROWS}, minmax(0, 1fr))` }}
      >
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} role="row" className="contents">
            {row.map((cell, columnIndex) => {
              const dayItems = payload.days[cell.date] ?? [];
              const bars = dayItems.slice(0, MAX_BARS);
              const hidden = dayItems.length - bars.length;
              const isToday = cell.date === today;
              const isSelected = cell.date === selectedDate;
              const cellIndex = rowIndex * MONTH_COLUMNS + columnIndex;

              return (
                <div
                  key={cell.date}
                  role="gridcell"
                  aria-selected={isSelected}
                  className={cn(
                    'min-h-0 overflow-hidden border-r border-b border-separator px-1 pt-0.5 pb-1',
                    !cell.inMonth && 'bg-bg',
                    isSelected && 'bg-tint-soft',
                  )}
                  onClick={() => onOpenDay(cell.date)}
                >
                  <button
                    ref={(node) => {
                      if (node) dayRefs.current.set(cell.date, node);
                      else dayRefs.current.delete(cell.date);
                    }}
                    type="button"
                    tabIndex={focusDate === cell.date ? 0 : -1}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={fromDateOnly(cell.date, prefs.zone).toFormat('cccc d LLLL yyyy')}
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDay(cell.date);
                    }}
                    className="mx-auto flex min-h-6 w-full items-center justify-center"
                  >
                    <span
                      className={cn(
                        'tnum flex size-6 items-center justify-center rounded-full text-footnote',
                        isToday ? 'bg-tint font-semibold text-tint-contrast' : cell.inMonth ? 'text-label' : 'text-tertiary',
                      )}
                    >
                      {Number(cell.date.slice(8, 10))}
                    </span>
                  </button>

                  <ul className="mt-0.5 space-y-0.5">
                    {bars.map((item: CalendarItem) => (
                      <li key={item.key}>
                        <EventBlock
                          item={item}
                          prefs={prefs}
                          calendars={calendars}
                          variant="bar"
                          onOpen={onOpenItem}
                          onPointerDown={(target, event: ReactPointerEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            drag.begin(target, event, { startMinute: 0, durationMinutes: 0, cellIndex });
                          }}
                          drag={drag.ghost?.item.key === item.key ? drag.ghost : null}
                        />
                      </li>
                    ))}
                  </ul>

                  {hidden > 0 ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenDay(cell.date);
                      }}
                      className="mt-0.5 min-h-5 w-full truncate text-left text-caption-2 text-secondary pressable"
                    >
                      +{hidden} more
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </div>
  );
}
