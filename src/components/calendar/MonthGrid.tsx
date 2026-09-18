'use client';

/**
 * The month grid — the top region of the calendar screen — and the one-week
 * strip it collapses into.
 *
 * The cell is deliberately almost empty: the day number and one small dot. No
 * titles, no bars, no counts. A phone cell is ~55px wide, so it has room for
 * either a legible day number or four characters of an event title; the previous
 * bar-chart treatment chose the title, which made the grid noisy and buried the
 * date itself. The dot answers the only question the grid is asked — "is
 * anything happening that day?" — and the *how many* is in the day's accessible
 * name while the *what* lives in the agenda below and in the day detail sheet,
 * both one tap away.
 *
 * The dot is decoration, not a control: it cannot be focused, tapped or dragged,
 * and it never intercepts its day's tap. The day cell, the agenda rows and the
 * day sheet are where an item is opened and moved — see "The dots".
 *
 * ## One lattice, clipped
 *
 * All six weeks are always rendered; the month and the strip are the same
 * lattice seen through a viewport of different heights. Collapsing is therefore
 * a clip, not a re-render: the viewport shrinks and the lattice slides up so the
 * row holding the selected day stays under the header. That is what lets the
 * height follow a finger continuously — the alternative, swapping a six-row grid
 * for a one-row one, can only ever jump. It is also what lets a collapsed swipe
 * reach the next week: that week is the next row of the same lattice, already
 * painted, so it rolls in rather than being fetched or swapped.
 *
 * ## The two gestures — do not disturb this markup
 *
 * The two gestures the surface owns (vertical = height, horizontal = paging)
 * and the axis rule that separates them live in `./use-month-gestures`, next to
 * the numbers they settle on. The hook owns the paging *unit* as well as the
 * movement — one month expanded, one week collapsed — and **nothing here may
 * change its contract**:
 *
 *   · `{...handlers}` must stay on the outermost surface, because that is the
 *     node the pointer is captured on and the node `onClickCapture` eats the
 *     post-drag click from.
 *   · `viewportRef` must stay on the clip. It is measured with
 *     `getBoundingClientRect()` for "one page", and the height the hook writes
 *     to it is compared against `MONTH_EXPANDED_PX` / `MONTH_COLLAPSED_PX`, so
 *     **the clip carries no padding of any kind**: padding would make the border
 *     box wider and taller than the page and the strip the hook believes in, and
 *     the drag would drift by half a gesture. The layout inset therefore lives on
 *     the weekday header and on each panel *wrapper* — never on the surface
 *     (which carries none) and never on the clip.
 *   · `trackRef` must stay on the 300%-wide track whose settled transform is
 *     `-100% / 3` and whose only other transform source is the hook's own
 *     `paint()`. The React-rendered `style` here is the settled base the hook
 *     re-bases to; it must keep writing the same value or the two will disagree.
 *     The track's children must stay the three pages in order (previous,
 *     current, next): the hook's cross-fade walks them and reads each one's
 *     distance from the viewport's centre.
 *   · `gridRef` must stay on the live panel, because the roving focus and the
 *     day buttons register against that element. The inset that gives two months
 *     a visible boundary lives on the panel *wrapper* around this element, never
 *     on it: the lattice is exactly seven equal columns of what the inset leaves.
 *
 * Those four nodes and their nesting are load-bearing; this file only decides
 * how the cells inside them are painted.
 *
 * ## The page gap
 *
 * The three months used to meet edge to edge, which read as one continuous wall
 * of numbers mid-drag. They now get a visible gap — but by insetting each
 * panel's *content*, not by putting a flex `gap` between the panels. A flex gap
 * would have widened the stride between two settled pages from the clip width
 * to clip-plus-gap, and the hook computes every offset (`-width`, the `-2·width`
 * clamp, the commit fraction) from the measured clip. Insets leave the panel
 * boxes exactly one-third of the track and the stride exactly one clip wide, so
 * the paging maths is untouched — the settled transform is still `-100% / 3` and
 * a drag still moves the track one-to-one.
 *
 * The inset is `px-4` on each panel wrapper and on the weekday header, which
 * makes the whitespace between two adjacent panels 2rem (it was `px-2`, i.e.
 * 1rem) and the settled month's content sit 1rem from the screen edge (it was
 * 0.5rem). Both halves of that are the same number: the seam is two panels'
 * insets and the outer edge is one, so doubling the seam doubles the edge. The
 * weekday captions moved with the panels, so the letters still sit over the
 * columns they label.
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
 * The slide is cross-faded on top of the movement: the outgoing month fades out
 * as the incoming one fades in, and the *fade* is scrubbed by the same pointer
 * the movement follows (see `./use-month-gestures`). At rest the panels are at
 * the opacity that leaves the current month alone on screen — `opacity-100` for
 * it, `opacity-0` for the two beside it, which are a full page away and
 * invisible anyway; the hook overwrites those values per frame from the drag.
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
 * ## The surface
 *
 * The surface is a plain element on the page's own background: no card fill, no
 * border and no rounding, because the month is not a separate panel — a tinted,
 * outlined box around the grid read as a distinct surface against the page, and
 * the days are already separated by whitespace and a dimmed number alone. What
 * is left is a bare `flex flex-col` whose only jobs are to hold the two
 * gestures' nodes in the right nesting; the screen's horizontal inset (`px-2`)
 * now lives on the weekday header and on each panel wrapper, so the clip itself
 * stays the full width the paging gesture measures one page against. The
 * lattice, the day disc and the dot lane are plain elements
 * with Tailwind utilities — shadcn has no month calendar and react-day-picker is
 * a date *picker*, which would cost both the dots and the paging. Item colours
 * come from the server as accent tokens and are resolved to hex through
 * `lib/colors`, so nothing depends on a CSS custom property per accent.
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
 * own taps and drags. Today, when it is not selected, is a card-coloured circle
 * of the same diameter with a hairline primary ring, so it stays visible on the
 * surface in light appearance. The number is centred in that disc by the disc's
 * own flex box — one rule for both the live month and the ones on either side —
 * so the glyph cannot sit high in the circle while the circle is being dragged.
 * The disc carries a 1px border in every state (transparent except for today),
 * so toggling a state can never re-lay-out the cell.
 *
 * ## The dots
 *
 * One dot, and only ever one, painted in the theme's muted foreground at a
 * deliberately low prominence — 4px and half opacity — rather than in the item's
 * colour. The lane answers one question — "is anything
 * happening that day?" — and a cluster of up to three accent-coloured circles
 * answered a different one badly: it was the most saturated thing on a
 * monochrome surface, and it read as a bar chart, which is what the dots
 * replaced. Which calendar, how many and *what* live in the day's accessible
 * name, the day detail sheet and the agenda, one tap away.
 *
 * A dot is decoration. It is a plain `aria-hidden` span with
 * `pointer-events-none` on both itself and the lane around it — no button, no
 * `tabindex`, no `aria-label`, no click handler — so it can neither be focused
 * nor tapped, and the day cell underneath keeps every pixel of its own hit area.
 * (A dot that swallowed its day's tap was a real bug here; decoration cannot
 * reintroduce it.) Items are opened from the agenda or the day sheet.
 *
 * The lane sits `top-6` (24px) from the row's top: the day number's 14px line
 * box ends 25px down, so the 4px dot (centred at 30px) leaves visible whitespace
 * under the digits instead of touching them, and its bottom edge stays inside
 * the 36px selected disc — which is drawn above the lane and swallows its own
 * dots. Both lane values are on Tailwind's own scale; the old 21px top was not,
 * which is why it had to be an inline style.
 *
 * ## The day marker
 *
 * One screen paints something other than the dot: the habits month draws a
 * completion *ring* around the number. That mark is not an item and cannot come
 * from `payload.days`, so the grid exposes one seam instead —
 * `renderDayMarker(date)` returns the node to paint, or `null` for none, and
 * `dayMarkerLabel(date)` adds the mark's meaning to the day button's accessible
 * name (the item count alone would say nothing there). Both are optional: a
 * caller that passes neither renders exactly what it always did.
 *
 * The seam is the disc's own box and nothing more. The marker layer is an
 * absolutely-positioned 36×36 box pinned to the top of the `[data-date]` cell and
 * centred horizontally — the disc's box by construction (the day stack's `pt-0.5`
 * cancels its own `-my-0.5`, so the disc starts at the cell's top edge) — painted
 * *above* the disc (`z-20` over the disc's `z-10`) so a ring still reads on the
 * selected and today fills. The layer is `pointer-events-none` and `aria-hidden`,
 * like the dot lane: decoration must never take the day button's tap.
 *
 * It is threaded into **all three panels** — the live month and both neighbours —
 * because the neighbouring months slide in during a drag; a ring that is only
 * drawn once the panel becomes current would pop in after the swipe.
 *
 * It never derives a date of its own: `days` is the server's padded day list for
 * the visible window, chunked into whole weeks by `buildMonthRows`, so the grid,
 * the agenda and the day sheet cannot disagree about which days a month
 * contains. Recurrence expansion, EXDATE handling and timed-overlap columns are
 * all absent here because the API already did them.
 *
 * Selecting a day and opening the day sheet are direct manipulation: a delay on
 * either reads as a dropped tap.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { addDaysToDateOnly, fromDateOnly } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { DateOnly } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { MONTH_COLUMNS, buildMonthRows, weekdayLabels } from './geometry';
import { MONTH_EXPANDED_PX, useMonthGestures } from './use-month-gestures';
import type { CalendarInteraction, CalendarLookup, CalendarPrefs, ItemOpenHandler, RescheduleHandler } from './types';

/** The days one committed collapsed swipe carries the selection. */
const DAYS_PER_WEEK = 7;

