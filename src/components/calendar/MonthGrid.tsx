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
 * ## Paging is a track, not a swap
 *
 * The month pages by *sliding*. Three panels — the previous month, the current
 * one and the next — sit side by side in a track three viewports wide, and a
 * horizontal drag translates the whole track with the finger. The incoming month
 * is therefore on screen for the entire gesture, with its day numbers, its dots
 * and its today/selected states already right, instead of appearing from blank
 * space once the finger lifts. One page is exactly a third of the track, so the
 * settled transform is `-100% / 3` and a drag only ever moves that one number.
 *
 * `pageSeq` keys the track: a committed page remounts it, which is what
 * guarantees the settled DOM carries no leftover pixel offset, and the
 * neighbouring panels are drawn from the same `days`/`payload` pair as the
 * current one so nothing about them can drift out of alignment. They are
 * `aria-hidden` and contain no controls — only the settled month is focusable,
 * so the roving tabindex can never land on a month that is off-screen.
 *
 * There is no entrance animation: the month being dragged to is already in
 * place, so arriving is a slide, never an animation played on top of one.
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
 * card in light appearance. The number is centred in that disc by the disc's own
 * flex box — one rule for both the live month and the ones on either side — so
 * the glyph cannot sit high in the circle while the circle is being dragged.
 *
 * It never derives a date of its own: `days` is the server's padded day list for
 * the visible window, chunked into whole weeks by `buildMonthRows`, so the grid,
 * the agenda and the day sheet cannot disagree about which days a month
 * contains. Recurrence expansion, EXDATE handling and timed-overlap columns are
 * all absent here because the API already did them.
 *
 * Selecting a day, opening the day sheet and dragging a dot are direct
 * manipulation: a delay on any of them reads as a dropped tap.
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
import { useItemDrag, type DragGhost, type DragInit } from './use-item-drag';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, ItemOpenHandler, RescheduleHandler } from './types';

/**
 * Dots a cell will show.
 *
 * Beyond three the cluster stops saying "this day is busy" and starts being a
 * bar chart again; the exact count is in the day's accessible name and in the
 * day detail sheet.
 */
const MAX_DOTS = 3;

/**
 * The day cell's vertical stack.
 *
 * The button is taller than the row it sits in: the visible row is 36px, the day
 * is a 40px tap target. `-my-0.5` pays for it, so the grid does not grow, and
 * `pt-0.5` keeps the circle off the row's top edge. Shared with the static
 * panels so a neighbouring month's numbers land on exactly the same line as the
 * current month's.
 */
const DAY_STACK = 'flex w-full -my-0.5 min-h-10 flex-col items-center justify-start pt-0.5';

/**
 * One month of the paging track: its window, the day it is anchored on and the
 * server's bucketed items for that window.
 */
export interface MonthPage {
  /** The server-padded day window this month shows, out to whole weeks. */
  days: DateOnly[];
  /** A day inside the month; `buildMonthRows` reads its month for `inMonth`. */
  anchor: DateOnly;
  /** The server's response for that window; empty until it arrives. */
  payload: CalendarItemsPayload;
}

export interface MonthGridProps {
  /** The server's padded day list for the visible month window. */
  days: DateOnly[];
  /** A day inside the month being displayed. */
  anchor: DateOnly;
  /** The month before the current one, drawn on the left of the track. */
  previous: MonthPage;
  /** The month after the current one, drawn on the right of the track. */
  next: MonthPage;
  /** The selected day: the agenda's day and the roving keyboard focus. */
  selectedDate: DateOnly;
  today: DateOnly;
  /**
   * Increments on every paging move; the track is keyed on it, so a committed
   * page re-renders the panels at their settled offset. 0 = no page yet.
   */
  pageSeq: number;
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
  /** Reports the month the drag is showing, so the toolbar title can follow it. */
  onPagePreview: (delta: -1 | 0 | 1) => void;
}

