'use client';

/**
 * The month grid — the top region of the calendar screen — and the week strip
 * it collapses into.
 *
 * The cell is deliberately almost empty: the day number and a row of up to three
 * small dots. No titles, no bars, no counts. A phone cell is ~55px wide, so it
 * has room for either a legible day number or four characters of an event title;
 * the previous bar-chart treatment chose the title, which made the grid noisy and
 * buried the date itself. The dots answer the only question the grid is asked —
 * "is anything happening that day?" — and the *what* lives in the agenda below
 * and in the day detail sheet, both one tap away.
 *
 * A dot is still a handle on its item: pressing one opens it and dragging one
 * reschedules it, exactly as the bars did, so nothing the grid could do before
 * is lost. The visual is a dot cluster, never a bar: the item's title is not
 * rendered here at all.
 *
 * The selected day is a filled circle behind its number; today, when it is not
 * selected, is a tinted ring, so the two can never be confused. The days that
 * pad the month out to whole weeks are dimmed.
 *
 * `weeks` is 6 for the month and 1 for the week strip. The strip is not a time
 * grid: it is seven tappable day cells, each carrying its own weekday letter,
 * with the same filled-circle selection and the same dimmed out-of-month
 * treatment as the month — the same visual language as the habits screen, so the
 * two read as siblings. It follows the selection, which is what makes it a
 * useful "where am I" ruler while the agenda takes the rest of the screen.
 *
 * It never derives a date of its own: `days` is the server's padded day list for
 * the visible window, chunked into whole weeks by `buildMonthRows`, so the grid,
 * the agenda and the day sheet cannot disagree about which days a month
 * contains. Recurrence expansion, EXDATE handling and timed-overlap columns are
 * all absent here because the API already did them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { accentVar } from '@/lib/colors';
import { addDaysToDateOnly, formatTime, fromDateOnly, toDateOnly } from '@/lib/dates';
import { cn } from '@/lib/cn';
import type { CalendarItem, DateOnly } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { itemColor } from './colors';
import { DragGhostLabel } from './DragGhostLabel';
import { MONTH_COLUMNS, MONTH_ROWS, buildMonthRows, minuteOfDay, weekdayLabels } from './geometry';
import { useItemDrag } from './use-item-drag';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, ItemOpenHandler, RescheduleHandler } from './types';

/**
 * Dots a cell will show.
 *
 * Beyond three the cluster stops saying "this day is busy" and starts being a
 * bar chart again; the exact count is in the day's accessible name and in the
 * day detail sheet.
 */
