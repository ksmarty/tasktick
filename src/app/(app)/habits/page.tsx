'use client';

/**
 * Habits: check in, see the streaks, and read the year back as a heatmap.
 *
 * The page owns exactly four pieces of state — which window the cards are scored
 * over, whether archived habits are listed, whether the heatmap is open and what
 * it shows — because everything else (streaks, completion rates, period
 * progress) is computed server-side and merely formatted here.
 *
 * Two reads, on purpose: the card list is scoped to the selected window so the
 * server's `completionRate` answers "how did I do this week", while the heatmap
 * always asks for the trailing twelve months. An optimistic check-in patches
 * both, so a tap updates the card and the grid at the same instant.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CalendarRange, CheckCircle2, ChevronDown, Plus } from 'lucide-react';
import {
  Button,
  EmptyState,
  IconButton,
  NavBar,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  useToast,
} from '@/components/ui';
import {
  HabitEditorSheet,
  HabitHeatmap,
  HabitList,
  HeatmapHabitList,
  HABIT_WINDOWS,
  applyCheckInOptimistically,
  combineHabitEntries,
  habitWindowRange,
  isHabitDueOn,
  type HabitWindow,
} from '@/components/habits';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { addDaysToDateOnly, todayIn } from '@/lib/dates';
import type { BootstrapPayload, CheckInPayload } from '@/lib/view-types';
import type { DateOnly, Habit } from '@/lib/types';

interface CheckInChange {
  date?: DateOnly;
  count?: number | null;
  delta?: number;
}

export default function HabitsPage() {
  const { toast } = useToast();

  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const zone = settings?.timezone ?? 'utc';
  const weekStartsOn = settings?.weekStartsOn ?? 1;
  const timeFormat = settings?.timeFormat ?? '24h';

  // The zone comes from the server, so server and client agree on "today" and
  // the first paint cannot show yesterday's check-ins.
  const today = useMemo(() => (settings ? todayIn(zone) : null), [settings, zone]);
  const todayDate = today ?? todayIn(zone);

  const [habitWindow, setHabitWindow] = useState<HabitWindow>('week');
  const [showArchived, setShowArchived] = useState(false);
  const [heatmapOpen, setHeatmapOpen] = useState(false);
  const [scope, setScope] = useState<string>('all');
  const [editing, setEditing] = useState<Habit | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);

  // Deep link from search: `/habits?habit=<id>` opens that habit's year view.
  const requestedHabit = useSearchParams().get('habit');
  useEffect(() => {
    if (!requestedHabit) return;
    setScope(requestedHabit);
    setHeatmapOpen(true);
  }, [requestedHabit]);

  const range = useMemo(
    () => (today ? habitWindowRange(habitWindow, today, weekStartsOn) : null),
    [habitWindow, today, weekStartsOn],
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

  /* ---------------------------------------------------------------------- */
  /* check-in                                                               */
  /* ---------------------------------------------------------------------- */

  const applyLocally = useCallback(
    (habitId: string, change: Required<Pick<CheckInChange, 'date'>> & CheckInChange) => {
      const patch = (current: Habit[] | undefined) =>
        current?.map((habit) => (habit.id === habitId ? applyCheckInOptimistically(habit, change) : habit));
      habits.mutate(patch);
      heatmapHabits.mutate(patch);
    },
    [habits, heatmapHabits],
  );

  const checkIn = useCallback(
    async (habit: Habit, change: CheckInChange) => {
      if (!today) return;
      const date = change.date ?? today;

      // Snapshot first: an optimistic write has to be reversible.
      const snapshot = { list: habits.data, heatmap: heatmapHabits.data };
      applyLocally(habit.id, { date, count: change.count, delta: change.delta });

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
    <div className="min-h-dvh pb-8">
      <NavBar
        title="Habits"
        largeTitle
        trailing={<IconButton icon={Plus} variant="plain" aria-label="New habit" onClick={() => openEditor(null)} />}
      />

      <div className="px-4 pt-1 pb-3">
        <SegmentedControl
          options={HABIT_WINDOWS.map((option) => ({ value: option.value, label: option.label }))}
          value={habitWindow}
          onChange={setHabitWindow}
          label="Scoring window"
          size="sm"
        />
        <p className="pt-2 px-1 text-footnote text-secondary">
          Streaks and completion are scored over {range?.label.toLowerCase() ?? 'this week'}.
        </p>
      </div>

      {loading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} variant="rect" className="mx-4 h-32" />
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
          <HabitList
            habits={list}
            today={todayDate}
            weekStartsOn={weekStartsOn}
            windowLabel={range?.label ?? 'This week'}
            timeFormat={timeFormat}
            pending={reorder.isPending}
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

      <section className="mt-8">
        <div className="flex items-center justify-between gap-2 px-4">
          <h2>
            <button
              type="button"
              aria-expanded={heatmapOpen}
              onClick={() => setHeatmapOpen((open) => !open)}
              className="flex min-h-11 items-center gap-1.5 text-title-3 font-semibold text-label pressable"
            >
              Activity
              <ChevronDown
                className={heatmapOpen ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'}
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
            <EmptyState icon={CalendarRange} title="Could not load activity" description={heatmapHabits.error} />
          ) : !heatmapHabits.data ? (
            <Skeleton variant="rect" className="mx-4 mt-3 h-40" />
          ) : (
            // Deliberately not `.grouped`: that utility clips its content, and
            // the day popover has to be able to escape the card.
            <div className="mx-4 mt-3 rounded-ios-lg bg-elevated p-3 shadow-ios-sm">
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
      </section>

      <section className="mt-6">
        <div className="grouped mx-4 flex items-center px-4">
          <Switch label="Show archived habits" checked={showArchived} onCheckedChange={setShowArchived} size="sm" />
        </div>
        <p className="px-4 pt-2 text-footnote text-secondary">
          Archived habits keep their history but are hidden from the check-in list.
        </p>
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
