/**
 * The Pomodoro state machine.
 *
 * Pure and clock-injected: every function takes `nowMs` rather than reading the
 * clock, so the transitions are deterministic and testable.
 *
 * The important design decision is that a running phase stores the **epoch
 * millisecond it will end at** instead of a decrementing counter. A browser
 * throttles timers in a background tab (and suspends them entirely on iOS), so
 * a counter would silently lose minutes; deriving the remaining time from
 * `endsAtMs` means the timer is right the moment the tab is looked at again,
 * with no catch-up arithmetic.
 */
export type FocusPhase = 'focus' | 'short_break' | 'long_break';
export type TimerStatus = 'idle' | 'running' | 'paused';

export interface TimerConfig {
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** A long break is offered after every Nth completed focus phase. */
  longBreakEvery: number;
}

export const DEFAULT_TIMER_CONFIG: TimerConfig = {
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
};

export interface TimerState {
  phase: FocusPhase;
  status: TimerStatus;
  /** Epoch ms the running phase ends. `null` unless `status === 'running'`. */
  endsAtMs: number | null;
  /** Seconds left. Authoritative while idle or paused; recomputed while running. */
  remainingSeconds: number;
  /** Length of the current phase when it was started. */
  plannedSeconds: number;
  /** Focus phases completed since the last long break. */
  focusSinceLongBreak: number;
  /** Focus phases completed in this sitting. */
  completedFocus: number;
}

/** A phase that has just ended, used to persist it and to announce it. */
export interface FinishedPhase {
  phase: FocusPhase;
  /** False when the user skipped it. */
  completed: boolean;
  plannedSeconds: number;
  /** How long the user actually spent in the phase. */
  elapsedSeconds: number;
}

function clampMinutes(value: number, fallback: number): number {
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(1, Math.round(value));
}

/** Coerces settings values (and nonsense) into a usable configuration. */
export function timerConfigFrom(input: Partial<TimerConfig>): TimerConfig {
  return {
    focusMinutes: clampMinutes(input.focusMinutes ?? NaN, DEFAULT_TIMER_CONFIG.focusMinutes),
    shortBreakMinutes: clampMinutes(input.shortBreakMinutes ?? NaN, DEFAULT_TIMER_CONFIG.shortBreakMinutes),
    longBreakMinutes: clampMinutes(input.longBreakMinutes ?? NaN, DEFAULT_TIMER_CONFIG.longBreakMinutes),
    longBreakEvery: Math.min(12, Math.max(1, Math.round(input.longBreakEvery ?? DEFAULT_TIMER_CONFIG.longBreakEvery))),
  };
}

/** Length of a phase in seconds. */
export function phaseSeconds(phase: FocusPhase, config: TimerConfig): number {
  switch (phase) {
    case 'short_break':
      return timerConfigFrom(config).shortBreakMinutes * 60;
    case 'long_break':
      return timerConfigFrom(config).longBreakMinutes * 60;
    case 'focus':
    default:
      return timerConfigFrom(config).focusMinutes * 60;
  }
}

export function initialTimerState(config: TimerConfig = DEFAULT_TIMER_CONFIG): TimerState {
  const planned = phaseSeconds('focus', config);
  return {
    phase: 'focus',
    status: 'idle',
    endsAtMs: null,
    remainingSeconds: planned,
    plannedSeconds: planned,
    focusSinceLongBreak: 0,
    completedFocus: 0,
  };
}

/**
 * Seconds left right now.
 *
 * This is the single source of truth for the displayed time: a running timer is
 * always recomputed from `endsAtMs`, so throttling costs nothing.
 */
export function remainingSeconds(state: TimerState, nowMs: number): number {
  if (state.status !== 'running' || state.endsAtMs === null) return Math.max(0, state.remainingSeconds);
  return Math.max(0, Math.round((state.endsAtMs - nowMs) / 1000));
}

export function isFinished(state: TimerState, nowMs: number): boolean {
  return state.status === 'running' && remainingSeconds(state, nowMs) <= 0;
}

/** Starts the current phase (also used to start a phase for the first time). */
export function startTimer(state: TimerState, nowMs: number, config: TimerConfig = DEFAULT_TIMER_CONFIG): TimerState {
  const planned = state.plannedSeconds > 0 ? state.plannedSeconds : phaseSeconds(state.phase, config);
  const remaining = state.remainingSeconds > 0 ? state.remainingSeconds : planned;
  return { ...state, status: 'running', plannedSeconds: planned, remainingSeconds: remaining, endsAtMs: nowMs + remaining * 1000 };
}

