'use client';

/**
 * The habits screen's month: the calendar screen's own `MonthGrid`, opened on
 * the week and carrying habit completions alone.
 *
 * ## Why the calendar grid rather than a habit-specific one
 *
 * The month is the same surface on both screens, so the habits screen imports
 * `MonthGrid` unchanged — the same lattice, the same two gestures, the same
 * server-shaped `days`. Nothing about dates is re-derived here: the grid is
 * handed the window `rangeForView` describes and nothing else.
 *
 * The grid is collapsed on open. `MonthGrid`'s collapse state is internal (the
 * gesture hook starts expanded so the calendar opens on the month), so the
 * habits screen activates the grid's own "Collapse to a week" grabber once, as
 * soon as the grid mounts. That is the very control a user would press — it is
 * not a reach into the calendar feature's internals — and it is why the click
 * only fires while the control still reads "Collapse to a week", so a future
 * `MonthGrid` that can start collapsed on its own simply no-ops it.
 *
 * ## No events here, and no dots at all
 *
 * This screen used to read `/api/calendar/items` exactly as `CalendarScreen`
 * does — the visible month *and* the two months the paging track draws — and the
 * grid painted its dot on any day that payload held anything: an event, a task,
 * or a habit completion, all in the same grey mark. An event is not a habit. A
 * day that is merely busy is not a day the habit was kept, and no mark on this
 * screen may mean "something happened" when the screen's one question is "was
 * the habit kept?".
 *
 * So the reads are gone (three requests with them), the payload the grid paints
 * is empty, and the grid paints no dots. What is left is the day numbers — and
 * the completion ring.
 *
 * ## The ring, on the grid's new seam
 *
 * A day on which at least one habit was completed carries a ring around its
 * number, sectioned into one arc per habit. The ring is painted *inside*
 * `MonthGrid`'s day cell, so the grid exposes a seam for a per-day mark —
 * `renderDayMarker(date)` / `dayMarkerLabel(date)` — and this screen is its only
 * caller. `habitRingSegments` turns the habits the screen already loads into one
 * count per completed day (no second read: the list is the only request this
 * screen makes), `HabitDayRing` draws the arcs, and the label rides on the day
 * button's accessible name so a completed day is not silent to a screen reader.
 *
 * The seam is threaded into all three of the grid's panels, so a neighbouring
 * month sliding in under a paging swipe arrives already drawn rather than popping
 * a ring in after the swipe.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MonthGrid,
  createInteraction,
  type CalendarInteraction,
  type CalendarLookup,
  type CalendarPrefs,
  type MonthPage,
} from '@/components/calendar';
import { fromDateOnly, rangeForView, shiftViewAnchor } from '@/lib/dates';
import { cn } from '@/lib/utils';
import type { DateOnly, Habit } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { HabitDayRing } from './HabitDayRing';
import { habitRingSegments } from './period';

/** The label of the grabber while the grid is expanded — see the file header. */
const COLLAPSE_LABEL = 'Collapse to a week';

/**
 * What the grid paints: nothing.
 *
 * The habits month shows habit completions, and those are the ring — so every
 * cell's item list is empty by construction and no dot can be drawn from it. An
 * empty payload is also what keeps the calendar's own items out of this screen
 * without the grid needing to know which screen it is on.
 */
const NO_ITEMS: CalendarItemsPayload = { items: [], calendars: [], days: {} };

/** The grid's `calendars` prop: nothing on this screen resolves an item's colour. */
const NO_CALENDARS: CalendarLookup = new Map();

export interface HabitMonthGridProps {
  /**
   * The habits the screen already loaded — the ring's only input.
   *
   * The month paints no items (see "No events here"), so it reads nothing of its
   * own: it turns this list's `entries`/`doneToday` into one ring per day with
   * `habitRingSegments`, the same rule the check-in control and the list use.
   */
  habits: readonly Habit[];
  /** A day inside the month being displayed. */
  anchor: DateOnly;
  /** The selected day; the collapsed strip shows the week that holds it. */
  selectedDate: DateOnly;
  /** Today, in the user's timezone. */
  today: DateOnly;
  zone: string;
  weekStartsOn: number;
  timeFormat: '12h' | '24h';
  /** Selects a day, which scopes the habit list below. */
  onSelectDate: (date: DateOnly) => void;
  /** Pages the period: `-1` previous month, `+1` next month. */
  onPage: (delta: number) => void;
  className?: string;
}

