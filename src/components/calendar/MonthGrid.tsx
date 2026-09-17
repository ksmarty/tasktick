'use client';

/**
 * The month grid — the top region of the calendar screen — and the one-week
 * strip it collapses into.
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
 * ## One lattice, clipped
 *
 * All six weeks are always rendered; the month and the strip are the same
 * lattice seen through a viewport of different heights. Collapsing is therefore
 * a clip, not a re-render: the viewport shrinks and the lattice slides up so the
 * row holding the selected day stays under the header. That is what lets the
 * height follow a finger continuously — the alternative, swapping a six-row grid
 * for a one-row one, can only ever jump.
 *
 * The two gestures the surface owns (vertical = height, horizontal = paging)
 * and the axis rule that separates them live in `./use-month-gestures`, next to
 * the numbers they settle on.
 *
 * ## The header
 *
 * The weekday captions are single letters (`M T W T F S S`, rotated to the
 * configured week start) in the out-of-month grey — the same colour a stray day
 * from a neighbouring month uses — and carry no rule: a hairline under the
 * header was the last boxed-in edge left in a month that is otherwise separated
 * by whitespace alone.
 *
 * ## The selected circle
 *
 * The selected day is a filled circle large enough to swallow its own event
 * dots, painted above the dot lane (`z-10`) so they cannot peek out around it;
 * the circle is `pointer-events-none`, so the dots underneath still take their
 * own taps and drags. Today, when it is not selected, is a white circle of the
 * same diameter with a hairline accent ring, so it stays visible on a white
 * card in light appearance.
 *
 * It never derives a date of its own: `days` is the server's padded day list for
 * the visible window, chunked into whole weeks by `buildMonthRows`, so the grid,
 * the agenda and the day sheet cannot disagree about which days a month
 * contains. Recurrence expansion, EXDATE handling and timed-overlap columns are
 * all absent here because the API already did them.
 *
 * The only other motion is the period change: `pageSeq` keys the viewport, so a
 * paging move remounts it and its entrance animation replays, entering from the
 * side `pageDirection` names. Nothing else here animates: selecting a day,
 * opening the day sheet and dragging a dot are direct manipulation, and a delay
 * on any of them reads as a dropped tap.
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
import { MONTH_COLUMNS, buildMonthRows, minuteOfDay, weekdayLabels } from './geometry';
import { MONTH_EXPANDED_PX, useMonthGestures } from './use-month-gestures';
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
  /**
   * Increments on every paging move; the viewport is keyed on it so the entrance
   * animation replays rather than playing once on first render. 0 = no motion.
   */
  pageSeq: number;
  /** `1` when the period advanced (the grid enters from the right), else `-1`. */
  pageDirection: 1 | -1;
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
  /** Pages the period: `-1` previous, `+1` next. Called by a committed swipe. */
  onPage: (delta: number) => void;
}