/** Diameter of the day disc, and of the tap target's min box. */
const DISC_PX = 36;
const TAP_MIN_PX = 40;
/** Diameter of the painted dot. */
const DOT_PX = 4;

/**
 * The day cell's vertical stack.
 *
 * The button is taller than the row it sits in: the visible row is 36px, the day
 * is a 40px tap target. The negative margin pays for it, so the grid does not
 * grow, and the 2px top padding keeps the circle off the row's top edge. Shared
 * with the static panels so a neighbouring month's numbers land on exactly the
 * same line as the current month's.
 */
const DAY_STACK_CLASS = '-my-0.5 flex min-h-10 w-full cursor-pointer flex-col items-center justify-start pt-0.5';

/**
 * The disc itself: one size for every state, so the month never re-lays-out.
 *
 * Colour, fill and ring only. The border is declared in every state (transparent
 * except for today) rather than added by the today state, which is what keeps
 * the glyph's box — and therefore the digit's position — identical in all four.
 */
const DISC_CLASS =
  'pointer-events-none relative z-10 flex size-9 shrink-0 items-center justify-center rounded-full border transition-colors duration-200';

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
  /**
   * Retained for both callers. The grid's dots are the theme's muted grey, not an
   * item's colour, so nothing here resolves a calendar any more — the agenda and
   * the day sheet are where a calendar's custom colour is painted.
   */
  calendars: CalendarLookup;
  interaction: CalendarInteraction;
  /** Selects a day (updates the agenda) without navigating. */
  onSelectDate: (date: DateOnly) => void;
  /** Opens the day detail sheet. */
  onOpenDay: (date: DateOnly) => void;
  /**
   * Retained for both callers, which pass their own open-item handler.
   *
   * The grid itself no longer opens anything: its dots are decoration (see "The
   * dots"), so the only item controls are the agenda's rows and the day sheet.
   * The props stay on the surface rather than being deleted under the habits
   * screen, which renders this grid and passes all three.
   */
  onOpenItem: ItemOpenHandler;
  /** Retained for both callers; the grid's dots are no longer draggable. */
  onReschedule: RescheduleHandler;
  /** Pages the month: `-1` previous, `+1` next. Called by a committed swipe. */
  onPage: (delta: number) => void;
  /** Reports the month the drag is showing, so the toolbar title can follow it. */
  onPagePreview: (delta: -1 | 0 | 1) => void;
  /** A per-day mark drawn around the day number; `null`/absent = none. */
  renderDayMarker?: (date: DateOnly) => ReactNode;
  /** Appended to the day button's accessible name; `null` = nothing appended. */
  dayMarkerLabel?: (date: DateOnly) => string | null;
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
  interaction,
  onSelectDate,
  onOpenDay,
  onPage,
  onPagePreview,
  renderDayMarker,
  dayMarkerLabel,
}: MonthGridProps) {
  const dayRefs = useRef(new Map<DateOnly, HTMLButtonElement>());
  /** The live month's lattice. The day buttons register into `dayRefs` from here. */
  const gridRef = useRef<HTMLDivElement>(null);
  const [focusDate, setFocusDate] = useState(selectedDate);
  const pendingFocus = useRef(false);

  const rows = useMemo(() => buildMonthRows(days, anchor), [days, anchor]);

  /** The week the collapsed strip must show: the one holding the selected day. */
  const focusRow = useMemo(() => {
    const index = rows.findIndex((row) => row.some((cell) => cell.date === selectedDate));
    return index >= 0 ? index : 0;
  }, [rows, selectedDate]);

  /*
   * One committed horizontal swipe moves **one week** while the strip is
   * collapsed and **one month** while the grid is expanded; the hook decides
   * which and calls the matching handler — see `./use-month-gestures`.
   *
   * A week is seven days of selection, which is what moves the strip: the row it
   * shows is derived from the selected day, so stepping the selection a week
   * steps the strip a row (and moves the caller's anchor month with it when the
   * week leaves the month). Routing it through `onSelectDate` is deliberate — it
   * is the one channel both screens already implement, the calendar's and the
   * habits screen's, and it carries exactly the rule a week step needs.
   */
  const { collapsed, viewportHeight, contentOffsetY, viewportRef, trackRef, toggle, handlers } = useMonthGestures({
    onPage,
    onPageWeek: (delta) => onSelectDate(addDaysToDateOnly(selectedDate, delta * DAYS_PER_WEEK, prefs.zone)),
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

  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
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
    <div
      /*
       * `touch-none` is the gesture contract: *touch* pans on this surface belong
       * to the two gestures, never to the page. The height and the track's
       * transform are written straight to the nodes by the hook.
       *
       * This is the surface, so it is also the node the pointer handlers and the
       * capturing click handler are spread onto. It carries no inset of its own —
       * no fill, no border and no rounding, so the grid sits on the page's own
       * background — while the clip inside it stays padding-free: padding on the
       * clip would move the page width the gesture measures. The horizontal
       * inset lives on the weekday header and on each panel.
       */
      className="flex min-h-0 shrink-0 touch-none flex-col overflow-hidden"
      {...handlers}
    >
      {/*
        Chrome, not content: the captions never slide with the lattice, and they
        are hidden from assistive tech because every day button already carries
        its full date name. No rule — the month is separated by whitespace.

        The captions carry the same horizontal inset as each panel (`px-4`), so
        the letters stay over the columns they label even as the gap between two
        months changes. See `MonthPanel`.
      */}
      <div aria-hidden className="grid shrink-0 grid-cols-7 px-4 pt-card pb-0.5">
        {headers.map((label, index) => (
          <span key={`${label}-${index}`} className="text-center text-xs leading-none text-muted-foreground/60">
            {label}
          </span>
        ))}
      </div>

      {/*
        The clip must stay padding-free: it is what the hook measures for one
        page and what it writes the strip's pixel height to. Its horizontal
        inset comes from the surface above it.
      */}
      <div>
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
              live={null}
              renderDayMarker={renderDayMarker}
              dayMarkerLabel={dayMarkerLabel}
            />

            <MonthPanel
              panel="current"
              page={{ days, anchor, payload }}
              selectedDate={selectedDate}
              today={today}
              prefs={prefs}
              gridRef={gridRef}
              live={{
                collapsed,
                focusDate,
                onKeyDown,
                onSelectDate,
                onOpenDay,
                registerDay: (date, node) => {
                  if (node) dayRefs.current.set(date, node);
                  else dayRefs.current.delete(date);
                },
              }}
              renderDayMarker={renderDayMarker}
              dayMarkerLabel={dayMarkerLabel}
            />

            <MonthPanel
              panel="next"
              page={next}
              selectedDate={selectedDate}
              today={today}
              prefs={prefs}
              live={null}
              renderDayMarker={renderDayMarker}
              dayMarkerLabel={dayMarkerLabel}
            />
          </div>
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
        className="flex h-5 w-full shrink-0 cursor-pointer items-center justify-center rounded-md"
      >
        <span aria-hidden className="h-1 w-9 rounded-full bg-border" />
      </button>
    </div>
  );
}

/**
 * What the live month needs and a neighbouring one does not.
 *
 * Only the settled month is interactive: the two beside it are pictures of where
 * the finger is taking the grid, so they take no focus and no taps.
 */
interface LivePanelProps {
  collapsed: boolean;
  focusDate: DateOnly;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onSelectDate: (date: DateOnly) => void;
  onOpenDay: (date: DateOnly) => void;
  /** Registers a day button for the roving focus. */
  registerDay: (date: DateOnly, node: HTMLButtonElement | null) => void;
}

interface MonthPanelProps {
  /** Which slot of the three-wide track this is. */
  panel: 'previous' | 'current' | 'next';
  page: MonthPage;
  selectedDate: DateOnly;
  today: DateOnly;
  prefs: CalendarPrefs;
  /** Set for the live month only; `null` makes the panel presentational. */
  live: LivePanelProps | null;
  /** The live month's lattice, which the roving focus registers into. */
  gridRef?: React.RefObject<HTMLDivElement | null>;
  /** A per-day mark around the number; drawn for neighbours as well as the live month. */
  renderDayMarker?: (date: DateOnly) => ReactNode;
  /** Appended to the live month's day button name; neighbours are not controls. */
  dayMarkerLabel?: (date: DateOnly) => string | null;
}

/**
 * One month of the track.
 *
 * The same cells, in the same lattice, for all three panels: a neighbouring month
 * has to be indistinguishable from the current one while it slides in, so the
 * only difference is that its days are not controls. `buildMonthRows` did the
 * chunking, so a panel never decides for itself which days it holds.
 *
 * The panel is `w-1/3` of the track (one clip width) and its inner lattice is
 * seven equal columns of what the inset leaves. The *wrapper* carries the
 * horizontal `px-4` that keeps the cells off the seam and doubles as the visible
 * page gap; a flex `gap` between panels would widen the stride the hook measures
 * a page against, so the gap is padding and the stride stays one clip width.
 *
 * The opacity is the settled half of the paging cross-fade: the current month is
 * opaque and the two a page away are not — see the "Paging is a track" note. The
 * hook overwrites both per frame while a drag is in flight.
 */
function MonthPanel({ panel, page, selectedDate, today, prefs, live, gridRef, renderDayMarker, dayMarkerLabel }: MonthPanelProps) {
  const rows = useMemo(() => buildMonthRows(page.days, page.anchor), [page.days, page.anchor]);
  const isCurrent = panel === 'current';

  return (
    <div
      data-month-panel={panel}
      className={cn('w-1/3 shrink-0 select-none px-4', isCurrent ? 'opacity-100' : 'opacity-0')}
    >
      <div
        ref={gridRef}
        role={live ? 'grid' : undefined}
        aria-label={live ? (live.collapsed ? 'Week' : 'Month') : undefined}
        aria-hidden={live ? undefined : true}
        onKeyDown={live?.onKeyDown}
        className="grid w-full grid-cols-7"
        style={{ height: MONTH_EXPANDED_PX, gridTemplateRows: `repeat(${Math.max(rows.length, 1)}, minmax(0, 1fr))` }}
      >
        {rows.map((row, rowIndex) => (
          <div key={rowIndex} role={live ? 'row' : undefined} className="contents">
            {row.map((cell) => {
              const dayItems = page.payload.days[cell.date] ?? [];
              const isSelected = cell.date === selectedDate;
              const isToday = cell.date === today;
              /* The seam: a caller-supplied mark for this day, or nothing. */
              const marker = renderDayMarker?.(cell.date) ?? null;

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
                      markerLabel={dayMarkerLabel?.(cell.date) ?? null}
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
                    <span className={DAY_STACK_CLASS}>
                      <DayNumberFace date={cell.date} inMonth={cell.inMonth} isSelected={isSelected} isToday={isToday} />
                    </span>
                  )}

                  {/*
                    The dot lane.

                    Fixed height and absolutely placed so it adds no height to
                    the row and every day's dot sits on the same line. One dot,
                    and only ever one, whatever the day holds: the lane answers
                    "is anything happening that day?", and the count is in the
                    day's accessible name, in the agenda and in the day sheet.
                    A cluster of up to three turned the lane back into the bar
                    chart the dots replaced.

                    It is *decoration*. The lane and the dot are both
                    `pointer-events-none`, and the dot is a plain `aria-hidden`
                    span — no button, no `tabindex`, no label, no handler — so it
                    can neither be focused nor tapped, and it cannot sit above
                    the day cell's own hit area. A tap where a dot is drawn
                    selects the day, exactly as a tap on the number does.

                    `top-6` (24px) is the breathing room under the digits: the
                    day number's 14px line box ends 25px down, so the 4px dot —
                    centred in the 12px lane — leaves a clear gap under the glyphs
                    instead of touching them. It still sits inside the 36px
                    selected disc, which is painted above the lane and swallows
                    its own dots. On Tailwind's own scale, so neither value needs
                    an inline style.
                  */}
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-x-0 top-6 flex h-3 items-center justify-center"
                  >
                    {dayItems.length > 0 ? <DotMark /> : null}
                  </span>

                  {/*
                    The day-marker layer — see "The day marker".

                    The disc's own 36×36 box: pinned to the cell's top edge and
                    centred horizontally, which is exactly where the disc sits
                    (the day stack's `pt-0.5` cancels its `-my-0.5`). `z-20` puts
                    it above the disc's `z-10`, so a caller's ring is painted on
                    the selected and today fills rather than under them, and
                    `pointer-events-none` + `aria-hidden` keep it decoration:
                    the day button below keeps its whole hit area and its own
                    accessible name (which `dayMarkerLabel` feeds).

                    Rendered for every panel and every non-null mark, so a
                    neighbouring month arrives already drawn.
                  */}
                  {marker ? (
                    <span
                      aria-hidden
                      className="pointer-events-none absolute top-0 left-1/2 z-20 flex size-9 -translate-x-1/2 items-center justify-center"
                    >
                      {marker}
                    </span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ))}
      </div>
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
  /** The day marker's meaning, appended to the accessible name; `null` = none. */
  markerLabel: string | null;
  /** The full accessible date name the button announces. */
  fullLabel: string;
  tabIndex: number;
  registerRef: (node: HTMLButtonElement | null) => void;
  activate: () => void;
}

/**
 * The day number as one real button.
 *
 * The item count is in the accessible name rather than on screen — a "3" in a
 * 55px cell is exactly the noise the dots replaced — so a screen reader still
 * hears everything the day holds.
 *
 * The circle is one size for every state, so the month never re-lays-out as the
 * selection moves. It is drawn *above* the dot lane (`z-10`) and made
 * `pointer-events-none`, so it covers the dots that fall inside it without ever
 * taking their day's tap.
 */
function DayNumber({
  date,
  inMonth,
  isSelected,
  isToday,
  itemCount,
  markerLabel,
  fullLabel,
  tabIndex,
  registerRef,
  activate,
}: DayNumberProps) {
  /*
   * The name is the date, then the count the dots cannot spell out, then — on a
   * screen whose cells carry no items at all — whatever the day marker means.
   * Appending only when there is something to append is what keeps this byte
   * identical for the calendar screen, which passes no `dayMarkerLabel`.
   */
  const itemLabel = itemCount > 0 ? `${fullLabel}, ${itemCount} ${itemCount === 1 ? 'item' : 'items'}` : fullLabel;

  return (
    <button
      ref={registerRef}
      type="button"
      tabIndex={tabIndex}
      aria-current={isToday ? 'date' : undefined}
      aria-label={markerLabel ? `${itemLabel}, ${markerLabel}` : itemLabel}
      onClick={(event) => {
        event.stopPropagation();
        activate();
      }}
      className={DAY_STACK_CLASS}
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
 * It is a 36px flex box and the glyph is centred in it, so the number's box and
 * the circle share a centre by construction. The nudge this replaced —
 * `justify-content: flex-start` plus a 5px top padding — dated from a resize of
 * the circle and left every digit sitting high in its disc.
 *
 * Selection fades between fill, ring and tint over a fifth of a second, which is
 * what `transition-colors` is here for; only the colours change, so the grid
 * never re-lays-out when the selection moves. It is the feature's one colour
 * fade, and its duration is stated on the same scale (`duration-200`, which is
 * the 200ms `tw-animate-css` animates its own enter/exit fades over) so every
 * timed fade in the calendar shares one vocabulary.
 */
function DayNumberFace({ date, inMonth, isSelected, isToday }: DayNumberFaceProps) {
  return (
    <span
      className={cn(
        DISC_CLASS,
        isSelected
          ? 'border-transparent bg-primary text-primary-foreground'
          : isToday
            ? // Card-coloured with a hairline accent ring: a plain card-coloured
              // circle would vanish on a card in light appearance.
              'border-primary bg-background text-primary'
            : inMonth
              ? 'border-transparent text-foreground'
              : 'border-transparent text-muted-foreground/60',
      )}
    >
      <span className={cn('text-sm leading-none tabular-nums', (isSelected || isToday) && 'font-semibold')}>
        {Number(date.slice(8, 10))}
      </span>
    </span>
  );
}

/**
 * The dot itself: one mark, in the theme's muted foreground.
 *
 * It used to be the item's accent colour, with up to three of them — which made
 * a monochrome surface the most saturated thing on the screen and turned the
 * lane into a bar chart. Celestial Sapphire says "something is here" with
 * contrast, not hue, so the dot is the muted foreground rather than a literal
 * grey: the token is what keeps it legible in both appearances (a mid grey on
 * white, a lighter one on near-black) without carrying a colour of its own.
 *
 * It is a *quiet* indicator, so it is deliberately low-prominence: 4px (`size-1`)
 * and the muted foreground at half opacity (`/50`), down from 6px at `/70`. The
 * lane answers "is anything happening that day?" in the user's peripheral
 * vision; at the old size and weight it read as a headline and drew the eye
 * away from the day number and the selection, which are the controls. The tone
 * still sits on the same token, so it tracks both appearances with the rest of
 * the muted foreground — nothing here introduces a colour of its own, and this
 * is the one line to change if the intent was read backwards.
 *
 * `aria-hidden` and `pointer-events-none`: decoration, so it is invisible to a
 * screen reader and untouchable to a finger — the day cell underneath keeps its
 * whole hit area. The day button's accessible name carries the item count.
 */
function DotMark() {
  return <span aria-hidden className="pointer-events-none size-1 rounded-full bg-muted-foreground/50" />;
}
