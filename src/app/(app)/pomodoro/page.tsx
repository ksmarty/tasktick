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
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Pause, Play, RotateCcw, SkipForward, Timer } from 'lucide-react';
import { Button, NavBar, ProgressRing, Select, Skeleton, useToast } from '@/components/ui';
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

  const taskOptions = useMemo(
    () => [{ value: '', label: 'No task' }, ...(tasks.data ?? []).map((task) => ({ value: task.id, label: task.title }))],
    [tasks.data],
  );

  const toLongBreak = focusUntilLongBreak(state, config);
  const loading = !settings;

  return (
    <div className="min-h-dvh pb-10">
      <NavBar title="Focus" largeTitle back backHref="/tasks" backLabel="Tasks" />

      {loading ? (
        <div className="px-4">
          <Skeleton variant="circle" className="mx-auto size-64" />
        </div>
      ) : (
        <>
          <div className="px-4 pb-4">
            <Select
              value={taskId || ''}
              onChange={setTaskId}
              options={taskOptions}
              label="Task to focus on"
              placeholder="No task"
              sheetTitle="Focus on…"
            />
          </div>

          <div className="flex flex-col items-center px-6">
            <p className="pb-1 text-subhead font-semibold uppercase tracking-wide text-secondary">
              {PHASE_LABEL[state.phase]}
            </p>
            <p className="pb-5 text-footnote text-tertiary">
              {state.status === 'paused'
                ? 'Paused'
                : state.phase === 'focus'
                  ? `${toLongBreak} more ${toLongBreak === 1 ? 'session' : 'sessions'} until a long break`
                  : 'Break time'}
            </p>

            <ProgressRing
              value={phaseProgress(state, now)}
              size={260}
              strokeWidth={12}
              color={state.phase === 'focus' ? 'tint' : 'success'}
              label={`${remaining} seconds remaining in the ${PHASE_LABEL[state.phase].toLowerCase()}`}
            >
              <span className="tnum absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-title-1 font-semibold text-label">{formatClock(remaining)}</span>
                <span className="text-caption-1 text-secondary">{formatClock(state.plannedSeconds)} planned</span>
              </span>
            </ProgressRing>

            <div className="mt-7 flex w-full max-w-sm items-center justify-center gap-3">
              {state.status === 'running' ? (
                <Button size="lg" variant="gray" icon={Pause} onClick={onPause} className="flex-1">
                  Pause
                </Button>
              ) : (
                <Button size="lg" icon={Play} onClick={onStart} className="flex-1">
                  {state.status === 'paused' ? 'Resume' : 'Start'}
                </Button>
              )}
              <Button size="lg" variant="tinted" icon={SkipForward} onClick={onSkip}>
                Skip
              </Button>
              <Button size="lg" variant="plain" icon={RotateCcw} onClick={onReset}>
                Reset
              </Button>
            </div>

            {selectedTask ? (
              <p className="mt-4 max-w-sm truncate text-subhead text-secondary">Focusing on “{selectedTask.title}”</p>
            ) : null}
          </div>

          {offer ? (
            <div role="status" className="grouped mx-4 mt-6 p-4">
              <p className="text-subhead font-semibold text-label">Session complete — did you finish the task?</p>
              <p className="mt-0.5 truncate text-footnote text-secondary">{offer.title}</p>
              <div className="mt-3 flex gap-2">
                <Button
                  variant="filled"
                  icon={Check}
                  loading={completeTask.isPending}
                  onClick={() => void completeTask.run(offer.id)}
                >
                  Complete task
                </Button>
                <Button variant="plain" onClick={() => setOffer(null)}>
                  Not yet
                </Button>
              </div>
            </div>
          ) : null}

          <div className="grouped mx-4 mt-6 flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 text-body text-label">
              <Check className="size-4 text-success" aria-hidden />
              Focus sessions today
            </span>
            <span className="tnum text-body font-semibold text-label">{focus.data?.completedToday ?? 0}</span>
          </div>
          <div className="grouped mx-4 mt-2 flex items-center justify-between px-4 py-3">
            <span className="flex items-center gap-2 text-body text-label">
              <Timer className="size-4 text-tint" aria-hidden />
              Focus time today
            </span>
            <span className="tnum text-body font-semibold text-label">
              {todayFocusMinutes > 0 ? humanDuration(todayFocusMinutes) : '—'}
            </span>
          </div>

          <p className="px-4 pt-4 text-footnote text-secondary">
            Durations come from Settings → Advanced: {config.focusMinutes} min focus, {config.shortBreakMinutes} min short
            break, {config.longBreakMinutes} min long break, after every {config.longBreakEvery} focus sessions.
          </p>
        </>
      )}
    </div>
  );
}
