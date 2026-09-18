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
import { Confetti, type ConfettiHandle } from '@/components/godui/confetti';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  HabitEditorSheet,
  HabitList,
  HabitWeekStrip,
  applyCheckInOptimistically,
  habitProgressView,
  habitWindowRange,
  type CheckInChange,
} from '@/components/habits';
import { useToast } from '@/components/app/Toast';
import { accentHex } from '@/lib/colors';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { todayIn } from '@/lib/dates';
import { usePrimaryAction } from '@/lib/events';
import type { BootstrapPayload, CheckInPayload } from '@/lib/view-types';
import type { DateOnly, Habit } from '@/lib/types';

/**
 * Whether this change is the one that fills the habit's goal for the day.
 *
 * A boolean habit fills it by being checked; a counted one when the amount
 * crosses the target — for a weekly or monthly habit the period total comes from
 * the server's `progress`, exactly as the check-in control reads it.
 */
function checkInCompletes(habit: Habit, change: CheckInChange, today: DateOnly): boolean {
  const view = habitProgressView(habit, today);
  if (habit.goalType === 'boolean') return change.count === 1;
  const periodic = habit.frequency === 'weekly' || habit.frequency === 'monthly';
  const logged = periodic ? view.logged : habit.entries?.[change.date] ?? 0;
  const next = change.delta !== undefined ? logged + change.delta : change.count ?? 0;
  return logged < view.target && next >= view.target;
}

export default function HabitsPage() {
  const { toast } = useToast();
  const confettiRef = useRef<ConfettiHandle>(null);

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

      {/* The shell owns the scroll pane and the tab-bar clearance; this column
          only caps the reading width on a desktop so the cards are not stretched
          to 1100px while the phone layout stays edge to edge. */}
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-stack px-gutter pb-stack">
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
        ) : list.length === 0 ? (
          <div className="flex flex-col items-center gap-stack px-card py-6 text-center">
            <CheckCircledIcon className="size-10 text-muted-foreground/60" />
            <h2 className="text-base font-medium">No habits yet</h2>
            <p className="text-sm text-muted-foreground">
              A habit is something you want to keep doing — every day, a few times a week, or once a month. Add one and
              check in from this screen.
            </p>
            <Button type="button" className="gap-2" onClick={() => openEditor(null)}>
              <PlusIcon />
              Add your first habit
            </Button>
          </div>
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