const MAX_DOTS = 3;

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
  /** The server's response: `days` is the single source of truth for the dots. */
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

  const collapsed = weeks < MONTH_ROWS;
  const allRows = useMemo(() => buildMonthRows(days, anchor), [days, anchor]);
  const rows = useMemo(() => {
    if (!collapsed) return allRows;
    const index = allRows.findIndex((row) => row.some((cell) => cell.date === selectedDate));
    return [allRows[index >= 0 ? index : 0] ?? allRows[0] ?? []];
  }, [allRows, collapsed, selectedDate]);

  /** Only the days actually on screen — the lattice a drag or an arrow key moves across. */
  const visibleDays = useMemo(() => rows.flat().map((cell) => cell.date), [rows]);
  const headers = useMemo(() => weekdayLabels(prefs.weekStartsOn), [prefs.weekStartsOn]);
  // The strip carries its own weekday letter per column (habits-style), so it
  // does not need the caption row above the month.
  const initials = useMemo(() => weekdayLabels(prefs.weekStartsOn, 'initial'), [prefs.weekStartsOn]);

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
    // A dot is its own control: Enter there opens the item, not the day.
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
      {collapsed ? null : (
        <div aria-hidden className="grid shrink-0 grid-cols-7 border-b border-separator">
          {headers.map((label, index) => (
            <span key={`${label}-${index}`} className="py-0.5 text-center text-caption-2 font-medium text-secondary">
              {label}
            </span>
          ))}
        </div>
      )}

      <div
        ref={gridRef}
        role="grid"
        aria-label={collapsed ? 'Week' : 'Month'}
        onKeyDown={onKeyDown}
        className={cn('grid select-none', collapsed ? 'h-18 shrink-0 gap-1' : 'min-h-0 flex-1')}
        style={{
          gridTemplateColumns: `repeat(${MONTH_COLUMNS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))`,
        }}
      >
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} role="row" className="contents">
            {row.map((cell, columnIndex) => {
              const dayItems = payload.days[cell.date] ?? [];
              const isSelected = cell.date === selectedDate;
              const cellIndex = rowIndex * MONTH_COLUMNS + columnIndex;
              const fullLabel = fromDateOnly(cell.date, prefs.zone).toFormat('cccc d LLLL yyyy');

              return (
                <div
                  key={cell.date}
                  role="gridcell"
                  aria-selected={isSelected}
                  onClick={() => onSelectDate(cell.date)}
                  className={cn(
                    'flex min-h-0 flex-col items-center',
                    collapsed
                      ? 'justify-center gap-1 rounded-ios px-1'
                      : cn(
                          'border-b border-separator',
                          columnIndex < MONTH_COLUMNS - 1 && 'border-r',
                          !cell.inMonth && 'bg-bg/70',
                        ),
                  )}
                >
                  <DayNumber
                    date={cell.date}
                    mode={collapsed ? 'strip' : 'month'}
                    inMonth={cell.inMonth}
                    isSelected={isSelected}
                    isToday={cell.date === today}
                    itemCount={dayItems.length}
                    weekdayInitial={initials[columnIndex]}
                    fullLabel={fullLabel}
                    tabIndex={focusDate === cell.date ? 0 : -1}
                    registerRef={(node) => {
                      if (node) dayRefs.current.set(cell.date, node);
                      else dayRefs.current.delete(cell.date);
                    }}
                    activate={() => {
                      // Tapping the day already selected reveals the whole day.
                      if (isSelected) onOpenDay(cell.date);
                      else onSelectDate(cell.date);
                    }}
                  />

                  {/* Fixed height, so every number sits on the same line. */}
                  <span className={cn('flex h-3.5 shrink-0 items-center justify-center gap-0.5', !collapsed && 'mt-0.5')}>
                    {dayItems.slice(0, MAX_DOTS).map((item) => (
                      <DayDot
                        key={item.key}
                        item={item}
                        prefs={prefs}
                        calendars={calendars}
                        drag={drag.ghost?.item.key === item.key ? drag.ghost : null}
                        onOpen={onOpenItem}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                          drag.begin(item, event, {
                            // `hourHeight` is 0 for the month, so this value is
                            // carried straight through to the drop: it keeps a
                            // timed item's clock time instead of zeroing it.
                            startMinute: item.isAllDay ? 0 : minuteOfDay(item.startMs, prefs.zone),
                            durationMinutes: 0,
                            cellIndex,
                          });
                        }}
                      />
                    ))}
                  </span>
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

interface DayNumberProps {
  date: DateOnly;
  /** `month` is the bordered grid cell; `strip` is the habits-style week cell. */
  mode: 'month' | 'strip';
  inMonth: boolean;
  isSelected: boolean;
  isToday: boolean;
  /** How many items the server bucketed on this day; 0 means no dots. */
  itemCount: number;
  weekdayInitial: string;
  /** The full accessible date name the button announces. */
  fullLabel: string;
  tabIndex: number;
  registerRef: (node: HTMLButtonElement | null) => void;
  activate: () => void;
}

/**
 * The day number (plus its weekday letter in the strip) as one button.
 *
 * The item count is in the accessible name rather than on screen — a "3" in a
 * 55px cell is exactly the noise the dots replaced — so a screen reader still
 * hears everything the day holds.
 */
function DayNumber({
  date,
  mode,
  inMonth,
  isSelected,
  isToday,
  itemCount,
  weekdayInitial,
  fullLabel,
  tabIndex,
  registerRef,
  activate,
}: DayNumberProps) {
  const strip = mode === 'strip';

  return (
    <button
      ref={registerRef}
      type="button"
      tabIndex={tabIndex}
      aria-current={isToday ? 'date' : undefined}
      aria-label={itemCount > 0 ? `${fullLabel}, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : fullLabel}
      onClick={(event) => {
        event.stopPropagation();
        activate();
      }}
      className={cn('flex w-full flex-col items-center gap-1', strip ? '' : 'pt-1')}
    >
      {strip ? (
        <span aria-hidden className={cn('text-caption-2 leading-none', inMonth ? 'text-secondary' : 'text-tertiary')}>
          {weekdayInitial}
        </span>
      ) : null}

      <span
        className={cn(
          'tnum flex shrink-0 items-center justify-center rounded-full leading-none',
          // The strip's circle is the habits screen's (`size-8`, `subhead`), the
          // month's is a step down so six rows still fit a phone.
          strip ? 'size-8 text-subhead' : 'size-6 text-footnote',
          isSelected
            ? 'bg-tint font-semibold text-tint-contrast'
            : isToday
              ? 'font-semibold text-tint ring-1 ring-tint'
              : inMonth
                ? 'text-label'
                : 'text-tertiary',
        )}
      >
        {Number(date.slice(8, 10))}
      </span>
    </button>
  );
}

interface DayDotProps {
  item: CalendarItem;
  prefs: CalendarPrefs;
  calendars: CalendarLookup;
  /** Pixel offset while this dot is being dragged. */
  drag: { offsetX: number; offsetY: number } | null;
  onOpen: ItemOpenHandler;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}

/**
 * One item, drawn as a dot.
 *
 * Deliberately no title and no fill: at this size a title is unreadable and a
 * fill is a bar. The dot's own button is what keeps the item tappable and
 * draggable, and its accessible name is what keeps it reachable by keyboard.
 */
function DayDot({ item, prefs, calendars, drag, onOpen, onPointerDown }: DayDotProps) {
  const isTask = item.kind === 'task';
  const timeLabel = item.isAllDay ? 'All-day' : formatTime(item.startMs, prefs);
  const accessibleName = [timeLabel, item.title, isTask ? 'task' : 'event', item.completed ? 'completed' : null]
    .filter(Boolean)
    .join(', ');

  return (
    <button
      type="button"
      data-item-block="true"
      aria-label={accessibleName}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => event.preventDefault()}
      className={cn('flex size-3.5 items-center justify-center', drag && 'relative z-40')}
      style={drag ? { transform: `translate3d(${drag.offsetX}px, ${drag.offsetY}px, 0)` } : undefined}
    >
      <span
        aria-hidden
        className={cn('size-1.5 rounded-full', item.completed && 'opacity-60')}
        style={{ backgroundColor: accentVar(itemColor(item, calendars)) }}
      />
    </button>
  );
}
