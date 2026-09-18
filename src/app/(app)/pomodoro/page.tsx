'use client';

/**
 * The focus timer.
 *
 * The state machine lives in `./timer` (pure, tested); this page wires it to the
 * clock, to the settings, and to the focus-session API.
 *
 * Two behaviours are worth calling out:
 *
 *   - **The countdown is derived, never accumulated.** A running phase stores the
 *     instant it ends at, and a 250 ms tick only re-renders the derived value.
 *     A background tab that throttles the tick to once a minute therefore still
 *     shows the right number the moment it is looked at.
 *   - **A phase is persisted at both ends.** `POST /api/focus` when a focus
 *     session starts, `PATCH /api/focus/[id]` with `{ completed, actualSeconds }`
 *     when it ends — whether it ran out or was skipped/reset. An abandoned
 *     session is recorded as abandoned, not silently dropped.
 *
 * Material owns the chrome: a sticky `AppBar`, the phase ring as a determinate
 * `CircularProgress` with the clock `Typography` centred over it, the controls
 * as MUI `Button`s, and the two summary rows as outlined `Paper`s. None of the
 * timing, session or notification code below has moved.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextLink from 'next/link';
import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import CheckIcon from '@mui/icons-material/Check';
import PauseIcon from '@mui/icons-material/Pause';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import TimerOutlinedIcon from '@mui/icons-material/TimerOutlined';
import { useToast } from '@/components/app/Toast';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { formatClock, humanDuration, todayIn, toDateOnly } from '@/lib/dates';
import { notifyPeriodEnd, playChime } from './feedback';
import {
  applyConfig,
  finishPhase,
  focusUntilLongBreak,
  initialTimerState,
  pauseTimer,
  phaseProgress,
  remainingSeconds,
  resetTimer,
  resumeTimer,
  skipPhase,
  startTimer,
  timerConfigFrom,
  type FinishedPhase,
} from './timer';
import type { BootstrapPayload, CompleteTaskPayload, FocusPayload } from '@/lib/view-types';
import type { DateOnly, FocusSession, Task } from '@/lib/types';

const PHASE_LABEL: Record<FinishedPhase['phase'], string> = {
  focus: 'Focus',
  short_break: 'Short break',
  long_break: 'Long break',
};

/** The primary action as a filled primary button; the app's "tinted" surface. */
const TINTED_SX = {
  bgcolor: 'action.hover',
  color: 'primary.main',
  '&:hover': { bgcolor: 'action.selected' },
} as const;

