'use client';

/**
 * The habits screen's month: the calendar screen's own `MonthGrid`, opened on
 * the week and carrying habit completions beside the calendar's dots.
 *
 * ## Why the calendar grid rather than a habit-specific one
 *
 * The month is the same surface on both screens, so the habits screen imports
 * `MonthGrid` unchanged — the same lattice, the same two gestures, the same
 * server-provided `days`. Nothing about dates is re-derived here: the events
 * come from `GET /api/calendar/items` (recurrence expanded and bucketed
 * server-side), read through the app's own resource store exactly as
 * `CalendarScreen` reads it, and handed to the grid as-is.
 *
 * The grid is collapsed on open. `MonthGrid`'s collapse state is internal
 * (the gesture hook starts expanded so the calendar opens on the month), so the
 * habits screen activates the grid's own "Collapse to a week" grabber once, as
 * soon as the grid mounts. That is the very control a user would press — it is
 * not a reach into the calendar feature's internals — and it is why the click
 * only fires while the control still reads "Collapse to a week", so a future
 * `MonthGrid` that can start collapsed on its own simply no-ops it.
 *
 * ## Habit completions on the month
 *
 * A day on which at least one habit was completed gets one extra dot. The
 * server's `entries` map is the source (`habitDoneOn`), never a local
 * re-count, and the marker is injected into the same `days` buckets the grid
 * already paints — the one seam `MonthGrid` exposes without being edited.
 *
 * A dot from the calendar and a habit mark are told apart two ways at once:
 *
 *   · **one per day, always first.** A day's habit mark is a single dot no
 *     matter how many habits were completed, so the lane stays a summary and
 *     never turns into a per-habit bar chart. It is placed before the event
 *     dots, so the screen's own subject keeps its slot.
 *   · **neutral and muted.** The mark uses the Graphite accent and the
 *     `completed` flag, which `MonthGrid` paints at 60% opacity; calendar
 *     dots keep their calendar's accent at full strength. A full-strength
 *     coloured dot is an event or a task, a muted grey one is a habit.
 *
 * The legend beside the month name states exactly that. A habit mark is
 * `readonly`, so no drag can ever reschedule anything from this screen, and a
 * tap on one simply scopes the list to its day. Tapping a calendar dot opens
 * that day on the calendar screen, which is where its editor lives.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAppearance } from '@/app/providers';
import {
  MonthGrid,
  createInteraction,
  type CalendarInteraction,
  type CalendarLookup,
  type CalendarPrefs,
  type MonthPage,
} from '@/components/calendar';
import { Skeleton } from '@/components/ui/skeleton';
import { accentHex } from '@/lib/colors';
import { addDaysToDateOnly, dateOnlyToMillis, fromDateOnly, rangeForView, shiftViewAnchor, toDateOnly } from '@/lib/dates';
import { useResource } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { CalendarItem, DateOnly, Habit } from '@/lib/types';
import type { CalendarItemsPayload } from '@/lib/view-types';
import { habitDoneOn } from './period';

/** The label of the grabber while the grid is expanded — see the file header. */
const COLLAPSE_LABEL = 'Collapse to a week';

export interface HabitMonthGridProps {
  /** A day inside the month being displayed. */
  anchor: DateOnly;
  /** The selected day; the collapsed strip shows the week that holds it. */
  selectedDate: DateOnly;
  /** Today, in the user's timezone. */
  today: DateOnly;
  zone: string;
  weekStartsOn: number;
  timeFormat: '12h' | '24h';
  /** Habits with the server's `entries` for the visible window. */
  habits: readonly Habit[];
  /** Selects a day, which scopes the habit list below. */
  onSelectDate: (date: DateOnly) => void;
  /** Pages the period: `-1` previous month, `+1` next month. */
  onPage: (delta: number) => void;
  className?: string;
}

/**
 * One habit-completion mark for `date`, shaped as a calendar item so the month
 * grid can paint it without knowing habits exist.
 *
 * `completed` is what mutes it; `readonly` is what keeps `useItemDrag` from
 * ever lifting it. The title is only read by assistive tech — the grid renders
 * no labels — so it says plainly what the dot is.
 */
