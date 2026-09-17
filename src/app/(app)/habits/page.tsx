'use client';

/**
 * Habits: check in, see the streaks, and read the year back as a heatmap.
 *
 * The layout is the reference one: a compact week strip as the page header — the
 * selected day filled — then one card whose first row is the group name, and one
 * quiet row per habit (check-in control, glyph, name, right-aligned streak).
 *
 * The page owns three pieces of state — which day the cards are scoped to,
 * whether archived habits are listed, and whether the heatmap is open — because
 * everything else (streaks, completion rates, period progress) is computed
 * server-side and merely formatted here.
 *
 * Two reads, on purpose: the card list is scoped to the current week so the
 * selected day's `entries` are present, while the heatmap always asks for the
 * trailing twelve months. An optimistic check-in patches both, so a tap updates
 * the row and the grid at the same instant.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { usePrimaryAction } from '@/lib/events';
import { CalendarRange, CheckCircle2, ChevronDown, Ellipsis, Plus } from 'lucide-react';
import {
  Button,
  EmptyState,
  IconButton,
  NavBar,
  Popover,
  Select,
  Skeleton,
  Switch,
  useToast,
} from '@/components/ui';
import { cn } from '@/lib/cn';
import {
  HabitEditorSheet,
  HabitHeatmap,
  HabitList,
  HabitWeekStrip,
  HeatmapHabitList,
  applyCheckInOptimistically,
  combineHabitEntries,
  habitWindowRange,
  isHabitDueOn,
  type CheckInChange,
} from '@/components/habits';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { addDaysToDateOnly, todayIn } from '@/lib/dates';
import type { BootstrapPayload, CheckInPayload } from '@/lib/view-types';
import type { DateOnly, Habit } from '@/lib/types';

export default function HabitsPage() {
  const { toast } = useToast();

  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const zone = settings?.timezone ?? 'utc';
  const weekStartsOn = settings?.weekStartsOn ?? 1;

  // The zone comes from the server, so server and client agree on "today" and
  // the first paint cannot show yesterday's check-ins.
  const today = useMemo(() => (settings ? todayIn(zone) : null), [settings, zone]);
  const todayDate = today ?? todayIn(zone);

  /** The day the card list is scoped to; `null` means today. */
  const [selectedDay, setSelectedDay] = useState<DateOnly | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [scope, setScope] = useState<string>('all');
  const [editing, setEditing] = useState<Habit | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

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

  // Deep link from search: `/habits?habit=<id>` opens that habit's year view.
  const requestedHabit = useSearchParams().get('habit');
  useEffect(() => {
    if (!requestedHabit) return;
    setScope(requestedHabit);
    setHeatmapOpen(true);
  }, [requestedHabit]);

  // The cards only ever need the current week: the header strip selects days
  // inside it, and the streak and period values are server-side anyway.
  const range = useMemo(
    () => (today ? habitWindowRange('week', today, weekStartsOn) : null),
    [today, weekStartsOn],
  );

  const archives = showArchived ? '1' : undefined;

  const habits = useResource<Habit[]>(
    '/api/habits',
    { from: range?.from, to: range?.to, includeArchived: archives },
    { enabled: Boolean(today) },
  );

  const yearFrom = useMemo(() => (today ? addDaysToDateOnly(today, -364, zone) : undefined), [today, zone]);
  const heatmapHabits = useResource<Habit[]>(
    '/api/habits',
    { from: yearFrom, to: today, includeArchived: archives },
    { enabled: Boolean(today) && heatmapOpen },
  );

  const list = habits.data ?? [];
  // The heatmap must never be drawn from the window-scoped list: its entries only
  // cover the selected window, which would leave eleven empty months on screen
  // while the year fetch is still in flight.
  const yearList = heatmapHabits.data ?? [];

  // The strip's selection, defaulting to today until the user picks a day.
  const activeDate = selectedDay ?? todayDate;
  // Days before the earliest habit existed are dimmed and inert in the strip.
  const earliestStart = useMemo(
    () =>
      list.length
        ? list.reduce((min, habit) => (habit.startDate < min ? habit.startDate : min), list[0].startDate)
        : null,
    [list],
  );

  /* ---------------------------------------------------------------------- */
  /* check-in                                                               */
  /* ---------------------------------------------------------------------- */

  const applyLocally = useCallback(
    (habitId: string, change: CheckInChange, todayDate: DateOnly) => {
      const patch = (current: Habit[] | undefined) =>
        current?.map((habit) =>
          habit.id === habitId ? applyCheckInOptimistically(habit, change, todayDate) : habit,
        );
      habits.mutate(patch);
      heatmapHabits.mutate(patch);
    },
    [habits, heatmapHabits],
  );

  const checkIn = useCallback(
    async (habit: Habit, change: CheckInChange) => {
      if (!today) return;
      const date = change.date;

      // Snapshot first: an optimistic write has to be reversible.
      const snapshot = { list: habits.data, heatmap: heatmapHabits.data };
      applyLocally(habit.id, change, today);
      setCheckingIn(habit.id);

      try {
        await api.post<CheckInPayload>(`/api/habits/${habit.id}/checkin`, {
          date,
          ...(change.count !== undefined ? { count: change.count } : {}),
          ...(change.delta !== undefined ? { delta: change.delta } : {}),
        });
        invalidate('/api/habits');
        void habits.refresh();
        if (heatmapOpen) void heatmapHabits.refresh();
        if (change.count === null) toast({ title: `${habit.name} unchecked`, variant: 'info' });
      } catch (error) {
        habits.mutate(() => snapshot.list);
        heatmapHabits.mutate(() => snapshot.heatmap);
        toast({
          title: `Could not save ${habit.name}`,
          description: errorMessage(error),
          variant: 'error',
        });
      } finally {
        setCheckingIn((current) => (current === habit.id ? null : current));
      }
    },
    [applyLocally, habits, heatmapHabits, heatmapOpen, today, toast],
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
  /* the heatmap's subject                                                  */
  /* ---------------------------------------------------------------------- */

  const scopeOptions = useMemo(
    () => [
      { value: 'all', label: 'All habits' },
      ...yearList.map((habit) => ({ value: habit.id, label: habit.name })),
    ],
    [yearList],
  );

  const selectedHabit = scope === 'all' ? null : yearList.find((habit) => habit.id === scope) ?? null;
  const combined = useMemo(() => combineHabitEntries(yearList), [yearList]);

  const series = selectedHabit
    ? {
        key: selectedHabit.id,
        label: selectedHabit.name,
        color: selectedHabit.color,
        target: selectedHabit.goalType === 'boolean' ? 1 : Math.max(1, selectedHabit.goalTarget),
        unit: selectedHabit.goalType === 'boolean' ? null : selectedHabit.unit,
        entries: selectedHabit.entries ?? {},
      }
    : {
        key: 'all',
        label: 'Every habit',
        color: 'green' as const,
        target: combined.max,
        unit: null,
        noun: 'habits' as const,
        entries: combined.entries,
      };

  function openEditor(habit: Habit | null) {
    setEditing(habit);
    setEditorOpen(true);
  }

  const loading = !today || habits.isInitialLoading;
  const failed = Boolean(habits.error) && list.length === 0;

  return (
    // The shell owns the scroll pane and the tab-bar clearance; this column only
    // caps the reading width on a desktop so the cards are not stretched to
    // 1100px while the phone layout stays edge to edge.
    <div className="mx-auto w-full max-w-2xl">
      <NavBar
        title="Habits"
        largeTitle
        trailing={
          <>
            {/*
             * List options live in a toolbar menu, not in the page flow. The
             * archived filter is a view setting on this screen — the same kind
             * of thing iOS keeps behind an overflow button — so it must not sit
             * below the cards as a heading attached to nothing. One tap, and
             * the switch keeps the menu open so the list behind it updates.
             */}
            <Popover
              align="end"
              trigger={<IconButton icon={Ellipsis} variant="plain" aria-label="Habit list options" />}
            >
              <div className="w-60 px-2 py-1.5">
                <Switch
                  label="Show archived habits"
                  checked={showArchived}
                  onCheckedChange={setShowArchived}
                  size="sm"
                />
                <p className="pt-1 text-caption-1 text-tertiary">
                  Archived habits keep their history but are hidden from the check-in list.
                </p>
              </div>
            </Popover>
            <IconButton icon={Plus} variant="plain" aria-label="New habit" onClick={() => openEditor(null)} />
          </>
        }
      />

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} variant="rect" className="mx-4 h-40" />
          ))}
        </div>
      ) : failed ? (
        <EmptyState
          icon={CalendarRange}
          title="Could not load your habits"
          description={habits.error}
          action={
            <Button variant="tinted" onClick={() => void habits.refresh()}>
              Try again
            </Button>
          }
        />
      ) : list.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No habits yet"
          description="A habit is something you want to keep doing — every day, a few times a week, or once a month. Add one and check in from this screen."
          action={
            <Button icon={Plus} onClick={() => openEditor(null)}>
              Add habit
            </Button>
          }
        />
      ) : (
        <>
          <HabitWeekStrip
            selected={activeDate}
            today={todayDate}
            weekStartsOn={weekStartsOn}
            earliest={earliestStart}
            onSelect={setSelectedDay}
          />
          <HabitList
            habits={list}
            date={activeDate}
            today={todayDate}
            pendingId={checkingIn}
            onCheckIn={(habit, change) => void checkIn(habit, change)}
            onEdit={openEditor}
            onReorder={async (orderedIds) => Boolean(await reorder.run(orderedIds))}
          />
          <div className="flex justify-center px-4 pt-1">
            <Button variant="tinted" icon={Plus} onClick={() => openEditor(null)}>
              Add habit
            </Button>
          </div>
        </>
      )}

      {/*
       * Activity is a card whose own header row carries the disclosure, the
       * same shape the habit card uses. As a bare `Activity ⌄` heading in the
       * flow it read as neither a section nor a setting — it sat above the
       * archived card with a gap, so the two looked like one broken section.
       * Attached to its own surface the label belongs to the grid it opens,
       * and the archived control is no longer underneath it.
       *
       * The card is deliberately not `.grouped`: that utility clips its
       * content, and the heatmap's day popover has to escape the card.
       */}
      <section className="mt-6">
        <div className="glass-card mx-4 rounded-ios-lg">
          <div className={cn('flex items-center justify-between gap-2 px-3', heatmapOpen && 'hairline-b')}>
            <h2 className="min-w-0">
              <button
                type="button"
                aria-expanded={heatmapOpen}
                onClick={() => setHeatmapOpen((open) => !open)}
                className="flex min-h-11 items-center gap-1.5 text-subhead font-semibold text-label pressable"
              >
                Activity
                <ChevronDown
                  className={cn(
                    'size-3.5 transition-transform duration-200 ease-ios-out',
                    heatmapOpen && 'rotate-180',
                  )}
                  aria-hidden
                />
              </button>
            </h2>

            {heatmapOpen ? (
              <Select
                value={scope}
                onChange={setScope}
                options={scopeOptions}
                label="Habit shown in the heatmap"
                placeholder="All habits"
                className="w-40"
              />
            ) : null}
          </div>

          {heatmapOpen ? (
            heatmapHabits.error && yearList.length === 0 ? (
              <div className="p-3">
                <EmptyState icon={CalendarRange} title="Could not load activity" description={heatmapHabits.error} />
              </div>
            ) : !heatmapHabits.data ? (
              <Skeleton variant="rect" className="m-3 h-40" />
            ) : (
              <div className="p-3">
                <HabitHeatmap
                  series={series}
                  today={todayDate}
                  weekStartsOn={weekStartsOn}
                  {...(selectedHabit
                    ? {
                        isScheduled: (date: DateOnly) => isHabitDueOn(selectedHabit, date),
                        earliest: selectedHabit.startDate,
                        onSetEntry: (date: DateOnly, count: number | null) =>
                          void checkIn(selectedHabit, { date, count }),
                      }
                    : {
                        renderDetail: (date: DateOnly) => <HeatmapHabitList habits={yearList} date={date} />,
                      })}
                />
              </div>
            )
          ) : null}
        </div>
      </section>

      <HabitEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        habit={editing}
        today={todayDate}
        onChanged={() => {
          void habits.refresh();
          if (heatmapOpen) void heatmapHabits.refresh();
        }}
      />
    </div>
  );
}
