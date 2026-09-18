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
 * the numbers they settle on. **Nothing here may change their contract**: the
 * gesture hook measures `viewportRef` (one page wide, height written straight to
 * the node) and writes `trackRef` (three pages wide, re-based on `-100% / 3`) and
 * `gridRef` (the live lattice the drag geometry divides by columns/rows). Those
 * three nodes and their nesting are load-bearing; this file only decides how the
 * cells inside them are painted.
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
 * ## Material
 *
 * The surface is MUI's `Paper` and the chrome is `Typography` and `IconButton`;
 * the lattice, the day disc and the dot lane stay `Box`-based, because MUI has no
 * month calendar and `DateCalendar` is a date *picker* — it would cost the dots
 * and the paging. Styling is `sx` only. Item colours come from the server as
 * accent tokens and are resolved to hex through `lib/colors`, so nothing depends
 * on the old CSS custom properties.
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
 * dots, painted above the dot lane (`zIndex: 10`) so they cannot peek out around
 * it; the circle is `pointer-events-none`, so the dots underneath still take
 * their own taps and drags. Today, when it is not selected, is a paper-coloured
 * circle of the same diameter with a hairline primary ring, so it stays visible
 * on a paper card in light appearance. The number is centred in that disc by the
 * disc's own flex box — one rule for both the live month and the ones on either
 * side — so the glyph cannot sit high in the circle while the circle is being
 * dragged.
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
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useColorScheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import type { SystemStyleObject } from '@mui/system';
import { accentHex } from '@/lib/colors';
import { addDaysToDateOnly, formatTime, fromDateOnly, toDateOnly } from '@/lib/dates';
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

/** Diameter of the day disc, and of the tap target's min box. */
const DISC_PX = 36;
const TAP_MIN_PX = 40;
/** The dot lane's top edge, measured from the row's top: just under the digits. */
const DOT_LANE_TOP_PX = 21;
const DOT_LANE_HEIGHT_PX = 12;
const DOT_HIT_PX = 10;
const DOT_PX = 6;

/**
 * The day cell's vertical stack.
 *
 * The button is taller than the row it sits in: the visible row is 36px, the day
 * is a 40px tap target. The negative margin pays for it, so the grid does not
 * grow, and the 2px top padding keeps the circle off the row's top edge. Shared
 * with the static panels so a neighbouring month's numbers land on exactly the
 * same line as the current month's.
 */
const DAY_STACK: SystemStyleObject<Theme> = {
  display: 'flex',
  width: '100%',
  my: '-2px',
  minHeight: `${TAP_MIN_PX}px`,
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'flex-start',
  pt: '2px',
  border: 0,
  bgcolor: 'transparent',
  p: 0,
  font: 'inherit',
  color: 'inherit',
  cursor: 'pointer',
};