function habitMarker(habitCount: number, date: DateOnly, zone: string): CalendarItem {
  const startMs = dateOnlyToMillis(date, zone);
  return {
    key: `habit:${date}`,
    kind: 'task',
    id: `habit:${date}`,
    title: `${habitCount} habit${habitCount === 1 ? '' : 's'} completed`,
    startMs,
    endMs: dateOnlyToMillis(addDaysToDateOnly(date, 1, zone), zone),
    isAllDay: true,
    color: 'gray',
    calendarId: null,
    completed: true,
    readonly: true,
  };
}

/**
 * Adds one habit mark to every day of `days` on which a habit was completed.
 *
 * `days` is the server-padded window the grid renders, not the bucket keys:
 * `groupItemsByDay` only creates a key for a day that already has an item, so a
 * day whose only event is a completion would otherwise be skipped.
 */
function withHabitMarks(
  payload: CalendarItemsPayload,
  days: readonly DateOnly[],
  habits: readonly Habit[],
  zone: string,
  today: DateOnly,
): CalendarItemsPayload {
  if (habits.length === 0) return payload;

  const buckets: Record<string, CalendarItem[]> = { ...payload.days };
  const marks: CalendarItem[] = [];

  for (const date of days) {
    const done = habits.reduce((count, habit) => (habitDoneOn(habit, date, today) ? count + 1 : count), 0);
    if (done === 0) continue;
    const mark = habitMarker(done, date, zone);
    marks.push(mark);
    buckets[date] = [mark, ...(buckets[date] ?? [])];
  }

  if (marks.length === 0) return payload;
  return { ...payload, days: buckets, items: [...payload.items, ...marks] };
}