export function MonthGrid({
  days,
  anchor,
  previous,
  next,
  selectedDate,
  today,
  pageSeq,
  payload,
  prefs,
  calendars,
  interaction,
  onSelectDate,
  onOpenDay,
  onOpenItem,
  onReschedule,
  onPage,
  onPagePreview,
}: MonthGridProps) {
  const dayRefs = useRef(new Map<DateOnly, HTMLButtonElement>());
  /** The live month's lattice: the drag lattice measures against this, not the track. */
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusDate, setFocusDate] = useState(selectedDate);
  const pendingFocus = useRef(false);

  const rows = useMemo(() => buildMonthRows(days, anchor), [days, anchor]);

  /** The week the collapsed strip must show: the one holding the selected day. */
  const focusRow = useMemo(() => {
    const index = rows.findIndex((row) => row.some((cell) => cell.date === selectedDate));
    return index >= 0 ? index : 0;
  }, [rows, selectedDate]);

  const { collapsed, viewportHeight, contentOffsetY, viewportRef, trackRef, toggle, handlers } = useMonthGestures({
    onPage,
    onPagePreview,
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

      <div ref={viewportRef} className="overflow-hidden" style={{ height: viewportHeight }}>
        <div
          /*
           * Keyed on the paging move: a committed page remounts the track, which
           * is what drops the drag's pixel offset — the transform React renders
           * here is the only settled position the DOM ever holds.
           */
          key={pageSeq}
          ref={trackRef}
          className="flex"
          style={{
            // Three pages wide, one page per panel; `-100% / 3` is therefore
            // exactly the offset that puts the middle month in the viewport.
            width: '300%',
            height: MONTH_EXPANDED_PX,
            transform: `translate3d(calc(-100% / 3), ${contentOffsetY}px, 0)`,
          }}
        >
          <MonthPanel
            panel="previous"
            page={previous}
            selectedDate={selectedDate}
            today={today}
            prefs={prefs}
            calendars={calendars}
            live={null}
          />

          <MonthPanel
            panel="current"
            page={{ days, anchor, payload }}
            selectedDate={selectedDate}
            today={today}
            prefs={prefs}
            calendars={calendars}
            gridRef={gridRef}
            live={{
              collapsed,
              focusDate,
              onKeyDown,
              onSelectDate,
              onOpenDay,
              onOpenItem,
              drag: drag.ghost,
              registerDay: (date, node) => {
                if (node) dayRefs.current.set(date, node);
                else dayRefs.current.delete(date);
              },
              onDotPointerDown: (item, event, init) => drag.begin(item, event, init),
            }}
          />

          <MonthPanel
            panel="next"
            page={next}
            selectedDate={selectedDate}
            today={today}
            prefs={prefs}
            calendars={calendars}
            live={null}
          />
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

/**
 * What the live month needs and a neighbouring one does not.
 *
 * Only the settled month is interactive: the two beside it are pictures of where
 * the finger is taking the grid, so they take no focus, no taps and no drags.
 */
interface LivePanelProps {
  collapsed: boolean;
  focusDate: DateOnly;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onSelectDate: (date: DateOnly) => void;
  onOpenDay: (date: DateOnly) => void;
  onOpenItem: ItemOpenHandler;
  /** Registers a day button for the roving focus. */
  registerDay: (date: DateOnly, node: HTMLButtonElement | null) => void;
  /** The lift in flight, so a dot being dragged still paints above the grid. */
  drag: DragGhost | null;
  onDotPointerDown: (item: CalendarItem, event: ReactPointerEvent<HTMLButtonElement>, init: DragInit) => void;
}

interface MonthPanelProps {
  /** Which slot of the three-wide track this is. */
  panel: 'previous' | 'current' | 'next';
  page: MonthPage;
  selectedDate: DateOnly;
  today: DateOnly;
  prefs: CalendarPrefs;
  calendars: CalendarLookup;
  /** Set for the live month only; `null` makes the panel presentational. */
  live: LivePanelProps | null;
  /** The live month's lattice, which the drag geometry is measured against. */
  gridRef?: React.RefObject<HTMLDivElement | null>;
}

/**
 * One month of the track.
 *
 * The same cells, in the same lattice, for all three panels: a neighbouring month
 * has to be indistinguishable from the current one while it slides in, so the
 * only difference is that its days are not controls. `buildMonthRows` did the
 * chunking, so a panel never decides for itself which days it holds.
 */
function MonthPanel({ panel, page, selectedDate, today, prefs, calendars, live, gridRef }: MonthPanelProps) {
  const rows = useMemo(() => buildMonthRows(page.days, page.anchor), [page.days, page.anchor]);

  return (
    <div
      ref={gridRef}
      role={live ? 'grid' : undefined}
      aria-label={live ? (live.collapsed ? 'Week' : 'Month') : undefined}
      aria-hidden={live ? undefined : true}
      data-month-panel={panel}
      onKeyDown={live?.onKeyDown}
      className="grid w-1/3 shrink-0 select-none"
      style={{
        height: MONTH_EXPANDED_PX,
        gridTemplateColumns: `repeat(${MONTH_COLUMNS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))`,
      }}
    >
      {rows.map((row, rowIndex) => (
        <div key={rowIndex} role={live ? 'row' : undefined} className="contents">
          {row.map((cell, columnIndex) => {
            const dayItems = page.payload.days[cell.date] ?? [];
            const isSelected = cell.date === selectedDate;
            const isToday = cell.date === today;
            const cellIndex = rowIndex * MONTH_COLUMNS + columnIndex;

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
                role={live ? 'gridcell' : undefined}
                aria-selected={live ? isSelected : undefined}
                data-date={cell.date}
                onClick={live ? () => live.onSelectDate(cell.date) : undefined}
                className="relative flex min-h-0 flex-col items-center"
              >
                {live ? (
                  <DayNumber
                    date={cell.date}
                    inMonth={cell.inMonth}
                    isSelected={isSelected}
                    isToday={isToday}
                    itemCount={dayItems.length}
                    fullLabel={fromDateOnly(cell.date, prefs.zone).toFormat('cccc d LLLL yyyy')}
                    tabIndex={live.focusDate === cell.date ? 0 : -1}
                    registerRef={(node) => live.registerDay(cell.date, node)}
                    activate={() => {
                      // Tapping the day already selected reveals the whole day.
                      if (isSelected) live.onOpenDay(cell.date);
                      else live.onSelectDate(cell.date);
                    }}
                  />
                ) : (
                  // The disc alone: same size, same states, same centring rule.
                  <span className={DAY_STACK}>
                    <DayNumberFace date={cell.date} inMonth={cell.inMonth} isSelected={isSelected} isToday={isToday} />
                  </span>
                )}

                {/*
                  Fixed height, absolutely placed so it adds no height to
                  the row and every number sits on the same line.

                  The lane sits just below the centred day number, and still
                  inside the 36px circle: the number's ink ends 5px under the
                  disc's centre, so the dots start at 6px and the whole cluster
                  stays within the curve (the outermost dot's corner reaches
                  17.7px of the disc's 18px radius). Any lower and the selected
                  circle would stop containing its own dots; any higher and the
                  dots cross the digits' baseline.

                  `pointer-events-none` on the lane itself is what keeps the
                  day's hit box honest: only the dots are handles, so a tap
                  beside them falls through to the day button underneath
                  rather than stopping at an invisible strip.
                */}
                <span className="pointer-events-none absolute inset-x-0 top-[21px] flex h-3 shrink-0 items-center justify-center">
                  {dayItems.slice(0, MAX_DOTS).map((item) =>
                    live ? (
                      <DayDot
                        key={item.key}
                        item={item}
                        prefs={prefs}
                        calendars={calendars}
                        drag={live.drag?.item.key === item.key ? live.drag : null}
                        onOpen={live.onOpenItem}
                        onPointerDown={(event) =>
                          live.onDotPointerDown(item, event, {
                            // `hourHeight` is 0 for the month, so this value is
                            // carried straight through to the drop: it keeps a
                            // timed item's clock time instead of zeroing it.
                            startMinute: item.isAllDay ? 0 : minuteOfDay(item.startMs, prefs.zone),
                            durationMinutes: 0,
                            cellIndex,
                          })
                        }
                      />
                    ) : (
                      <span key={item.key} className="flex size-2.5 items-center justify-center">
                        <DotMark item={item} calendars={calendars} />
                      </span>
                    ),
                  )}
                </span>
              </div>
            );
          })}
        </div>
      ))}
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
      className={DAY_STACK}
    >
      <DayNumberFace date={date} inMonth={inMonth} isSelected={isSelected} isToday={isToday} />
    </button>
  );
}

interface DayNumberFaceProps {
  date: DateOnly;
  inMonth: boolean;
  isSelected: boolean;
  isToday: boolean;
}

/**
 * The disc itself, and the only place the number is positioned.
 *
 * It is a 36px flex box and the glyph is centred in it (`items-center`), so the
 * number's box and the circle share a centre by construction. The nudge this
 * replaced — `items-start` plus `pt-[5px]` — dated from a resize of the circle
 * and left every digit sitting high in its disc; the baseline is not offset by
 * `leading-none` either, because flex centring puts the line box, and therefore
 * the glyph centred inside it, on the disc's middle.
 */
function DayNumberFace({ date, inMonth, isSelected, isToday }: DayNumberFaceProps) {
  return (
    <span
      className={cn(
        /*
         * The circle is a full row tall (36px). It has to be: it must cover
         * the number *and* the dot cluster, and a round 34px shape at this
         * pitch leaves the outer dot of a three-dot day outside its curve.
         */
        'tnum relative z-10 pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-full leading-none text-footnote',
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
  );
}

/** The dot itself: one item's colour, at dot size. Shared by both panels. */
function DotMark({ item, calendars }: { item: CalendarItem; calendars: CalendarLookup }) {
  return (
    <span
      aria-hidden
      className={cn('size-1.5 rounded-full', item.completed && 'opacity-60')}
      style={{ backgroundColor: accentVar(itemColor(item, calendars)) }}
    />
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
      <DotMark item={item} calendars={calendars} />
    </button>
  );
}
