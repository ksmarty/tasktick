/**
 * The reminder ticker.
 *
 * The sweep itself is covered against a real database in `reminders.test.ts`.
 * What matters here is the part that made the original bug invisible: whether the
 * ticker starts at all, whether it keeps its own time, and whether a sweep that
 * overruns its interval stacks up behind itself.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sweep } = vi.hoisted(() => ({
  sweep: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0 })),
}));

vi.mock('@/server/services/reminders', () => ({ runReminderSweep: sweep }));

import {
  REMINDER_TICK_SECONDS,
  isReminderSchedulerRunning,
  resetReminderScheduler,
  runReminderTick,
  startReminderScheduler,
  stopReminderScheduler,
} from '@/server/services/reminder-scheduler';

const TICK_MS = REMINDER_TICK_SECONDS * 1000;

beforeEach(() => {
  vi.useFakeTimers();
  sweep.mockClear();
  sweep.mockImplementation(async () => ({ sent: 0, skipped: 0, failed: 0 }));
  resetReminderScheduler();
});

afterEach(() => {
  resetReminderScheduler();
  vi.useRealTimers();
});

describe('the reminder ticker', () => {
  it('is not running until it is started', () => {
    expect(isReminderSchedulerRunning()).toBe(false);
  });

  it('sweeps once per interval', async () => {
    startReminderScheduler();
    expect(isReminderSchedulerRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(sweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(TICK_MS);
    expect(sweep).toHaveBeenCalledTimes(2);
  });

  it('starts one ticker however many times it is asked', async () => {
    startReminderScheduler();
    startReminderScheduler();

    await vi.advanceTimersByTimeAsync(TICK_MS);

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('stops ticking when stopped', async () => {
    startReminderScheduler();
    stopReminderScheduler();

    await vi.advanceTimersByTimeAsync(TICK_MS * 3);

    expect(sweep).not.toHaveBeenCalled();
    expect(isReminderSchedulerRunning()).toBe(false);
  });

  it('refuses to stack a second sweep behind an overrunning one', async () => {
    let release = (): void => {};
    sweep.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ sent: 0, skipped: 0, failed: 0 });
        }),
    );

    const first = runReminderTick();
    const second = runReminderTick();
    await second;

    // Refused, not queued: nothing is lost by skipping, because the next tick
    // finds the same reminders still inside the grace window.
    expect(sweep).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('survives a failed sweep and keeps ticking', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    sweep.mockRejectedValueOnce(new Error('database is down'));

    startReminderScheduler();
    await vi.advanceTimersByTimeAsync(TICK_MS);
    await vi.advanceTimersByTimeAsync(TICK_MS);

    // The catch is in the interval callback rather than in `runReminderTick`,
    // which is why this drives the ticker instead of awaiting a tick: one bad
    // sweep must not take the ticker down with it.
    expect(error).toHaveBeenCalled();
    expect(sweep).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