export function HabitMonthGrid({
  anchor,
  selectedDate,
  today,
  zone,
  weekStartsOn,
  timeFormat,
  habits,
  onSelectDate,
  onPage,
  className,
}: HabitMonthGridProps) {
  const router = useRouter();
  const dark = useAppearance().resolvedTheme === 'dark';
  const hostRef = useRef<HTMLDivElement>(null);

  // One shared gesture record, as the calendar screen has: the paging swipe and
  // an item drag would otherwise both claim the same surface.
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

  // The visible month, read exactly the way `CalendarScreen` reads it: the
  // server expands recurrence and buckets the days, so the grid only paints.
  const resource = useResource<CalendarItemsPayload>('/api/calendar/items', {
    startMs: range.startMs,
    endMs: range.endMs,
  });

  /*
   * The two months either side, drawn in the paging track so a swipe shows the
   * month it is dragging to. Asked for only once the current month is in, so a
   * first load is still one request.
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

  const neighboursEnabled = Boolean(resource.data) && !resource.isLoading;
  const neighbourOptions = { enabled: neighboursEnabled, staleAfterMs: 60_000, revalidateOnFocus: false } as const;

  const previousItems = useResource<CalendarItemsPayload>(
    '/api/calendar/items',
    { startMs: neighbours[0].range.startMs, endMs: neighbours[0].range.endMs },
    neighbourOptions,
  );
  const nextItems = useResource<CalendarItemsPayload>(
    '/api/calendar/items',
    { startMs: neighbours[1].range.startMs, endMs: neighbours[1].range.endMs },
    neighbourOptions,
  );

  const calendars = resource.data?.calendars ?? [];
  const calendarLookup: CalendarLookup = useMemo(
    () => new Map(calendars.map((calendar) => [calendar.id, calendar])),
    [calendars],
  );
  const emptyPayload = useMemo<CalendarItemsPayload>(
    () => ({ items: [], calendars, days: {} }),
    [calendars],
  );

  const current = useMemo(
    () => (resource.data ? withHabitMarks(resource.data, range.days, habits, zone, today) : null),
    [resource.data, range.days, habits, zone, today],
  );

  const previousPage = useMemo<MonthPage>(
    () => ({
      days: neighbours[0].range.days,
      anchor: neighbours[0].anchor,
      payload: previousItems.data
        ? withHabitMarks(previousItems.data, neighbours[0].range.days, habits, zone, today)
        : emptyPayload,
    }),
    [neighbours, previousItems.data, emptyPayload, habits, zone, today],
  );

  const nextPage = useMemo<MonthPage>(
    () => ({
      days: neighbours[1].range.days,
      anchor: neighbours[1].anchor,
      payload: nextItems.data
        ? withHabitMarks(nextItems.data, neighbours[1].range.days, habits, zone, today)
        : emptyPayload,
    }),
    [neighbours, nextItems.data, emptyPayload, habits, zone, today],
  );

  /*
   * Open the grid on the week. `MonthGrid` starts expanded, so the habits
   * screen presses its own collapse control the moment the grid is on screen —
   * see the file header for why this is a click and not an edit.
   */
  const mounted = Boolean(current);
  useEffect(() => {
    if (!mounted) return;
    hostRef.current
      ?.querySelector<HTMLButtonElement>(`button[aria-label="${COLLAPSE_LABEL}"]`)
      ?.click();
  }, [mounted]);

  const handlePage = useCallback(
    (delta: number) => {
      if (delta !== 0) setPageSeq((value) => value + 1);
      onPage(delta);
    },
    [onPage],
  );

  const handleOpenItem = useCallback(
    (item: CalendarItem) => {
      const date = toDateOnly(item.startMs, zone);
      // A habit mark is not a calendar object; tapping it scopes the list.
      if (item.key.startsWith('habit:')) {
        onSelectDate(date);
        return;
      }
      // Events and tasks live on the calendar screen, which owns their editors.
      router.push(`/calendar?date=${date}`);
    },
    [onSelectDate, router, zone],
  );

  // Nothing here may reschedule: every item is handed to the grid `readonly`.
  const handleReschedule = useCallback(() => undefined, []);

  const monthLabel = useMemo(
    () => fromDateOnly(shiftViewAnchor('month', anchor, preview, zone), zone).toFormat('LLLL yyyy'),
    [anchor, preview, zone],
  );

  return (
    <div ref={hostRef} className={cn('flex min-h-0 shrink-0 flex-col', className)}>
      <div className="flex items-center justify-between gap-2 px-2 pb-1">
        <h2 aria-live="polite" className="text-sm font-semibold">
          {monthLabel}
        </h2>
        {/* The key to the two kinds of dot, so neither has to be guessed. */}
        <p className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <span
            aria-hidden
            className="size-1.5 rounded-full opacity-60"
            style={{ backgroundColor: accentHex('gray', dark) }}
          />
          Habit
          <span
            aria-hidden
            className="ml-1 size-1.5 rounded-full"
            style={{ backgroundColor: accentHex('blue', dark) }}
          />
          Event
        </p>
      </div>

      {current ? (
        <MonthGrid
          days={range.days}
          anchor={anchor}
          previous={previousPage}
          next={nextPage}
          selectedDate={selectedDate}
          today={today}
          pageSeq={pageSeq}
          payload={current}
          prefs={prefs}
          calendars={calendarLookup}
          interaction={interaction}
          onSelectDate={onSelectDate}
          onOpenDay={onSelectDate}
          onOpenItem={handleOpenItem}
          onReschedule={handleReschedule}
          onPage={handlePage}
          onPagePreview={setPreview}
        />
      ) : resource.error ? (
        <p role="alert" className="px-2 py-4 text-center text-sm text-muted-foreground">
          Could not load the month
        </p>
      ) : (
        <div className="flex flex-col gap-1 px-2" aria-busy>
          <div className="grid grid-cols-7 gap-0.5">
            {Array.from({ length: 7 }, (_, index) => (
              <Skeleton key={index} className="h-6 rounded-md" />
            ))}
          </div>
          <Skeleton className="h-9 rounded-md" />
        </div>
      )}
    </div>
  );
}