/**
 * Re-reads the phase length from the settings while the timer is idle.
 *
 * Applied as a pure derivation on every render, so changing "focus 25 min" to
 * "focus 50 min" in the settings shows up immediately without disturbing a run
 * that is already in flight.
 */
export function applyConfig(state: TimerState, config: TimerConfig): TimerState {
  if (state.status !== 'idle') return state;
  const planned = phaseSeconds(state.phase, config);
  if (planned === state.plannedSeconds) return state;
  return { ...state, plannedSeconds: planned, remainingSeconds: planned };
}

export function pauseTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status !== 'running') return state;
  return { ...state, status: 'paused', remainingSeconds: remainingSeconds(state, nowMs), endsAtMs: null };
}

export function resumeTimer(state: TimerState, nowMs: number): TimerState {
  if (state.status !== 'paused') return state;
  return { ...state, status: 'running', endsAtMs: nowMs + state.remainingSeconds * 1000 };
}

/** Back to a fresh focus phase, counters cleared. */
export function resetTimer(config: TimerConfig = DEFAULT_TIMER_CONFIG): TimerState {
  return initialTimerState(config);
}

/** The next phase after a completed focus phase, honouring the long-break cadence. */
export function nextPhaseAfterFocus(focusSinceLongBreak: number, config: TimerConfig): FocusPhase {
  const every = timerConfigFrom(config).longBreakEvery;
  return focusSinceLongBreak >= every ? 'long_break' : 'short_break';
}

function stateForPhase(phase: FocusPhase, config: TimerConfig, counters: Pick<TimerState, 'focusSinceLongBreak' | 'completedFocus'>): TimerState {
  const planned = phaseSeconds(phase, config);
  return {
    phase,
    status: 'idle',
    endsAtMs: null,
    remainingSeconds: planned,
    plannedSeconds: planned,
    ...counters,
  };
}

export interface PhaseTransition {
  state: TimerState;
  finished: FinishedPhase;
}

/**
 * Ends the current phase and moves to the next one.
 *
 * `completed` is false for a skip: the phase is persisted as abandoned and the
 * focus cadence does not advance, because an abandoned focus session is not a
 * Pomodoro.
 */
export function finishPhase(state: TimerState, config: TimerConfig, nowMs: number, completed: boolean): PhaseTransition {
  const planned = state.plannedSeconds || phaseSeconds(state.phase, config);
  const left = remainingSeconds(state, nowMs);
  const finished: FinishedPhase = {
    phase: state.phase,
    completed,
    plannedSeconds: planned,
    elapsedSeconds: Math.max(0, Math.min(planned, planned - left)),
  };

  if (state.phase === 'focus') {
    if (!completed) {
      // A skipped focus session earns a short break, never a long one, and the
      // cadence counters stay where they were.
      const counters = { focusSinceLongBreak: state.focusSinceLongBreak, completedFocus: state.completedFocus };
      return { state: stateForPhase('short_break', config, counters), finished };
    }
    const focusSinceLongBreak = state.focusSinceLongBreak + 1;
    const counters = { focusSinceLongBreak, completedFocus: state.completedFocus + 1 };
    return { state: stateForPhase(nextPhaseAfterFocus(focusSinceLongBreak, config), config, counters), finished };
  }

  // A break — finished or skipped — always hands back to a focus phase. A long
  // break resets the cadence counter; a short one leaves it alone.
  const counters = {
    focusSinceLongBreak: state.phase === 'long_break' ? 0 : state.focusSinceLongBreak,
    completedFocus: state.completedFocus,
  };
  return { state: stateForPhase('focus', config, counters), finished };
}

/** Convenience wrapper: end a phase early because the user asked to skip. */
export function skipPhase(state: TimerState, config: TimerConfig, nowMs: number): PhaseTransition {
  return finishPhase(state, config, nowMs, false);
}

/** `0..1` of the phase already elapsed, for the progress ring. */
export function phaseProgress(state: TimerState, nowMs: number): number {
  const planned = state.plannedSeconds || 1;
  const left = remainingSeconds(state, nowMs);
  return Math.min(1, Math.max(0, (planned - left) / planned));
}

/** True when the timer should be showing "start" rather than "pause". */
export function isStartable(state: TimerState): boolean {
  return state.status === 'idle' || state.status === 'paused';
}

/** How many more focus phases before the next long break is offered. */
export function focusUntilLongBreak(state: TimerState, config: TimerConfig): number {
  const every = timerConfigFrom(config).longBreakEvery;
  return Math.max(0, every - state.focusSinceLongBreak);
}