export function HabitMonthGrid({
  habits,
  anchor,
  selectedDate,
  today,
  zone,
  weekStartsOn,
  timeFormat,
  onSelectDate,
  onPage,
  className,
}: HabitMonthGridProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  // One shared gesture record, as the calendar screen has: the paging swipe and
  // an item drag would otherwise both claim the same surface. Nothing on this
  // screen is draggable, but the grid's contract is a single record either way.
  const [interaction] = useState<CalendarInteraction>(createInteraction);
  const [pageSeq, setPageSeq] = useState(0);
  const [preview, setPreview] = useState<-1 | 0 | 1>(0);

  const prefs: CalendarPrefs = useMemo(
    () => ({ zone, weekStartsOn, timeFormat }),
    [zone, weekStartsOn, timeFormat],
  );

  const range = useMemo(
    () => rangeForView('month', anchor, zone, weekStartsOn),
    [anchor, zone, weekStartsOn],
  );

  /*
   * The visible month and the two the paging track draws beside it, as pages of
   * the same shape the calendar screen builds — days and an anchor, with an
   * empty payload. Their windows are stepped through `lib/dates`, the client
   * never doing more date arithmetic than "the month before this one".
   */
  const neighbours = useMemo(
    () =>
      ([-1, 1] as const).map((delta) => {
        const neighbourAnchor = shiftViewAnchor('month', anchor, delta, zone);
        return {
          anchor: neighbourAnchor,
          range: rangeForView('month', neighbourAnchor, zone, weekStartsOn),
        };
      }),
    [anchor, zone, weekStartsOn],
  );

  const previousPage = useMemo<MonthPage>(
    () => ({ days: neighbours[0].range.days, anchor: neighbours[0].anchor, payload: NO_ITEMS }),
    [neighbours],
  );

  const nextPage = useMemo<MonthPage>(
    () => ({ days: neighbours[1].range.days, anchor: neighbours[1].anchor, payload: NO_ITEMS }),
    [neighbours],
  );

  /*
   * The ring data: one completed-habit count per day, for every day any of the
   * three panels can paint.
   *
   * The union matters for the paging track. A day that gets its ring from this
   * map is drawn identically in whichever panel holds it, and the two neighbours
   * are computed from the same list as the live month — so a neighbouring month
   * sliding in under a drag arrives already ringed instead of popping one in
   * afterwards. The keys come from the panels' own `days` (the server's windows),
   * so a ring can never land on a cell the grid does not hold.
   */
  const rings = useMemo(
    () =>
      habitRingSegments(
        habits,
        [...range.days, ...neighbours[0].range.days, ...neighbours[1].range.days],
        today,
      ),
    [habits, range, neighbours, today],
  );

  /*
   * The mark itself: a ring with one section per completed habit, or nothing.
   *
   * The colour is chosen against the day cell's own state. A plain or "today"
   * disc is the page background, where the ring's default `text-muted-foreground`
   * is the legible token — the same grey the calendar's dots were toned down to.
   * The selected disc is filled with `bg-primary`, where that grey all but
   * vanishes in dark appearance, so there the ring takes `text-primary-foreground`:
   * the token whose entire job is to contrast with the `primary` fill (it is what
   * the selected day number is painted in). Still monochrome, still no hue — just
   * the fill's own opposite.
   */
  const renderDayMarker = useCallback(
    (date: DateOnly) => {
      const segments = rings.get(date);
      if (!segments) return null;
      return (
        <HabitDayRing
          segments={segments}
          className={date === selectedDate ? 'text-primary-foreground' : undefined}
        />
      );
    },
    [rings, selectedDate],
  );

  /*
   * The ring in words, for the day button's accessible name.
   *
   * The grid's own name is the date plus the payload's item count, and on this
   * screen the payload is deliberately empty — so without this a day the user
   * kept every habit on would announce nothing but its date. One habit is
   * singular; the count is never capped, for the same reason the ring is not
   * (two habits and five must not read alike).
   */
  const dayMarkerLabel = useCallback(
    (date: DateOnly) => {
      const segments = rings.get(date);
      if (!segments) return null;
      return segments === 1 ? '1 habit completed' : `${segments} habits completed`;
    },
    [rings],
  );

  /*
   * Open the grid on the week.
   *
   * `MonthGrid` starts expanded, so this screen presses its own collapse control
   * the moment the grid is on screen — see the file header for why this is a
   * click and not an edit. The ref makes it once per mount: an effect that ran
   * twice (a development double-invoke) would otherwise press the grabber again,
   * which by then reads "Expand the month" and would toggle the grid straight
   * back open.
   */
  const collapsedOnce = useRef(false);
  useEffect(() => {
    if (collapsedOnce.current) return;
    const grabber = hostRef.current?.querySelector<HTMLButtonElement>(`button[aria-label="${COLLAPSE_LABEL}"]`);
    if (!grabber) return;
    collapsedOnce.current = true;
    grabber.click();
  }, []);

  const handlePage = useCallback(
    (delta: number) => {
      if (delta !== 0) setPageSeq((value) => value + 1);
      onPage(delta);
    },
    [onPage],
  );

  /*
   * The grid's item props, inert.
   *
   * Both are required by `MonthGrid` and both belong to the calendar screen: a
   * day's items are opened and rescheduled there, and this screen paints none to
   * begin with (see "No events here"). Tapping a day — the grid's `onSelectDate`
   * — is the only interaction this month has, and it scopes the list below.
   */
  const ignoreItem = useCallback(() => undefined, []);

  const monthLabel = useMemo(
    () => fromDateOnly(shiftViewAnchor('month', anchor, preview, zone), zone).toFormat('LLLL yyyy'),
    [anchor, preview, zone],
  );

  return (
    <div ref={hostRef} className={cn('flex min-h-0 shrink-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        {/* The month under the finger, named while the drag is in flight. */}
        <h2 aria-live="polite" className="text-sm font-semibold">
          {monthLabel}
        </h2>
      </div>

      <MonthGrid
        days={range.days}
        anchor={anchor}
        previous={previousPage}
        next={nextPage}
        selectedDate={selectedDate}
        today={today}
        pageSeq={pageSeq}
        payload={NO_ITEMS}
        prefs={prefs}
        calendars={NO_CALENDARS}
        interaction={interaction}
        onSelectDate={onSelectDate}
        onOpenDay={onSelectDate}
        onOpenItem={ignoreItem}
        onReschedule={ignoreItem}
        onPage={handlePage}
        onPagePreview={setPreview}
        renderDayMarker={renderDayMarker}
        dayMarkerLabel={dayMarkerLabel}
      />
    </div>
  );
}
