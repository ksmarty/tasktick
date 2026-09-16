/**
 * The Pomodoro state machine: phase transitions, the long-break cadence and the
 * end-timestamp arithmetic that keeps the timer honest under tab throttling.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TIMER_CONFIG,
  applyConfig,
  finishPhase,
  focusUntilLongBreak,
  initialTimerState,
  isFinished,
  isStartable,
  pauseTimer,
  phaseProgress,
  phaseSeconds,
  remainingSeconds,
  resetTimer,
  resumeTimer,
  skipPhase,
  startTimer,
  timerConfigFrom,
  type TimerConfig,
  type TimerState,
} from '@/app/(app)/pomodoro/timer';

const T0 = 1_700_000_000_000;
const CONFIG: TimerConfig = { focusMinutes: 25, shortBreakMinutes: 5, longBreakMinutes: 15, longBreakEvery: 4 };

/** Runs one focus phase to completion, returning the state and the transition. */
function completeFocus(state: TimerState, at: number, config: TimerConfig = CONFIG) {
  const running = startTimer(state, at, config);
  return finishPhase(running, config, at + running.plannedSeconds * 1000, true);
}

/** Takes whatever break is currently on the clock, so the next phase is a focus. */
function takeBreak(state: TimerState, at: number, config: TimerConfig = CONFIG): TimerState {
  return finishPhase(startTimer(state, at, config), config, at + phaseSeconds(state.phase, config) * 1000, true).state;
}

/** Runs `count` complete focus sessions, taking each break that is offered. */
function runFocusSessions(
  count: number,
  start: TimerState = initialTimerState(CONFIG),
  config: TimerConfig = CONFIG,
): { state: TimerState; phases: TimerState['phase'][] } {
  let state = start;
  const phases: TimerState['phase'][] = [];

  for (let session = 0; session < count; session += 1) {
    if (state.phase !== 'focus') state = takeBreak(state, T0, config);
    const transition = completeFocus(state, T0, config);
    phases.push(transition.state.phase);
    state = transition.state;
  }

  return { state, phases };
}

describe('timerConfigFrom', () => {
  it('keeps sensible values', () => {
    expect(timerConfigFrom({ focusMinutes: 50, shortBreakMinutes: 10, longBreakMinutes: 20, longBreakEvery: 3 })).toEqual({
      focusMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 20,
      longBreakEvery: 3,
    });
  });

  it('replaces nonsense with the defaults instead of producing a broken timer', () => {
    expect(timerConfigFrom({ focusMinutes: 0 }).focusMinutes).toBe(25);
    expect(timerConfigFrom({ focusMinutes: -5 }).focusMinutes).toBe(25);
    expect(timerConfigFrom({ focusMinutes: Number.NaN }).focusMinutes).toBe(25);
    expect(timerConfigFrom({ longBreakEvery: 0 }).longBreakEvery).toBe(1);
    expect(timerConfigFrom({ longBreakEvery: 99 }).longBreakEvery).toBe(12);
    expect(timerConfigFrom({}).focusMinutes).toBe(DEFAULT_TIMER_CONFIG.focusMinutes);
  });
});

describe('phaseSeconds', () => {
  it('reads each phase length from the settings', () => {
    expect(phaseSeconds('focus', CONFIG)).toBe(1500);
    expect(phaseSeconds('short_break', CONFIG)).toBe(300);
    expect(phaseSeconds('long_break', CONFIG)).toBe(900);
  });
});

describe('initialTimerState', () => {
  it('starts idle on a full focus phase with no history', () => {
    const state = initialTimerState(CONFIG);

    expect(state.phase).toBe('focus');
    expect(state.status).toBe('idle');
    expect(state.endsAtMs).toBeNull();
    expect(state.remainingSeconds).toBe(1500);
    expect(state.plannedSeconds).toBe(1500);
    expect(state.focusSinceLongBreak).toBe(0);
    expect(state.completedFocus).toBe(0);
    expect(isStartable(state)).toBe(true);
  });
});

