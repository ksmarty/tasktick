'use client';

/**
 * The month grid — the top region of the calendar screen.
 *
 * It renders the server's padded day list for the visible month, chunked into
 * whole weeks by `buildMonthRows`; it never derives a date of its own, so the
 * grid, the agenda and the day sheet can never disagree about which days a month
 * contains. Recurrence expansion, EXDATE handling and timed-overlap columns are
 * all absent here because the API already did them.
 *
 * Two things make the compact TickTick cell work:
 *
 *   · The number of event bars a cell can hold is *measured*, not guessed. The
 *     cell height is read with a `ResizeObserver` and turned into a bar budget,
 *     so a phone (a short cell) shows one bar plus "+N" while a desktop column
 *     shows five, with no overflow and no overlap either way.
 *   · When the budget is exceeded, one slot is reserved for a "+N" button rather
 *     than letting the last bar be clipped — a count the user cannot see is
 *     worse than a bar they cannot see.
 *
 * `weeks` is 6 for the full month and 1 for the collapsed week strip. The strip
 * follows the selection, which is what makes it a useful "where am I" ruler
 * while the agenda takes the rest of the screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { addDaysToDateOnly, fromDateOnly, toDateOnly } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem, DateOnly } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { DragGhostLabel } from './DragGhostLabel';
import { EventBlock } from './EventBlock';
import { MONTH_COLUMNS, MONTH_ROWS, buildMonthRows, clamp, minuteOfDay, weekdayLabels } from './geometry';
import { useItemDrag } from './use-item-drag';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, ItemOpenHandler, RescheduleHandler } from './types';

/** Height of the day-number row inside a cell, in px. */
const DAY_ROW_PX = 26;
/** Bar height in a phone-sized cell, and in a roomy desktop one. */
const COMPACT_BAR_PX = 14;
const ROOMY_BAR_PX = 20;
/** A cell at least this tall gets the roomier bar. */
const ROOMY_CELL_PX = 90;
/** Gap between two stacked bars. */
const BAR_GAP_PX = 2;
/** Bars assumed before the first measurement, so the first paint is not empty. */
const FALLBACK_BARS = 2;

export interface MonthGridProps {
  /** The server's padded day list for the visible month window. */
  days: DateOnly[];
  /** A day inside the month being displayed. */
  anchor: DateOnly;
  /** The selected day: the agenda's day and the roving keyboard focus. */
  selectedDate: DateOnly;
  today: DateOnly;
  /** 6 for the whole month, 1 for the collapsed week strip. */
  weeks: number;
  payload: CalendarItemsPayload;
  prefs: CalendarPrefs;
  /** Lookup used to honour each calendar's colour override. */
  calendars: CalendarLookup;
  interaction: CalendarInteraction;
  /** Selects a day (updates the agenda) without navigating. */
  onSelectDate: (date: DateOnly) => void;
  /** Opens the day detail sheet. */
  onOpenDay: (date: DateOnly) => void;
  onOpenItem: ItemOpenHandler;
  onReschedule: RescheduleHandler;
}

