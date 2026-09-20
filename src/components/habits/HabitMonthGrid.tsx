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
 * The grid is collapsed on open, and it is collapsed on its *first paint*.
 * `MonthGrid` takes an `initialCollapsed` prop and seeds it straight into the
 * gesture hook's collapse state, so the grid is born as the one-week strip
 * rather than rendering the full month and animating shut. Nothing is clicked
 * and no effect runs — there is no expanded frame for the arrival to animate
 * away from. The calendar screen leaves the prop false and still opens on the
 * month.
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
 * number, sectioned into one arc per habit and stroked in each habit's own
 * colour. The ring is painted *inside* `MonthGrid`'s day cell, so the grid
 * exposes a seam for a per-day mark — `renderDayMarker(date)` /
 * `dayMarkerLabel(date)` — and this screen is its only caller.
 * `habitRingColours` turns the habits the screen already loads into one colour
 * list per completed day (no second read: the list is the only request this
 * screen makes), `HabitDayRing` draws the arcs, and the label rides on the day
 * button's accessible name so a completed day is not silent to a screen reader.
 *
 * The seam is threaded into all three of the grid's panels, so a neighbouring
 * month sliding in under a paging swipe arrives already drawn rather than popping
 * a ring in after the swipe.
 */
import { useCallback, useMemo, useState } from 'react';
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
import type { AccentColor, DateOnly, Habit } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { HabitDayRing } from './HabitDayRing';
import { habitRingColours } from './period';

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

/**
 * A day with no ring, as a stable reference.
 *
 * Shared rather than `[]` per call so that the memoised `HabitDayRing` sees the
 * same prop on every render and skips the days that have not changed.
 */
const NO_COLOURS: readonly AccentColor[] = [];

export interface HabitMonthGridProps {
  /**
   * The habits the screen already loaded — the ring's only input.
   *
   * The month paints no items (see "No events here"), so it reads nothing of its
   * own: it turns this list's `entries`/`doneToday` into one ring per day with
   * `habitRingColours`, the same rule the check-in control and the list use —
   * only colouring the ring's arcs rather than counting them.
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
   * The ring data: the habits completed on each day, one accent per habit, for
   * every day any of the three panels can paint.
   *
   * The union matters for the paging track. A day that gets its ring from this
   * map is drawn identically in whichever panel holds it, and the two neighbours
   * are computed from the same list as the live month — so a neighbouring month
   * sliding in under a drag arrives already ringed instead of popping one in
   * afterwards. The keys come from the panels' own `days` (the server's windows),
   * so a ring can never land on a cell the grid does not hold.
   */
  const ringColours = useMemo(
    () =>
      habitRingColours(
        habits,
        [...range.days, ...neighbours[0].range.days, ...neighbours[1].range.days],
        today,
      ),
    [habits, range, neighbours, today],
  );

  /*
   * The mark itself: a ring with one coloured arc per completed habit, or
   * nothing drawn.
   *
   * The colour is the habit's, resolved in `HabitDayRing` — the ring encodes
   * which habits were kept, so a day with three habits reads as three
   * identifiable segments. There is deliberately no per-day-state tint here any
   * more: the old monochrome ring borrowed `text-primary-foreground` on the
   * selected day to stay legible on the filled disc, and an override in any
   * direction would recolour the very information the arcs now carry.
   *
   * The ring component is mounted on **every** day, with `NO_COLOURS` for the
   * days that have none. That is not waste — it is the only way the exit can
   * exist: an arc drawn by a component the parent has just removed pops out
   * instead of retracting, and taking a completion back is exactly when the user
   * is watching the day they just unchecked. An empty ring renders no DOM (its
   * `AnimatePresence` has no children), and the shared `NO_COLOURS` array keeps
   * the memoised component from re-rendering on every grid render.
   */
  const renderDayMarker = useCallback(
    (date: DateOnly) => <HabitDayRing colours={ringColours.get(date) ?? NO_COLOURS} />,
    [ringColours],
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
      const colours = ringColours.get(date);
      if (!colours) return null;
      return colours.length === 1 ? '1 habit completed' : `${colours.length} habits completed`;
    },
    [ringColours],
  );

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
    <div className={cn('flex min-h-0 shrink-0 flex-col', className)}>
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
        /* Born as the one-week strip: `initialCollapsed` seeds the gesture
           hook's state, so the arrival has no expanded frame to animate away
           from. */
        initialCollapsed
        /* The ring is painted *around* the disc, so the today/selected fill is
           inset to leave a gap for it — the calendar screen, which has no ring,
           keeps its full-size disc. */
        dayMarkerInset
      />
    </div>
  );
}