describe('start / pause / resume', () => {
  it('stores the end timestamp rather than counting down', () => {
    const running = startTimer(initialTimerState(CONFIG), T0, CONFIG);

    expect(running.status).toBe('running');
    expect(running.endsAtMs).toBe(T0 + 1_500_000);
    expect(remainingSeconds(running, T0)).toBe(1500);
    expect(remainingSeconds(running, T0 + 60_000)).toBe(1440);
    expect(isStartable(running)).toBe(false);
  });

  it('is accurate after a throttled tab wakes up minutes late', () => {
    const running = startTimer(initialTimerState(CONFIG), T0, CONFIG);

    // No ticks ever ran; ten minutes simply passed.
    expect(remainingSeconds(running, T0 + 600_000)).toBe(900);
    expect(remainingSeconds(running, T0 + 1_500_000)).toBe(0);
    expect(remainingSeconds(running, T0 + 9_999_999)).toBe(0);
    expect(isFinished(running, T0 + 1_500_001)).toBe(true);
    expect(isFinished(running, T0 + 1_000_000)).toBe(false);
  });

  it('freezes the remaining time while paused', () => {
    const running = startTimer(initialTimerState(CONFIG), T0, CONFIG);
    const paused = pauseTimer(running, T0 + 90_000);

    expect(paused.status).toBe('paused');
    expect(paused.endsAtMs).toBeNull();
    expect(paused.remainingSeconds).toBe(1410);
    // Ten more real minutes of being paused cost nothing.
    expect(remainingSeconds(paused, T0 + 690_000)).toBe(1410);
  });

  it('resumes from where it was paused', () => {
    const paused = pauseTimer(startTimer(initialTimerState(CONFIG), T0, CONFIG), T0 + 90_000);
    const resumed = resumeTimer(paused, T0 + 600_000);

    expect(resumed.status).toBe('running');
    expect(resumed.endsAtMs).toBe(T0 + 600_000 + 1_410_000);
    expect(remainingSeconds(resumed, T0 + 600_000)).toBe(1410);
  });

  it('ignores pause and resume in the wrong state', () => {
    const idle = initialTimerState(CONFIG);
    expect(pauseTimer(idle, T0)).toBe(idle);
    expect(resumeTimer(idle, T0)).toBe(idle);
  });
});

describe('applyConfig', () => {
  it('re-reads the phase length while the timer is idle', () => {
    const shorter = applyConfig(initialTimerState(CONFIG), { ...CONFIG, focusMinutes: 50 });

    expect(shorter.plannedSeconds).toBe(3000);
    expect(shorter.remainingSeconds).toBe(3000);
  });

  it('never disturbs a run that is already in flight', () => {
    const running = startTimer(initialTimerState(CONFIG), T0, CONFIG);
    expect(applyConfig(running, { ...CONFIG, focusMinutes: 50 })).toBe(running);
  });
});

describe('focus phase completion', () => {
  it('hands over a short break and counts the session', () => {
    const { state, finished } = completeFocus(initialTimerState(CONFIG), T0);

    expect(finished).toEqual({ phase: 'focus', completed: true, plannedSeconds: 1500, elapsedSeconds: 1500 });
    expect(state.phase).toBe('short_break');
    expect(state.status).toBe('idle');
    expect(state.remainingSeconds).toBe(300);
    expect(state.completedFocus).toBe(1);
    expect(state.focusSinceLongBreak).toBe(1);
  });

  it('offers a long break after every Nth completed focus session', () => {
    const { state, phases } = runFocusSessions(8);

    expect(phases).toEqual([
      'short_break',
      'short_break',
      'short_break',
      'long_break',
      'short_break',
      'short_break',
      'short_break',
      'long_break',
    ]);
    expect(state.completedFocus).toBe(8);
    expect(state.focusSinceLongBreak).toBe(4);
    expect(state.phase).toBe('long_break');
  });

  it('resets the cadence counter only when a long break ends', () => {
    const { state } = runFocusSessions(4);

    expect(state.phase).toBe('long_break');
    expect(state.focusSinceLongBreak).toBe(4);

    const afterLong = takeBreak(state, T0);
    expect(afterLong.phase).toBe('focus');
    expect(afterLong.focusSinceLongBreak).toBe(0);
    expect(afterLong.completedFocus).toBe(4);

    const shortBreak = completeFocus(afterLong, T0);
    expect(shortBreak.state.phase).toBe('short_break');
    expect(shortBreak.state.focusSinceLongBreak).toBe(1);
    // A short break keeps the counter where it is.
    expect(takeBreak(shortBreak.state, T0).focusSinceLongBreak).toBe(1);
  });

  it('respects a cadence of one', () => {
    const config = { ...CONFIG, longBreakEvery: 1 };
    expect(completeFocus(initialTimerState(config), T0, config).state.phase).toBe('long_break');
  });

  it('reports how long the phase actually ran', () => {
    const running = startTimer(initialTimerState(CONFIG), T0, CONFIG);
    const abandoned = finishPhase(running, CONFIG, T0 + 120_000, false);

    expect(abandoned.finished.elapsedSeconds).toBe(120);
    expect(abandoned.finished.completed).toBe(false);
  });
});

