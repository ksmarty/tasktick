'use client';

/**
 * Habits: check in, see the streaks, and read the week back as a strip.
 *
 * The layout is the reference one: a compact week strip as the page header — the
 * selected day filled — then one card whose first row is the group name, and one
 * quiet row per habit (check-in control, glyph, name, right-aligned streak).
 *
 * The page owns two pieces of state — which day the cards are scoped to, and
 * whether archived habits are listed — because everything else (streaks,
 * completion rates, period progress) is computed server-side and merely
 * formatted here.
 *
 * One read, on purpose: the card list is scoped to the current week so the
 * selected day's `entries` are present. An optimistic check-in patches it, so a
 * tap updates the row at the same instant.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePrimaryAction } from '@/lib/events';
import { CalendarRange, CheckCircle2, Ellipsis, Plus } from 'lucide-react';
import {
  Button,
  EmptyState,
  IconButton,
  NavBar,
  Popover,
  Skeleton,
  Switch,
  useToast,
} from '@/components/ui';
import {
  HabitEditorSheet,
  HabitList,
  HabitWeekStrip,
  applyCheckInOptimistically,
  habitWindowRange,
  type CheckInChange,
} from '@/components/habits';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { todayIn } from '@/lib/dates';
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

  const list = habits.data ?? [];

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
              Add your first habit
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
        </>
      )}

      <HabitEditorSheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        habit={editing}
        today={todayDate}
        onChanged={() => {
          void habits.refresh();
        }}
      />
    </div>
  );
}