export function MonthGrid({
  days,
  anchor,
  selectedDate,
  today,
  pageSeq,
  pageDirection,
  payload,
  prefs,
  calendars,
  interaction,
  onSelectDate,
  onOpenDay,
  onOpenItem,
  onReschedule,
  onPage,
}: MonthGridProps) {
  const dayRefs = useRef(new Map<DateOnly, HTMLButtonElement>());
  const [focusDate, setFocusDate] = useState(selectedDate);
  const pendingFocus = useRef(false);

  const rows = useMemo(() => buildMonthRows(days, anchor), [days, anchor]);

  /** The week the collapsed strip must show: the one holding the selected day. */
  const focusRow = useMemo(() => {
    const index = rows.findIndex((row) => row.some((cell) => cell.date === selectedDate));
    return index >= 0 ? index : 0;
  }, [rows, selectedDate]);

  const { collapsed, viewportHeight, contentOffsetY, viewportRef, gridRef, toggle, handlers } = useMonthGestures({
    onPage,
    focusRow,
    interaction,
  });

  /**
   * The cells keyboard navigation may reach.
   *
   * Expanded that is the whole month; collapsed it is only the visible week, so
   * an arrow key cannot move focus onto a row that is clipped away and scroll
   * the viewport out from under the strip.
   */
  const visibleDays = useMemo(
    () => (collapsed ? (rows[focusRow] ?? []) : rows.flat()).map((cell) => cell.date),
    [rows, collapsed, focusRow],
  );

  const headers = useMemo(() => weekdayLabels(prefs.weekStartsOn, 'initial'), [prefs.weekStartsOn]);

  // The roving focus follows the selection whenever it is changed from outside.
  useEffect(() => setFocusDate(selectedDate), [selectedDate]);

  useEffect(() => {
    if (!pendingFocus.current) return;
    pendingFocus.current = false;
    // `preventScroll` keeps focus from scrolling the clipped lattice into view,
    // which would shift the strip away from the selected week.
    dayRefs.current.get(focusDate)?.focus({ preventScroll: true });
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
        count: Math.max(rows.length * MONTH_COLUMNS, 1),
        cellWidth: rect.width / MONTH_COLUMNS,
        // A collapsed strip has no week to move down into, so vertical movement
        // is off while it is clipped to one row.
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
    <div className="flex min-h-0 flex-col touch-none" {...handlers}>
      {/*
        Chrome, not content: the captions never slide with the lattice, and they
        are hidden from assistive tech because every day button already carries
        its full date name. No rule — the month is separated by whitespace.
      */}
      <div aria-hidden className="grid shrink-0 grid-cols-7">
        {headers.map((label, index) => (
          <span
            key={`${label}-${index}`}
            className="pb-0.5 text-center text-caption-2 leading-none font-medium text-tertiary"
          >
            {label}
          </span>
        ))}
      </div>

      <div
        // Keyed on the paging move, not the period: remounting is what restarts
        // the CSS animation, and selecting a padding day from a neighbouring
        // month must not slide — it has no gesture direction to honour.
        key={pageSeq}
        ref={viewportRef}
        className={cn(
          'overflow-hidden',
          // Duration, easing and the reduced-motion opt-out all come from the
          // token in `globals.css`; only the side differs here.
          pageSeq > 0 && (pageDirection > 0 ? 'animate-grid-in-from-right' : 'animate-grid-in-from-left'),
        )}
        style={{ height: viewportHeight }}
      >
        <div
          ref={gridRef}
          role="grid"
          aria-label={collapsed ? 'Week' : 'Month'}
          onKeyDown={onKeyDown}
          className="grid select-none"
          style={{
            height: MONTH_EXPANDED_PX,
            gridTemplateColumns: `repeat(${MONTH_COLUMNS}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))`,
            transform: `translate3d(0, ${contentOffsetY}px, 0)`,
          }}
        >
          {rows.map((row, rowIndex) => (
            <div key={rowIndex} role="row" className="contents">
              {row.map((cell, columnIndex) => {
                const dayItems = payload.days[cell.date] ?? [];
                const isSelected = cell.date === selectedDate;
                const cellIndex = rowIndex * MONTH_COLUMNS + columnIndex;
                const fullLabel = fromDateOnly(cell.date, prefs.zone).toFormat('cccc d LLLL yyyy');

                /*
                  A plain surface, never a boxed cell: the days are separated by
                  whitespace and a day from a neighbouring month is told apart by
                  its dimmed number alone. A per-cell tint was tried and removed
                  — wherever the backdrop made it visible it read as exactly the
                  boxed cell this change exists to delete.
                */
                return (
                  <div
                    key={cell.date}
                    role="gridcell"
                    aria-selected={isSelected}
                    onClick={() => onSelectDate(cell.date)}
                    className="relative flex min-h-0 flex-col items-center"
                  >
                    <DayNumber
                      date={cell.date}
                      inMonth={cell.inMonth}
                      isSelected={isSelected}
                      isToday={cell.date === today}
                      itemCount={dayItems.length}
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

                    {/*
                      Fixed height, absolutely placed so it adds no height to
                      the row and every number sits on the same line.

                      The lane sits high in the cell — level with the lower
                      half of the day circle — because the selected circle has to
                      *contain* the dots, not merely overlap their bounding box:
                      a dot at the bottom edge of a 36px circle falls outside its
                      curve even when it is inside its box. The cluster is tight
                      (10px gapless hit boxes) for the same reason — a 3-dot row
                      has to fit inside the circle's diameter.

                      `pointer-events-none` on the lane itself is what keeps the
                      day's hit box honest: only the dots are handles, so a tap
                      beside them falls through to the day button underneath
                      rather than stopping at an invisible strip.
                    */}
                    <span className="pointer-events-none absolute inset-x-0 top-[18px] flex h-3 shrink-0 items-center justify-center">
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
      </div>

      {/*
        The grabber replaces the old chevron button: the grid's height is a drag
        gesture now. It stays a real button so the collapse is still reachable
        without a pointer — click, Enter or Space toggles it — and `aria-expanded`
        says which way it will go.
      */}
      <button
        type="button"
        aria-label={collapsed ? 'Expand the month' : 'Collapse to a week'}
        aria-expanded={!collapsed}
        onClick={toggle}
        className="flex h-5 w-full shrink-0 items-center justify-center"
      >
        <span aria-hidden className="h-1 w-9 rounded-full bg-separator" />
      </button>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </div>
  );
}

interface DayNumberProps {
  date: DateOnly;
  inMonth: boolean;
  isSelected: boolean;
  isToday: boolean;
  /** How many items the server bucketed on this day; 0 means no dots. */
  itemCount: number;
  /** The full accessible date name the button announces. */
  fullLabel: string;
  tabIndex: number;
  registerRef: (node: HTMLButtonElement | null) => void;
  activate: () => void;
}

/**
 * The day number as one button.
 *
 * The item count is in the accessible name rather than on screen — a "3" in a
 * 55px cell is exactly the noise the dots replaced — so a screen reader still
 * hears everything the day holds.
 *
 * The circle is one size for every state, so the month never re-lays-out as the
 * selection moves. It is drawn *above* the dot lane (`relative z-10`) and made
 * `pointer-events-none`, which is the pair that lets it hide the dots visually
 * while the dots keep their own hit boxes.
 */
function DayNumber({
  date,
  inMonth,
  isSelected,
  isToday,
  itemCount,
  fullLabel,
  tabIndex,
  registerRef,
  activate,
}: DayNumberProps) {
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
      /*
       * The button is taller than the row it sits in: the visible row is 36px,
       * the day is a 40px tap target. `-my-0.5` pays for it, so the grid does
       * not grow, and `pt-0.5` keeps the circle off the row's top edge.
       */
      className="flex w-full -my-0.5 min-h-10 flex-col items-center justify-start pt-0.5"
    >
      <span
        className={cn(
          /*
           * The circle is a full row tall (36px). It has to be: it must cover
           * the number *and* the dot cluster, and a round 34px shape at this
           * pitch leaves the outer dot of a three-dot day outside its curve. The
           * number is nudged into the upper part of the circle to leave the dots
           * the middle band the circle can actually contain.
           */
          'tnum relative z-10 pointer-events-none flex size-9 shrink-0 items-start justify-center rounded-full pt-[5px] leading-none text-footnote',
          // Selection fades between fill, ring and tint over a fifth of a
          // second. Colour and shadow only: the circle keeps its box, so the
          // grid never re-lays-out when the selected day changes.
          'transition-[background-color,color,box-shadow] duration-200 ease-ios',
          isSelected
            ? 'bg-tint font-semibold text-tint-contrast'
            : isToday
              ? // White with a hairline accent ring: a plain white circle would
                // vanish on a white card in light appearance.
                'bg-elevated font-semibold text-tint ring-1 ring-tint'
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
      className={cn('flex size-2.5 pointer-events-auto items-center justify-center', drag && 'relative z-40')}
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
