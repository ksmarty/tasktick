'use client';

/**
 * The focus timer.
 *
 * The state machine lives in `./timer` (pure, tested); this page wires it to the
 * clock, to the settings, and to the focus-session API. None of that moved.
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
 * Only the presentation changed: the top bar is published to the shell through
 * `PageHeader`, the phase ring is an SVG drawn from the pure geometry in
 * `./ring` (shadcn has no circular progress and a linear bar would have lost the
 * ring the reference layout is built around), the controls are shadcn `Button`s,
 * the task picker is a shadcn `Select`, and the two summary rows are cards.
 * The end of a focus phase also fires the GodUI `Confetti` burst, which is the
 * celebratory moment it exists for.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import NextLink from 'next/link';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { LapTimerIcon } from '@svg-animated-icons/react/lap-timer';
import { PauseIcon } from '@svg-animated-icons/react/pause';
import { PlayIcon } from '@svg-animated-icons/react/play';
import { ResetIcon } from '@svg-animated-icons/react/reset';
import { ResumeIcon } from '@svg-animated-icons/react/resume';
import { TrackNextIcon } from '@svg-animated-icons/react/track-next';
import { PageHeader } from '@/components/app/PageHeader';
import { Confetti, type ConfettiHandle } from '@/components/godui/confetti';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/app/Toast';
import { api, errorMessage } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { formatClock, humanDuration, todayIn, toDateOnly } from '@/lib/dates';
import { notifyPeriodEnd, playChime } from './feedback';
import { ringGeometry } from './ring';
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

/** The sentinel for "no task" — Radix `Select` cannot hold an empty value. */
const NO_TASK = 'none';

