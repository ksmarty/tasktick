'use client';

/**
 * Habits: check in, see the streaks, and read the month back.
 *
 * The layout is: the calendar screen's own month grid as the pinned top —
 * opened on the week, so the screen still leads with a single week — then one
 * card per habit (check-in control, glyph, name, right-aligned streak). Selecting
 * a day on the grid scopes the cards to it, so the calendar and the list cannot
 * disagree about which day is being checked in.
 *
 * The page owns three pieces of state — the day the cards are scoped to, the
 * month the grid shows, and whether archived habits are listed — because
 * everything else (streaks, completion rates, period progress) is computed
 * server-side and merely formatted here.
 *
 * One read: `/api/habits`, for a window that carries the shown month's entries,
 * so a day the grid can select always has its own check-in state. The month grid
 * itself reads nothing — it paints no calendar events and no dots (see
 * `HabitMonthGrid`) — so the network cost of this screen is the list and nothing
 * else. An optimistic check-in patches that one read, so a tap updates the row
 * at the same instant.
 *
 * Chrome: the shell renders the single top bar from the `PageHeader` published
 * here — the title, the list-options popover and "New habit" — so this screen
 * stacks no second header. The list options (including the archived switch) live
 * in that popover rather than in the page flow, because the archived filter is a
 * view setting on this screen and must not sit below the cards as a heading
 * attached to nothing.
 *
 * The one new piece of behaviour is the GodUI `Confetti` burst: the tap that
 * completes a habit's goal for the day is exactly the celebratory moment it
 * exists for, and it is fired in the habit's own accent colour.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { CheckCircledIcon } from '@svg-animated-icons/react/check-circled';
import { DotsHorizontalIcon } from '@svg-animated-icons/react/dots-horizontal';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { PageHeader } from '@/components/app/PageHeader';
import { useShellPane } from '@/components/app/ShellPane';
import { useSectionReset } from '@/components/calendar/section-reset';
import { Confetti, type ConfettiHandle } from '@/components/godui/confetti';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  HabitEditorSheet,
  HabitList,
  HabitMonthGrid,
  applyCheckInOptimistically,
  checkInCompletes,
  type CheckInChange,
} from '@/components/habits';
import { useToast } from '@/components/app/Toast';
import { accentHex } from '@/lib/colors';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import {
  DATE_FORMAT,
  fromDateOnly,
  monthBounds,
  rangeForView,
  shiftViewAnchor,
  startOfWeekDate,
  todayIn,
} from '@/lib/dates';
import { usePrimaryAction } from '@/lib/events';
import type { BootstrapPayload, CheckInPayload } from '@/lib/view-types';
import type { DateOnly, Habit } from '@/lib/types';

export default function HabitsPage() {
  const { toast } = useToast();
  const confettiRef = useRef<ConfettiHandle>(null);

  // The week strip is the pinned top of this screen and only the habit list
  // below it moves, so the shell hands the pane's scrolling to the page: `<main>`
  // becomes a fixed-height, non-scrolling box and the list owns the scroll. See
  // `ShellPane`.
  useShellPane({ fullHeight: true });

  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const zone = settings?.timezone ?? 'utc';
  const weekStartsOn = settings?.weekStartsOn ?? 1;
  const timeFormat = settings?.timeFormat ?? '24h';

  // The zone comes from the server, so server and client agree on "today" and
  // the first paint cannot show yesterday's check-ins.
  const today = useMemo(() => (settings ? todayIn(zone) : null), [settings, zone]);
  const todayDate = today ?? todayIn(zone);

  /** The day the card list is scoped to; `null` means today. */
  const [selectedDay, setSelectedDay] = useState<DateOnly | null>(null);
  /** The month the grid is showing; `null` means today's month. */
  const [anchor, setAnchor] = useState<DateOnly | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  /** Whether the list-options popover is open. */
  const [optionsOpen, setOptionsOpen] = useState(false);

  // The shell's action button creates a HABIT here. Left to the default it would
  // open the task quick-add, which is the wrong object on this screen entirely.
  usePrimaryAction(
    useCallback(() => {
      setEditing(null);
      setEditorOpen(true);
    }, []),
  );
  /** Id of the habit whose check-in is still in flight, so only that row dims. */
  const [checkingIn, setCheckingIn] = useState<string | null>(null);

  // The month the grid shows, and the day the list is scoped to. The grid is
  // the screen's header now, so selecting a day out of the shown month moves the
  // month with it.
  const activeDate = selectedDay ?? todayDate;
  const activeMonth = anchor ?? todayDate;

  const monthRange = useMemo(
    () => (today ? rangeForView('month', activeMonth, zone, weekStartsOn) : null),
    [today, activeMonth, zone, weekStartsOn],
  );

  /*
   * The window the habit read is scoped to.
   *
   * The grid can scope the list to any day in the shown month, so the read has
   * to carry that month's entries — not just the current week. It also has to
   * reach back past the month's own start whenever the current week or the
   * current month began earlier, because the server derives `progress`,
   * `doneToday` and the streak from this same window (see `listHabits`). The end
   * stays today so a future period can never be counted.
   */
  const habitWindow = useMemo(() => {
    if (!today) return null;
    const currentWeek = startOfWeekDate(today, weekStartsOn, zone);
    const currentMonth = monthBounds(today, zone).start;
    let from = currentWeek < currentMonth ? currentWeek : currentMonth;
    if (monthRange && monthRange.startDate < from) from = monthRange.startDate;
    return { from, to: today };
  }, [today, weekStartsOn, zone, monthRange]);

  const archives = showArchived ? '1' : undefined;

  const habits = useResource<Habit[]>(
    '/api/habits',
    { from: habitWindow?.from, to: habitWindow?.to, includeArchived: archives },
    { enabled: Boolean(habitWindow) },
  );

  const list = habits.data ?? [];

  /* ---------------------------------------------------------------------- */
  /* month navigation                                                       */
  /* ---------------------------------------------------------------------- */

  /** Selects a day, moving the shown month when the two disagree. */
  const selectDate = useCallback((date: DateOnly) => {
    setSelectedDay(date);
    setAnchor((current) => {
      const base = current ?? date;
      return base.slice(0, 7) === date.slice(0, 7) ? base : date;
    });
  }, []);

  /** Moves a day by whole months, keeping the day-of-month where it exists. */
  const shiftMonthKeepingDay = useCallback(
    (date: DateOnly, delta: number): DateOnly =>
      fromDateOnly(date, zone).plus({ months: delta }).toFormat(DATE_FORMAT),
    [zone],
  );

  /**
   * Returns the screen to today.
   *
   * Habits has no "today" in its route — there is no query parameter to push —
   * so the equivalent is the screen's own two pieces of date state: the day the
   * cards are scoped to and the month the grid shows. They both default to
   * `null` ("today"), so clearing them is the reset. That is the same state a
   * fresh entry to the tab starts from, which is what a re-tap should mean.
   */
  const resetToToday = useCallback(() => {
    setSelectedDay(null);
    setAnchor(null);
  }, []);

  /* A re-tap of the Habits tab returns the grid and the list to today. */
  useSectionReset('habits', resetToToday);

  /** Pages the shown month, taking the selection along. */
  const pageMonth = useCallback(
    (delta: number) => {
      setAnchor(shiftViewAnchor('month', activeMonth, delta, zone));
      setSelectedDay((current) => shiftMonthKeepingDay(current ?? activeMonth, delta));
    },
    [activeMonth, zone, shiftMonthKeepingDay],
  );

  /* ---------------------------------------------------------------------- */
  /* check-in                                                               */
  /* ---------------------------------------------------------------------- */

  const applyLocally = useCallback(
    (habitId: string, change: CheckInChange, todayDate: DateOnly) => {
      habits.mutate((current) =>
        current?.map((habit) =>
          habit.id === habitId ? applyCheckInOptimistically(habit, change, todayDate) : habit,
        ),
      );
    },
    [habits],
  );

  const checkIn = useCallback(
    async (habit: Habit, change: CheckInChange) => {
      if (!today) return;
      const date = change.date;

      // Snapshot first: an optimistic write has to be reversible.
      const snapshot = habits.data;
      applyLocally(habit.id, change, today);
      setCheckingIn(habit.id);
      if (checkInCompletes(habit, change, today)) {
        confettiRef.current?.fire({ colors: [accentHex(habit.color)], particleCount: 90 });
      }

      try {
        await api.post<CheckInPayload>(`/api/habits/${habit.id}/checkin`, {
          date,
          ...(change.count !== undefined ? { count: change.count } : {}),
          ...(change.delta !== undefined ? { delta: change.delta } : {}),
        });
        invalidate('/api/habits');
        void habits.refresh();
        if (change.count === null) toast({ title: `${habit.name} unchecked`, variant: 'info' });
      } catch (error) {
        habits.mutate(() => snapshot);
        toast({
          title: `Could not save ${habit.name}`,
          description: errorMessage(error),
          variant: 'error',
        });
      } finally {
        setCheckingIn((current) => (current === habit.id ? null : current));
      }
    },
    [applyLocally, habits, today, toast],
  );

  /* ---------------------------------------------------------------------- */
  /* reordering                                                             */
  /* ---------------------------------------------------------------------- */

  const reorder = useMutation(
    async (orderedIds: string[]) => api.put<{ reordered: number }>('/api/habits', { orderedIds }),
    {
      invalidates: ['/api/habits'],
      onSuccess: () => {
        void habits.refresh();
      },
      onError: (message) => {
        toast({ title: 'Could not save the new order', description: message, variant: 'error' });
        // The list is refetched, which puts the cards back in the stored order.
        void habits.refresh();
      },
    },
  );

  /* ---------------------------------------------------------------------- */
  /* editing                                                                */
  /* ---------------------------------------------------------------------- */

  function openEditor(habit: Habit | null) {
    setEditing(habit);
    setEditorOpen(true);
  }

  const loading = !today || habits.isInitialLoading;
  const failed = Boolean(habits.error) && list.length === 0;

  return (
    <>
      <PageHeader
        title="Habits"
        actions={
          <>
            {/*
             * List options live in the toolbar, not in the page flow. The
             * archived filter is a view setting on this screen — the same kind
             * of thing iOS keeps behind an overflow button — so it must not sit
             * below the cards as a heading attached to nothing. One tap, and
             * the switch keeps the popover open so the list behind it updates.
             */}
            <Popover open={optionsOpen} onOpenChange={setOptionsOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="secondary"
                  size="icon"
                  aria-label="Habit list options"
                  aria-expanded={optionsOpen}
                >
                  <DotsHorizontalIcon />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-64 flex-col gap-2">
                <div className="flex items-center justify-between gap-3">
                  <Label htmlFor="habits-show-archived">Show archived habits</Label>
                  <Switch
                    id="habits-show-archived"
                    checked={showArchived}
                    onCheckedChange={setShowArchived}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  Archived habits keep their history but are hidden from the check-in list.
                </p>
              </PopoverContent>
            </Popover>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="New habit"
              onClick={() => openEditor(null)}
            >
              <PlusIcon />
            </Button>
          </>
        }
      />

      {/* This column caps the reading width on a desktop so the cards are not
          stretched to 1100px while the phone layout stays edge to edge.

          With `useShellPane({ fullHeight: true })` above, the shell hands the
          scrolling to this screen: the column fills the fixed-height pane
          (`min-h-0 flex-1`), the month grid is the pinned top (`shrink-0`) and
          only the list under it scrolls. */}
      <div className="mx-auto flex min-h-0 w-full max-w-2xl flex-1 flex-col gap-stack px-gutter pb-stack">
        {loading ? (
          <>
            <Skeleton className="h-16 rounded-xl" />
            <Skeleton className="h-40 rounded-xl" />
          </>
        ) : failed ? (
          <div className="flex flex-col items-center gap-stack px-card py-6 text-center">
            <CalendarIcon className="size-10 text-muted-foreground/60" />
            <h2 className="text-base font-medium">Could not load your habits</h2>
            <p className="text-sm text-muted-foreground">{habits.error}</p>
            <Button type="button" variant="secondary" onClick={() => void habits.refresh()}>
              Try again
            </Button>
          </div>
        ) : (
          <>
            {/*
             * The pinned top: the calendar screen's own `MonthGrid`, collapsed
             * to a week on open, and carrying habit completions only — no
             * calendar events, and no dots of any kind (see `HabitMonthGrid`).
             * `shrink-0`, so only the list under it scrolls.
             */}
            <HabitMonthGrid
              habits={list}
              anchor={activeMonth}
              selectedDate={activeDate}
              today={todayDate}
              zone={zone}
              weekStartsOn={weekStartsOn}
              timeFormat={timeFormat}
              onSelectDate={selectDate}
              onPage={pageMonth}
              className="shrink-0"
            />
            {/* The scroller. `data-habit-scroll` is also the anchor
                `HabitList`'s drag lock looks up to freeze the pane under the
                finger; the bottom padding is the mobile tab-bar clearance the
                shell used to carry on `<main>`, restated here because the
                screen owns its own scroll now. */}
            <div
              data-habit-scroll
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[calc(env(safe-area-inset-bottom)_+_6.125rem)] lg:pb-0"
            >
              {list.length === 0 ? (
                <div className="flex flex-col items-center gap-stack px-card py-6 text-center">
                  <CheckCircledIcon className="size-10 text-muted-foreground/60" />
                  <h2 className="text-base font-medium">No habits yet</h2>
                  <p className="text-sm text-muted-foreground">
                    A habit is something you want to keep doing — every day, a few times a week, or once a month. Add
                    one and check in from this screen.
                  </p>
                  <Button type="button" className="gap-2" onClick={() => openEditor(null)}>
                    <PlusIcon />
                    Add your first habit
                  </Button>
                </div>
              ) : (
                <HabitList
                  habits={list}
                  date={activeDate}
                  today={todayDate}
                  pendingId={checkingIn}
                  onCheckIn={(habit, change) => void checkIn(habit, change)}
                  onEdit={openEditor}
                  onReorder={async (orderedIds) => Boolean(await reorder.run(orderedIds))}
                />
              )}
            </div>
          </>
        )}
      </div>

      <HabitEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        habit={editing}
        today={todayDate}
        onChanged={() => {
          void habits.refresh();
        }}
      />

      {/*
       * Mounted once and driven imperatively: a burst is a moment, not state, so
       * it must not re-render the list it is celebrating.
       */}
      <Confetti ref={confettiRef} />
    </>
  );
}
