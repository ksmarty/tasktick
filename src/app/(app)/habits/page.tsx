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
 * Material chrome: a sticky `AppBar` carries the title and the two header
 * actions (the list options menu and "New habit"), and the list options —
 * including the archived switch — live in a MUI `Menu` rather than in the page
 * flow.
 */
import { useCallback, useMemo, useState } from 'react';
import { usePrimaryAction } from '@/lib/events';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import FormControlLabel from '@mui/material/FormControlLabel';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CalendarMonthOutlinedIcon from '@mui/icons-material/CalendarMonthOutlined';
import CheckCircleOutlinedIcon from '@mui/icons-material/CheckCircleOutlined';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import {
  HabitEditorSheet,
  HabitList,
  HabitWeekStrip,
  applyCheckInOptimistically,
  habitWindowRange,
  type CheckInChange,
} from '@/components/habits';
import { useToast } from '@/components/app/Toast';
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
  /** Anchors the list-options menu; `null` when it is closed. */
  const [optionsAnchor, setOptionsAnchor] = useState<HTMLElement | null>(null);

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
    <Box sx={{ mx: 'auto', width: '100%', maxWidth: 672 }}>
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        sx={{
          bgcolor: 'background.default',
          backgroundImage: 'none',
          borderBottom: 1,
          borderColor: 'divider',
          // The app paints under the Dynamic Island, so the bar carries the inset.
          pt: 'env(safe-area-inset-top, 0px)',
        }}
      >
        <Toolbar sx={{ gap: 0.75, minHeight: 56, px: 1.5 }}>
          <Typography variant="h6" component="h1" noWrap sx={{ flex: 1, minWidth: 0 }}>
            Habits
          </Typography>
          {/*
           * List options live in a toolbar menu, not in the page flow. The
           * archived filter is a view setting on this screen — the same kind
           * of thing iOS keeps behind an overflow button — so it must not sit
           * below the cards as a heading attached to nothing. One tap, and
           * the switch keeps the menu open so the list behind it updates.
           */}
          <IconButton
            aria-label="Habit list options"
            aria-haspopup="menu"
            aria-expanded={optionsAnchor ? 'true' : undefined}
            onClick={(event) => setOptionsAnchor(event.currentTarget)}
            sx={{ bgcolor: 'action.hover' }}
          >
            <MoreVertIcon sx={{ fontSize: 20 }} />
          </IconButton>
          <IconButton
            aria-label="New habit"
            onClick={() => openEditor(null)}
            sx={{ bgcolor: 'action.hover' }}
          >
            <AddIcon sx={{ fontSize: 20 }} />
          </IconButton>
        </Toolbar>
      </AppBar>

      <Menu
        anchorEl={optionsAnchor}
        open={Boolean(optionsAnchor)}
        onClose={() => setOptionsAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ width: 240, px: 2, py: 1 }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showArchived}
                onChange={(event) => setShowArchived(event.target.checked)}
              />
            }
            label="Show archived habits"
          />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 0.5 }}>
            Archived habits keep their history but are hidden from the check-in list.
          </Typography>
        </Box>
      </Menu>

      {loading ? (
        <Stack spacing={1.5} sx={{ pt: 1 }}>
          {[0, 1, 2].map((key) => (
            <Skeleton key={key} variant="rectangular" height={160} sx={{ mx: 2, borderRadius: 2 }} />
          ))}
        </Stack>
      ) : failed ? (
        <Stack spacing={1.5} sx={{ alignItems: 'center', px: 4, py: 6, textAlign: 'center' }}>
          <Box sx={{ color: 'text.disabled', display: 'flex' }}>
            <CalendarMonthOutlinedIcon sx={{ fontSize: 40 }} aria-hidden />
          </Box>
          <Typography variant="subtitle1" component="h2">
            Could not load your habits
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {habits.error}
          </Typography>
          <Button
            variant="contained"
            disableElevation
            onClick={() => void habits.refresh()}
            sx={{ mt: 1, bgcolor: 'action.hover', color: 'primary.main', '&:hover': { bgcolor: 'action.selected' } }}
          >
            Try again
          </Button>
        </Stack>
      ) : list.length === 0 ? (
        <Stack spacing={1.5} sx={{ alignItems: 'center', px: 4, py: 6, textAlign: 'center' }}>
          <Box sx={{ color: 'text.disabled', display: 'flex' }}>
            <CheckCircleOutlinedIcon sx={{ fontSize: 40 }} aria-hidden />
          </Box>
          <Typography variant="subtitle1" component="h2">
            No habits yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            A habit is something you want to keep doing — every day, a few times a week, or once a month. Add one and
            check in from this screen.
          </Typography>
          <Button variant="contained" startIcon={<AddIcon />} onClick={() => openEditor(null)} sx={{ mt: 1 }}>
            Add your first habit
          </Button>
        </Stack>
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
    </Box>
  );
}