export default function PomodoroPage() {
  const { toast } = useToast();
  const confettiRef = useRef<ConfettiHandle>(null);

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
    // A finished focus session is the one moment on this screen worth a burst.
    if (wasFocus) confettiRef.current?.fire({ particleCount: 140, origin: { y: 0.65 } });
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

  const ring = ringGeometry(phaseProgress(state, now));
  const isFocusPhase = state.phase === 'focus';
  const phaseLabel = PHASE_LABEL[state.phase];

  return (
    <>
      {/* No back control: the focus timer is a top-level destination reached
          from the tab bar's "More" sheet and the sidebar's Tools. */}
      <PageHeader title="Focus" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-stack px-gutter py-card">
        {loading ? (
          <Skeleton className="mx-auto size-50 rounded-full" />
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <Label id="focus-task-label">Task to focus on</Label>
              <Select value={taskId || NO_TASK} onValueChange={(value) => setTaskId(value === NO_TASK ? '' : value)}>
                <SelectTrigger aria-labelledby="focus-task-label" className="w-full">
                  <SelectValue placeholder="No task" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_TASK}>No task</SelectItem>
                  {(tasks.data ?? []).map((task) => (
                    <SelectItem key={task.id} value={task.id}>
                      {task.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col items-center gap-1">
              <span className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{phaseLabel}</span>
              <span className="text-sm text-muted-foreground">
                {state.status === 'paused'
                  ? 'Paused'
                  : isFocusPhase
                    ? `${toLongBreak} more ${toLongBreak === 1 ? 'session' : 'sessions'} until a long break`
                    : 'Break time'}
              </span>
            </div>

            {/*
             * The ring: an SVG, because shadcn has no circular progress and a
             * linear bar would have lost the shape the whole screen is built
             * around. Its geometry comes from `./ring` so the arc maths stays
             * testable; only the paint is here.
             */}
            <div className="relative mx-auto flex size-50 items-center justify-center">
              <svg
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ring.progress * 100)}
                aria-label={`${remaining} seconds remaining in the ${phaseLabel.toLowerCase()}`}
                width={ring.size}
                height={ring.size}
                viewBox={`0 0 ${ring.size} ${ring.size}`}
                className="absolute inset-0 -rotate-90"
              >
                <circle
                  cx={ring.center}
                  cy={ring.center}
                  r={ring.radius}
                  fill="none"
                  strokeWidth={ring.stroke}
                  className="stroke-muted"
                />
                <circle
                  cx={ring.center}
                  cy={ring.center}
                  r={ring.radius}
                  fill="none"
                  strokeWidth={ring.stroke}
                  strokeLinecap="round"
                  className={isFocusPhase ? 'stroke-primary' : 'stroke-chart-2'}
                  // A measured arc, not a spacing value: the only inline style
                  // the ring can have.
                  style={{
                    strokeDasharray: ring.dashArray,
                    strokeDashoffset: ring.dashOffset,
                    transition: 'stroke-dashoffset 250ms linear',
                  }}
                />
              </svg>
              <div className="flex flex-col items-center">
                <span className="text-3xl font-semibold tabular-nums">{formatClock(remaining)}</span>
                <span className="text-xs text-muted-foreground">{formatClock(state.plannedSeconds)} planned</span>
              </div>
            </div>

            {/*
             * One row, three equal columns.
             *
             * The three controls used to be sized by their own content, so
             * Reset — the only plain one — read as smaller than the other two
             * and the group sat left of the ring's centre. Equal columns give
             * them one height, one baseline and one weight.
             */}
            <div className="mx-auto flex w-full max-w-sm items-center gap-2">
              {state.status === 'running' ? (
                <Button type="button" size="lg" className="flex-1 gap-2" onClick={onPause}>
                  <PauseIcon />
                  Pause
                </Button>
              ) : (
                <Button type="button" size="lg" className="flex-1 gap-2" onClick={onStart}>
                  {state.status === 'paused' ? <ResumeIcon /> : <PlayIcon />}
                  {state.status === 'paused' ? 'Resume' : 'Start'}
                </Button>
              )}
              <Button type="button" size="lg" variant="secondary" className="flex-1 gap-2" onClick={onSkip}>
                <TrackNextIcon />
                Skip
              </Button>
              <Button type="button" size="lg" variant="outline" className="flex-1 gap-2" onClick={onReset}>
                <ResetIcon />
                Reset
              </Button>
            </div>

            {selectedTask ? (
              <p className="mx-auto max-w-sm truncate text-center text-base text-muted-foreground">
                {`Focusing on “${selectedTask.title}”`}
              </p>
            ) : null}

            {offer ? (
              <div role="status" className="rounded-xl border border-border bg-card p-card text-card-foreground">
                <p className="text-base font-semibold">Session complete — did you finish the task?</p>
                <p className="mt-1 truncate text-sm text-muted-foreground">{offer.title}</p>
                <div className="mt-4 flex items-center gap-2">
                  <Button
                    type="button"
                    className="gap-2"
                    disabled={completeTask.isPending}
                    aria-busy={completeTask.isPending}
                    onClick={() => void completeTask.run(offer.id)}
                  >
                    <CheckIcon />
                    Complete task
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setOffer(null)}>
                    Not yet
                  </Button>
                </div>
              </div>
            ) : null}

            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between rounded-xl border border-border bg-card px-card py-3 text-card-foreground">
                <span className="flex items-center gap-2 text-base">
                  <CheckIcon className="text-chart-2" />
                  Focus sessions today
                </span>
                <span className="font-semibold tabular-nums">{focus.data?.completedToday ?? 0}</span>
              </div>

              <div className="flex items-center justify-between rounded-xl border border-border bg-card px-card py-3 text-card-foreground">
                <span className="flex items-center gap-2 text-base">
                  <LapTimerIcon className="text-primary" />
                  Focus time today
                </span>
                <span className="font-semibold tabular-nums">
                  {todayFocusMinutes > 0 ? humanDuration(todayFocusMinutes) : '—'}
                </span>
              </div>
            </div>

            <p className="text-sm text-muted-foreground">
              {config.focusMinutes} min focus · {config.shortBreakMinutes} min short break · {config.longBreakMinutes} min
              long break every {config.longBreakEvery} sessions.{' '}
              <NextLink href="/settings/advanced" className="font-semibold text-primary underline-offset-4 hover:underline">
                Change in Settings
              </NextLink>
            </p>
          </>
        )}
      </div>

      {/*
       * Mounted once and driven imperatively: the burst celebrates a phase that
       * ended, it is not state the page re-renders over.
       */}
      <Confetti ref={confettiRef} />
    </>
  );
}