describe('skipping', () => {
  it('leaves a focus phase for a short break without earning a Pomodoro', () => {
    const running = startTimer(initialTimerState(CONFIG), T0, CONFIG);
    const { state, finished } = skipPhase(running, CONFIG, T0 + 60_000);

    expect(finished.completed).toBe(false);
    expect(finished.elapsedSeconds).toBe(60);
    expect(state.phase).toBe('short_break');
    expect(state.completedFocus).toBe(0);
    expect(state.focusSinceLongBreak).toBe(0);
  });

  it('never promotes a skip to a long break, even at the cadence boundary', () => {
    const atBoundary: TimerState = { ...initialTimerState(CONFIG), focusSinceLongBreak: 4 };

    const skipped = skipPhase(startTimer(atBoundary, T0, CONFIG), CONFIG, T0 + 1000);
    expect(skipped.state.phase).toBe('short_break');

    // Take the short break, then complete a real focus session: the long break
    // owed from the boundary is still honoured.
    const afterBreak = takeBreak(skipped.state, T0);
    const next = completeFocus(afterBreak, T0);
    expect(next.state.phase).toBe('long_break');
    expect(next.state.focusSinceLongBreak).toBe(5);
  });

  it('skips a break back into focus', () => {
    const breakState = completeFocus(initialTimerState(CONFIG), T0).state;
    const skipped = skipPhase(startTimer(breakState, T0, CONFIG), CONFIG, T0 + 1000);

    expect(skipped.state.phase).toBe('focus');
    expect(skipped.state.completedFocus).toBe(1);
  });
});

describe('resetTimer', () => {
  it('returns to a fresh focus phase and forgets the sitting', () => {
    const state = resetTimer(CONFIG);

    expect(state).toEqual(initialTimerState(CONFIG));
    expect(state.completedFocus).toBe(0);
  });
});

describe('phaseProgress', () => {
  it('tracks the elapsed fraction of the phase', () => {
    const running = startTimer(initialTimerState(CONFIG), T0, CONFIG);

    expect(phaseProgress(running, T0)).toBe(0);
    expect(phaseProgress(running, T0 + 750_000)).toBeCloseTo(0.5, 6);
    expect(phaseProgress(running, T0 + 1_500_000)).toBe(1);
    expect(phaseProgress(running, T0 + 5_000_000)).toBe(1);
  });

  it('is zero for a phase that has not started', () => {
    expect(phaseProgress(initialTimerState(CONFIG), T0)).toBe(0);
  });
});

describe('focusUntilLongBreak', () => {
  it('counts down to the next long break', () => {
    expect(focusUntilLongBreak(initialTimerState(CONFIG), CONFIG)).toBe(4);
    expect(focusUntilLongBreak({ ...initialTimerState(CONFIG), focusSinceLongBreak: 3 }, CONFIG)).toBe(1);
    expect(focusUntilLongBreak({ ...initialTimerState(CONFIG), focusSinceLongBreak: 4 }, CONFIG)).toBe(0);
  });
});