export default function PomodoroPage() {
  const { toast } = useToast();

  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = bootstrap.data?.settings;
  const zone = settings?.timezone ?? 'utc';
  const today = useMemo<DateOnly | null>(() => (settings ? todayIn(zone) : null), [settings, zone]);

  const config = useMemo(
    () =>
      timerConfigFrom({
        focusMinutes: settings?.pomodoroFocus,
        shortBreakMinutes: settings?.pomodoroShortBreak,
        longBreakMinutes: settings?.pomodoroLongBreak,
        longBreakEvery: settings?.pomodoroLongBreakEvery,
      }),
    [settings],
  );

  const autoStartBreaks = Boolean(settings?.pomodoroAutoStartBreaks);

  const [rawState, setRawState] = useState(() => initialTimerState(config));
  const [now, setNow] = useState(() => Date.now());
  const [taskId, setTaskId] = useState<string>('');
  const [offer, setOffer] = useState<Task | null>(null);

  // Settings arriving (or changing) resize an idle phase; a running one is left
  // alone until it ends.
  const state = useMemo(() => applyConfig(rawState, config), [rawState, config]);
  const remaining = remainingSeconds(state, now);
  const running = state.status === 'running';

  const focus = useResource<FocusPayload>('/api/focus', { limit: 20 });
  const tasks = useResource<Task[]>('/api/tasks', { dueWindow: 'today', includeCompleted: 'false' }, { enabled: Boolean(today) });

  const sessionRef = useRef<Promise<string | null> | null>(null);
  const selectedTask = useMemo(() => (tasks.data ?? []).find((task) => task.id === taskId) ?? null, [taskId, tasks.data]);

  /* ---------------------------------------------------------------------- */
  /* clock                                                                  */
  /* ---------------------------------------------------------------------- */

  useEffect(() => {
    if (!running) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [running]);

  /* ---------------------------------------------------------------------- */
  /* session persistence                                                    */
  /* ---------------------------------------------------------------------- */

  const beginSession = useCallback(
    (plannedSeconds: number) => {
      const promise = api
        .post<FocusSession>('/api/focus', {
          taskId: taskId || null,
          kind: 'focus',
          plannedSeconds,
        })
        .then((session) => {
          invalidate('/api/focus');
          void focus.refresh();
          return session.id;
        })
        .catch((error: unknown) => {
          toast({ title: 'Could not record the focus session', description: errorMessage(error), variant: 'error' });
          return null;
        });

      sessionRef.current = promise;
    },
    [focus, taskId, toast],
  );

  const endSession = useCallback(
    (completed: boolean, actualSeconds: number) => {
      const pending = sessionRef.current;
      sessionRef.current = null;
      if (!pending) return;

      void pending.then(async (id) => {
        if (!id) return;
        try {
          await api.patch<FocusSession>(`/api/focus/${id}`, { completed, actualSeconds });
          invalidate('/api/focus');
          void focus.refresh();
        } catch (error) {
          toast({ title: 'Could not save the focus session', description: errorMessage(error), variant: 'error' });
        }
      });
    },
    [focus, toast],
  );

  /** Announces the end of a phase, only for a user who has touched the page. */
  const announce = useCallback(async (finished: FinishedPhase, nextPhaseLabel: string) => {
    const wasFocus = finished.phase === 'focus';
    playChime();
    void notifyPeriodEnd(
      wasFocus ? 'Focus session complete' : 'Break over',
      wasFocus ? `${nextPhaseLabel} starts when you are ready.` : 'Time to focus again.',
    );
  }, []);

  /* ---------------------------------------------------------------------- */
  /* transitions                                                            */
  /* ---------------------------------------------------------------------- */

  const completeTask = useMutation(async (id: string) => api.post<CompleteTaskPayload>(`/api/tasks/${id}/complete`), {
    invalidates: ['/api/tasks'],
    onSuccess: (result) => {
      toast({
        title: result?.recurred ? 'Repeating task moved to its next date' : 'Task completed',
        variant: 'success',
      });
      setOffer(null);
      void tasks.refresh();
    },
    onError: (message) => toast({ title: 'Could not complete the task', description: message, variant: 'error' }),
  });

  const handleFinished = useCallback(
    (finished: FinishedPhase, nextLabel: string) => {
      if (finished.phase === 'focus') {
        endSession(finished.completed, finished.elapsedSeconds);
        if (finished.completed && selectedTask) setOffer(selectedTask);
      }
      if (finished.completed) void announce(finished, nextLabel);
    },
    [announce, endSession, selectedTask],
  );

  const onStart = useCallback(() => {
    const stamp = Date.now();
    setNow(stamp);

    if (state.status === 'paused') {
      setRawState(resumeTimer(state, stamp));
      return;
    }

    const next = startTimer(state, stamp, config);
    setRawState(next);
    if (next.phase === 'focus') beginSession(next.plannedSeconds);
  }, [beginSession, config, state]);

  const onPause = useCallback(() => {
    const stamp = Date.now();
    setNow(stamp);
    setRawState(pauseTimer(state, stamp));
  }, [state]);

  const onSkip = useCallback(() => {
    const stamp = Date.now();
    setNow(stamp);
    const { state: next, finished } = skipPhase(state, config, stamp);
    setRawState(next);
    handleFinished(finished, PHASE_LABEL[next.phase]);
  }, [config, handleFinished, state]);

  const onReset = useCallback(() => {
    const stamp = Date.now();
    setNow(stamp);
    // A reset abandons the session in progress rather than pretending it finished.
    const elapsed = state.plannedSeconds - remainingSeconds(state, stamp);
    endSession(false, Math.max(0, Math.round(elapsed)));
    setRawState(resetTimer(config));
    setOffer(null);
  }, [config, endSession, state]);

  // The phase runs out: finish it exactly once, as soon as the derived remaining
  // time crosses zero.
  useEffect(() => {
    if (state.status !== 'running') return;
    if (remainingSeconds(state, now) > 0) return;

    const { state: next, finished } = finishPhase(state, config, now, true);
    handleFinished(finished, PHASE_LABEL[next.phase]);

    // "Start breaks automatically" only applies to a phase that ran out on its
    // own — a skipped phase is the user actively moving on, so it waits for them.
    const autoStart = autoStartBreaks && next.phase !== 'focus';
    setRawState(autoStart ? startTimer(next, Date.now(), config) : next);
  }, [autoStartBreaks, config, handleFinished, now, state]);

  /* ---------------------------------------------------------------------- */
  /* stats                                                                  */
  /* ---------------------------------------------------------------------- */

  const todayFocusMinutes = useMemo(() => {
    if (!today) return 0;
    const seconds = (focus.data?.sessions ?? [])
      .filter((session) => session.kind === 'focus' && toDateOnly(session.startedAtMs, zone) === today)
      .reduce((total, session) => total + session.actualSeconds, 0);
    return Math.round(seconds / 60);
  }, [focus.data, today, zone]);

  const toLongBreak = focusUntilLongBreak(state, config);
  const loading = !settings;

  return (
    <Box sx={{ pb: 5 }}>
      {/* No back control: the focus timer is a top-level destination reached
          from the tab bar's "More" sheet and the sidebar's Tools. */}
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
        <Toolbar sx={{ minHeight: 56, px: 1.5 }}>
          <Typography variant="h6" component="h1" noWrap>
            Focus
          </Typography>
        </Toolbar>
      </AppBar>

      {loading ? (
        <Box sx={{ px: 2, pt: 2 }}>
          <Skeleton variant="circular" width={200} height={200} sx={{ mx: 'auto' }} />
        </Box>
      ) : (
        <>
          <Box sx={{ px: 2, pt: 2, pb: 2 }}>
            <TextField
              select
              fullWidth
              label="Task to focus on"
              value={taskId}
              onChange={(event) => setTaskId(event.target.value)}
            >
              <MenuItem value="">No task</MenuItem>
              {(tasks.data ?? []).map((task) => (
                <MenuItem key={task.id} value={task.id}>
                  {task.title}
                </MenuItem>
              ))}
            </TextField>
          </Box>

          <Stack sx={{ alignItems: 'center', px: 3 }}>
            <Typography
              variant="subtitle1"
              sx={{ pb: 0.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'text.secondary' }}
            >
              {PHASE_LABEL[state.phase]}
            </Typography>
            <Typography variant="body2" color="text.disabled" sx={{ pb: 2.5 }}>
              {state.status === 'paused'
                ? 'Paused'
                : state.phase === 'focus'
                  ? `${toLongBreak} more ${toLongBreak === 1 ? 'session' : 'sessions'} until a long break`
                  : 'Break time'}
            </Typography>

            <Box sx={{ position: 'relative', display: 'inline-flex' }}>
              <CircularProgress
                variant="determinate"
                value={phaseProgress(state, now) * 100}
                size={200}
                // 8px of stroke on a 200px ring in Material's 44-unit viewBox.
                thickness={1.76}
                enableTrackSlot
                color={state.phase === 'focus' ? 'primary' : 'success'}
                aria-label={`${remaining} seconds remaining in the ${PHASE_LABEL[state.phase].toLowerCase()}`}
              />
              <Box
                sx={{
                  position: 'absolute',
                  inset: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Typography
                  variant="h4"
                  sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
                >
                  {formatClock(remaining)}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {formatClock(state.plannedSeconds)} planned
                </Typography>
              </Box>
            </Box>

            {/*
             * One row, three equal columns.
             *
             * The three controls used to be sized by their own content, so
             * Reset — the only plain one — read as smaller than the other two
             * and the group sat left of the ring's centre. Equal columns give
             * them one height, one baseline and one weight.
             */}
            <Stack direction="row" spacing={1} sx={{ mt: 3.5, width: '100%', maxWidth: 384 }}>
              {state.status === 'running' ? (
                <Button
                  size="large"
                  variant="contained"
                  color="inherit"
                  fullWidth
                  startIcon={<PauseIcon />}
                  onClick={onPause}
                  sx={{ px: 1, minWidth: 0, flex: 1 }}
                >
                  Pause
                </Button>
              ) : (
                <Button
                  size="large"
                  variant="contained"
                  fullWidth
                  startIcon={<PlayArrowIcon />}
                  onClick={onStart}
                  sx={{ px: 1, minWidth: 0, flex: 1 }}
                >
                  {state.status === 'paused' ? 'Resume' : 'Start'}
                </Button>
              )}
              <Button
                size="large"
                fullWidth
                startIcon={<SkipNextIcon />}
                onClick={onSkip}
                sx={{ px: 1, minWidth: 0, flex: 1, ...TINTED_SX }}
              >
                Skip
              </Button>
              <Button
                size="large"
                variant="contained"
                color="inherit"
                fullWidth
                startIcon={<RestartAltIcon />}
                onClick={onReset}
                sx={{ px: 1, minWidth: 0, flex: 1 }}
              >
                Reset
              </Button>
            </Stack>

            {selectedTask ? (
              <Typography variant="subtitle1" color="text.secondary" noWrap sx={{ mt: 2, maxWidth: 384 }}>
                {`Focusing on “${selectedTask.title}”`}
              </Typography>
            ) : null}
          </Stack>

          {offer ? (
            <Paper role="status" variant="outlined" sx={{ mx: 2, mt: 3, p: 2 }}>
              <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                Session complete — did you finish the task?
              </Typography>
              <Typography variant="body2" color="text.secondary" noWrap sx={{ mt: 0.25 }}>
                {offer.title}
              </Typography>
              <Stack direction="row" spacing={1} sx={{ mt: 1.5, alignItems: 'center' }}>
                <Button
                  variant="contained"
                  startIcon={<CheckIcon />}
                  loading={completeTask.isPending}
                  onClick={() => void completeTask.run(offer.id)}
                >
                  Complete task
                </Button>
                <Button onClick={() => setOffer(null)} sx={{ color: 'text.secondary' }}>
                  Not yet
                </Button>
              </Stack>
            </Paper>
          ) : null}

          <Paper
            variant="outlined"
            sx={{
              mx: 2,
              mt: 3,
              px: 2,
              py: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CheckIcon sx={{ fontSize: 16, color: 'success.main' }} aria-hidden />
              <Typography variant="body1">Focus sessions today</Typography>
            </Stack>
            <Typography variant="body1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {focus.data?.completedToday ?? 0}
            </Typography>
          </Paper>

          <Paper
            variant="outlined"
            sx={{
              mx: 2,
              mt: 1,
              px: 2,
              py: 1.5,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <TimerOutlinedIcon sx={{ fontSize: 16, color: 'primary.main' }} aria-hidden />
              <Typography variant="body1">Focus time today</Typography>
            </Stack>
            <Typography variant="body1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
              {todayFocusMinutes > 0 ? humanDuration(todayFocusMinutes) : '—'}
            </Typography>
          </Paper>

          <Typography variant="body2" color="text.secondary" sx={{ px: 2, pt: 2 }}>
            {config.focusMinutes} min focus · {config.shortBreakMinutes} min short break · {config.longBreakMinutes} min
            long break every {config.longBreakEvery} sessions.{' '}
            <Link component={NextLink} href="/settings/advanced" sx={{ fontWeight: 600 }}>
              Change in Settings
            </Link>
          </Typography>
        </>
      )}
    </Box>
  );
}