/** The disc itself: one size for every state, so the month never re-lays-out. */
const DISC_SX: SystemStyleObject<Theme> = {
  position: 'relative',
  zIndex: 10,
  pointerEvents: 'none',
  display: 'flex',
  width: `${DISC_PX}px`,
  height: `${DISC_PX}px`,
  flexShrink: 0,
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '50%',
  // Colour, fill and ring only: the circle keeps its box, so the grid never
  // re-lays-out when the selected day changes.
  transition: (theme) =>
    theme.transitions.create(['background-color', 'color', 'box-shadow'], {
      duration: theme.transitions.duration.shortest,
    }),
};

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
  /** The resolved appearance, so an accent token maps to the right hex. */
  const { colorScheme } = useColorScheme();
  const dark = colorScheme === 'dark';

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
    <Paper
      elevation={0}
      variant="outlined"
      /*
       * `touchAction: none` is the gesture contract: *touch* pans on this surface
       * belong to the two gestures, never to the page. The height and the track's
       * transform are written straight to the nodes by the hook.
       */
      sx={{ display: 'flex', minHeight: 0, flexDirection: 'column', touchAction: 'none' }}
      {...handlers}
    >
      {/*
        Chrome, not content: the captions never slide with the lattice, and they
        are hidden from assistive tech because every day button already carries
        its full date name. No rule — the month is separated by whitespace.
      */}
      <Box aria-hidden sx={{ display: 'grid', gridTemplateColumns: `repeat(${MONTH_COLUMNS}, 1fr)`, flexShrink: 0 }}>
        {headers.map((label, index) => (
          <Typography
            key={`${label}-${index}`}
            variant="caption"
            sx={{ pb: '2px', textAlign: 'center', lineHeight: 1, color: 'text.disabled' }}
          >
            {label}
          </Typography>
        ))}
      </Box>

      <Box ref={viewportRef} sx={{ overflow: 'hidden' }} style={{ height: viewportHeight }}>
        <Box
          /*
           * Keyed on the paging move: a committed page remounts the track, which
           * is what drops the drag's pixel offset — the transform React renders
           * here is the only settled position the DOM ever holds.
           */
          key={pageSeq}
          ref={trackRef}
          sx={{ display: 'flex' }}
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
            dark={dark}
            live={null}
          />

          <MonthPanel
            panel="current"
            page={{ days, anchor, payload }}
            selectedDate={selectedDate}
            today={today}
            prefs={prefs}
            calendars={calendars}
            dark={dark}
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
            dark={dark}
            live={null}
          />
        </Box>
      </Box>

      {/*
        The grabber replaces the old chevron button: the grid's height is a drag
        gesture now. It stays a real button so the collapse is still reachable
        without a pointer — click, Enter or Space toggles it — and `aria-expanded`
        says which way it will go.
      */}
      <IconButton
        aria-label={collapsed ? 'Expand the month' : 'Collapse to a week'}
        aria-expanded={!collapsed}
        onClick={toggle}
        sx={{ height: 20, width: '100%', flexShrink: 0, borderRadius: 1, p: 0 }}
      >
        <Box aria-hidden sx={{ height: 4, width: 36, borderRadius: 2, bgcolor: 'divider' }} />
      </IconButton>

      {drag.ghost ? <DragGhostLabel ghost={drag.ghost} /> : null}
    </Paper>
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
  /** Resolved appearance, for the item accent hexes. */
  dark: boolean;
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
function MonthPanel({ panel, page, selectedDate, today, prefs, calendars, dark, live, gridRef }: MonthPanelProps) {
  const rows = useMemo(() => buildMonthRows(page.days, page.anchor), [page.days, page.anchor]);

  return (
    <Box
      ref={gridRef}
      role={live ? 'grid' : undefined}
      aria-label={live ? (live.collapsed ? 'Week' : 'Month') : undefined}
      aria-hidden={live ? undefined : true}
      data-month-panel={panel}
      onKeyDown={live?.onKeyDown}
      sx={{
        display: 'grid',
        width: 'calc(100% / 3)',
        flexShrink: 0,
        userSelect: 'none',
        gridTemplateColumns: `repeat(${MONTH_COLUMNS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))`,
      }}
      style={{ height: MONTH_EXPANDED_PX }}
    >
      {rows.map((row, rowIndex) => (
        <Box key={rowIndex} role={live ? 'row' : undefined} sx={{ display: 'contents' }}>
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
              <Box
                key={cell.date}
                role={live ? 'gridcell' : undefined}
                aria-selected={live ? isSelected : undefined}
                data-date={cell.date}
                onClick={live ? () => live.onSelectDate(cell.date) : undefined}
                sx={{ position: 'relative', display: 'flex', minHeight: 0, flexDirection: 'column', alignItems: 'center' }}
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
                  <Box sx={DAY_STACK}>
                    <DayNumberFace date={cell.date} inMonth={cell.inMonth} isSelected={isSelected} isToday={isToday} />
                  </Box>
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

                  `pointerEvents: none` on the lane itself is what keeps the
                  day's hit box honest: only the dots are handles, so a tap
                  beside them falls through to the day button underneath
                  rather than stopping at an invisible strip.
                */}
                <Box
                  sx={{
                    pointerEvents: 'none',
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: `${DOT_LANE_TOP_PX}px`,
                    display: 'flex',
                    height: `${DOT_LANE_HEIGHT_PX}px`,
                    flexShrink: 0,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {dayItems.slice(0, MAX_DOTS).map((item) =>
                    live ? (
                      <DayDot
                        key={item.key}
                        item={item}
                        prefs={prefs}
                        calendars={calendars}
                        dark={dark}
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
                      <Box
                        key={item.key}
                        sx={{ display: 'flex', width: DOT_HIT_PX, height: DOT_HIT_PX, alignItems: 'center', justifyContent: 'center' }}
                      >
                        <DotMark item={item} calendars={calendars} dark={dark} />
                      </Box>
                    ),
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      ))}
    </Box>
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
 * selection moves. It is drawn *above* the dot lane (`zIndex: 10`) and made
 * `pointer-events: none`, which is the pair that lets it hide the dots visually
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
    <Box
      component="button"
      ref={registerRef}
      type="button"
      tabIndex={tabIndex}
      aria-current={isToday ? 'date' : undefined}
      aria-label={itemCount > 0 ? `${fullLabel}, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : fullLabel}
      onClick={(event) => {
        event.stopPropagation();
        activate();
      }}
      sx={DAY_STACK}
    >
      <DayNumberFace date={date} inMonth={inMonth} isSelected={isSelected} isToday={isToday} />
    </Box>
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
 * It is a 36px flex box and the glyph is centred in it, so the number's box and
 * the circle share a centre by construction. The nudge this replaced —
 * `justify-content: flex-start` plus a 5px top padding — dated from a resize of
 * the circle and left every digit sitting high in its disc.
 */
function DayNumberFace({ date, inMonth, isSelected, isToday }: DayNumberFaceProps) {
  return (
    <Box
      sx={[
        DISC_SX,
        // Selection fades between fill, ring and tint over a fifth of a second.
        isSelected
          ? { bgcolor: 'primary.main', color: 'primary.contrastText' }
          : isToday
            ? // Paper with a hairline accent ring: a plain paper circle would
              // vanish on a paper card in light appearance.
              {
                bgcolor: 'background.paper',
                color: 'primary.main',
                boxShadow: (theme) => `inset 0 0 0 1px ${theme.palette.primary.main}`,
              }
            : inMonth
              ? { color: 'text.primary' }
              : { color: 'text.disabled' },
      ]}
    >
      <Typography
        component="span"
        variant="body2"
        sx={{ lineHeight: 1, fontWeight: isSelected || isToday ? 600 : 400, fontVariantNumeric: 'tabular-nums' }}
      >
        {Number(date.slice(8, 10))}
      </Typography>
    </Box>
  );
}

/** The dot itself: one item's colour, at dot size. Shared by both panels. */
function DotMark({ item, calendars, dark }: { item: CalendarItem; calendars: CalendarLookup; dark: boolean }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: DOT_PX,
        height: DOT_PX,
        borderRadius: '50%',
        opacity: item.completed ? 0.6 : 1,
        bgcolor: accentHex(itemColor(item, calendars), dark),
      }}
    />
  );
}

interface DayDotProps {
  item: CalendarItem;
  prefs: CalendarPrefs;
  calendars: CalendarLookup;
  dark: boolean;
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
function DayDot({ item, prefs, calendars, dark, drag, onOpen, onPointerDown }: DayDotProps) {
  const isTask = item.kind === 'task';
  const timeLabel = item.isAllDay ? 'All-day' : formatTime(item.startMs, prefs);
  const accessibleName = [timeLabel, item.title, isTask ? 'task' : 'event', item.completed ? 'completed' : null]
    .filter(Boolean)
    .join(', ');

  return (
    <Box
      component="button"
      type="button"
      data-item-block="true"
      aria-label={accessibleName}
      onClick={(event) => {
        event.stopPropagation();
        onOpen(item);
      }}
      onPointerDown={onPointerDown}
      onContextMenu={(event) => event.preventDefault()}
      sx={{
        display: 'flex',
        width: DOT_HIT_PX,
        height: DOT_HIT_PX,
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'auto',
        border: 0,
        bgcolor: 'transparent',
        p: 0,
        ...(drag ? { position: 'relative', zIndex: 40 } : null),
      }}
      style={drag ? { transform: `translate3d(${drag.offsetX}px, ${drag.offsetY}px, 0)` } : undefined}
    >
      <DotMark item={item} calendars={calendars} dark={dark} />
    </Box>
  );
}