export function MonthGrid({
  days,
  anchor,
  selectedDate,
  today,
  weeks,
  payload,
  prefs,
  calendars,
  interaction,
  onSelectDate,
  onOpenDay,
  onOpenItem,
  onReschedule,
}: MonthGridProps) {
  const gridRef = useRef<HTMLDivElement>(null);
  const dayRefs = useRef(new Map<DateOnly, HTMLButtonElement>());
  const [focusDate, setFocusDate] = useState(selectedDate);
  const pendingFocus = useRef(false);
  const [cellHeight, setCellHeight] = useState(0);

  const collapsed = weeks < MONTH_ROWS;
  const roomy = cellHeight >= ROOMY_CELL_PX;
  const barHeight = roomy ? ROOMY_BAR_PX : COMPACT_BAR_PX;
  // The pill's own classes follow the same measurement that sizes the budget, so
  // the two can never disagree and clip a row the count promised was visible.
  const barClasses = roomy ? 'h-5 text-caption-1 leading-5' : 'h-3.5 text-caption-2 leading-[14px]';
  // The "+N" shares the pill's slot but not its type size: at 11px a bold accent
  // is still small, and this is the one control that says "there is more here".
  const moreClasses = roomy ? 'h-5 leading-5' : 'h-3.5 leading-[14px]';
  const allRows = useMemo(() => buildMonthRows(days, anchor), [days, anchor]);
  const rows = useMemo(() => {
    if (!collapsed) return allRows;
    const index = allRows.findIndex((row) => row.some((cell) => cell.date === selectedDate));
    return [allRows[index >= 0 ? index : 0] ?? allRows[0] ?? []];
  }, [allRows, collapsed, selectedDate]);

  /** Only the days actually on screen — the lattice a drag or an arrow key moves across. */
  const visibleDays = useMemo(() => rows.flat().map((cell) => cell.date), [rows]);
  const headers = useMemo(() => weekdayLabels(prefs.weekStartsOn), [prefs.weekStartsOn]);

  // Measure the cell so the bar budget matches the space actually available.
  useEffect(() => {
    const node = gridRef.current;
    if (!node) return;
    const measure = () => setCellHeight(node.clientHeight / Math.max(rows.length, 1));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [rows.length]);

  const capacity =
    cellHeight > 0
      ? clamp(Math.floor((cellHeight - DAY_ROW_PX - BAR_GAP_PX) / (barHeight + BAR_GAP_PX)), 1, 8)
      : FALLBACK_BARS;

  // The roving focus follows the selection whenever it is changed from outside.
  useEffect(() => setFocusDate(selectedDate), [selectedDate]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    dayRefs.current.get(focusDate)?.focus();
  }, [focusDate]);

  const drag = useItemDrag({
    hourHeight: 0,
    gridRef,
    interaction,
    axis: (init) => {
      const rect = gridRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return {
        columns: MONTH_COLUMNS,
        index: init.cellIndex,
        count: visibleDays.length,
        cellWidth: rect.width / MONTH_COLUMNS,
        // A one-row strip has no week to move down into, so vertical movement is off.
        rowHeight: collapsed ? 0 : rect.height / Math.max(rows.length, 1),
      };
    },
    formatLabel: (item, target) =>
      fromDateOnly(addDaysToDateOnly(toDateOnly(item.startMs, prefs.zone), target.dayDelta, prefs.zone), prefs.zone).toFormat(
        'ccc d LLL',
      ),
    onDrop: onReschedule,
  });

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    // An event bar is its own control: Enter there opens the item, not the day.
    if ((event.target as HTMLElement).dataset.itemBlock) return;

    const index = visibleDays.indexOf(focusDate);
    if (index < 0) return;
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
    if (next < 0 || next >= visibleDays.length || next === index) return;
    const date = visibleDays[next];
    pendingFocus.current = true;
    setFocusDate(date);
    onSelectDate(date);
  }

  return (
    <div className={cn('flex min-h-0 flex-col', !collapsed && 'flex-1')}>
      <div aria-hidden className="grid shrink-0 grid-cols-7 border-b border-separator">
        {headers.map((label, index) => (
          <span key={`${label}-${index}`} className="py-0.5 text-center text-caption-2 font-medium text-secondary">
            {label}
          </span>
        ))}
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={collapsed ? 'Week' : 'Month'}
        onKeyDown={onKeyDown}
        className={cn('grid select-none', collapsed ? 'h-16 shrink-0' : 'min-h-0 flex-1')}
        style={{
          gridTemplateColumns: `repeat(${MONTH_COLUMNS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} role="row" className="contents">
            {row.map((cell, columnIndex) => {
              const dayItems = payload.days[cell.date] ?? [];
              const overflowing = dayItems.length > capacity;
              // One slot is kept back for "+N" whenever something would be hidden.
              const shownCount = overflowing ? Math.max(1, capacity - 1) : dayItems.length;
              const bars = dayItems.slice(0, shownCount);
              const hidden = dayItems.length - bars.length;
              const isToday = cell.date === today;
              const isSelected = cell.date === selectedDate;
              const cellIndex = rowIndex * MONTH_COLUMNS + columnIndex;
              const fullLabel = fromDateOnly(cell.date, prefs.zone).toFormat('cccc d LLLL yyyy');

              return (
                <div
                  key={cell.date}
                  role="gridcell"
                  aria-selected={isSelected}
                  className={cn(
                    'min-h-0 overflow-hidden border-b border-separator px-0.5 pt-0.5',
                    columnIndex < MONTH_COLUMNS - 1 && 'border-r',
                    !cell.inMonth && 'bg-bg/70',
                    isSelected && 'bg-tint-soft',
                  )}
                  onClick={() => onSelectDate(cell.date)}
                >
                  <button
                    ref={(node) => {
                      if (node) dayRefs.current.set(cell.date, node);
                      else dayRefs.current.delete(cell.date);
                    }}
                    type="button"
                    tabIndex={focusDate === cell.date ? 0 : -1}
                    aria-current={isToday ? 'date' : undefined}
                    aria-label={
                      dayItems.length > 0
                        ? `${fullLabel}, ${dayItems.length} ${dayItems.length === 1 ? 'item' : 'items'}`
                        : fullLabel
                    }
                    onClick={(event) => {
                      event.stopPropagation();
                      // Tapping the day already selected reveals the whole day.
                      if (isSelected) onOpenDay(cell.date);
                      else onSelectDate(cell.date);
                    }}
                    className="flex h-6 w-full items-center justify-center"
                  >
                    <span
                      className={cn(
                        'tnum flex size-6 items-center justify-center rounded-full text-footnote',
                        isSelected
                          ? 'bg-tint font-semibold text-tint-contrast'
                          : isToday
                            ? 'font-semibold text-tint'
                            : cell.inMonth
                              ? 'text-label'
                              : 'text-tertiary',
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
                          className={barClasses}
                          onOpen={onOpenItem}
                          onPointerDown={(target, event: ReactPointerEvent<HTMLButtonElement>) => {
                            event.stopPropagation();
                            drag.begin(target, event, {
                              // `hourHeight` is 0 for the month, so this value is
                              // carried straight through to the drop: it keeps a
                              // timed item's clock time instead of zeroing it.
                              startMinute: target.isAllDay ? 0 : minuteOfDay(target.startMs, prefs.zone),
                              durationMinutes: 0,
                              cellIndex,
                            });
                          }}
                          drag={drag.ghost?.item.key === item.key ? drag.ghost : null}
                        />
                      </li>
                    ))}
                  </ul>

                  {hidden > 0 && capacity >= 2 ? (
                    <button
                      type="button"
                      aria-label={`${hidden} more on ${fullLabel}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenDay(cell.date);
                      }}
                      className={cn(
                        'mt-0.5 w-full truncate text-left text-caption-1 font-semibold text-tint pressable',
                        moreClasses,
                      )}
                    >
                      +{hidden}
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
