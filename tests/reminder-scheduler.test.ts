/**
 * The reminder ticker.
 *
 * The sweep itself is covered against a real database in `reminders.test.ts`.
 * What matters here is the part that made the original bug invisible — whether
 * the ticker starts at all, whether it keeps its own time, whether a sweep that
 * overruns its interval stacks up behind itself — and the punctuality the ticker
 * exists for: a reminder's fire time is a minute on the clock, so the sweep has
 * to happen on that minute, not sixty seconds after the process booted.
 *
 * The clock is pinned in `beforeEach` for that reason: the arithmetic below is
 * only meaningful against a known instant, and the assertions read as the sum
 * (`09:00:37.412` + `22_838 ms` = `09:01:00.250`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { sweep } = vi.hoisted(() => ({
  sweep: vi.fn(async () => ({ sent: 0, skipped: 0, failed: 0 })),
}));

vi.mock('@/server/services/reminders', () => ({ runReminderSweep: sweep }));

import {
  REMINDER_SETTLE_MS,
  delayUntilNextMinute,
  isReminderSchedulerRunning,
  resetReminderScheduler,
  runReminderTick,
  startReminderScheduler,
  stopReminderScheduler,
} from '@/server/services/reminder-scheduler';

/** The instant every test starts from: 22.588 s before the next minute. */
const NOW = Date.parse('2026-05-12T09:00:37.412Z');
/** Delay from NOW to the first tick. */
const FIRST_TICK_DELAY = 60_000 - 37_412 + REMINDER_SETTLE_MS;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  sweep.mockClear();
  sweep.mockImplementation(async () => ({ sent: 0, skipped: 0, failed: 0 }));
  resetReminderScheduler();
});

afterEach(() => {
  resetReminderScheduler();
  vi.useRealTimers();
});

describe('the delay to the next minute', () => {
  it('waits a whole minute from an exact boundary', () => {
    // Nothing is due at the instant a boundary passes: the sweep would ask "what
    // is due now" before the reminder's own minute had begun.
    expect(delayUntilNextMinute(Date.parse('2026-05-12T09:00:00.000Z'))).toBe(
      60_000 + REMINDER_SETTLE_MS,
    );
  });

  it('counts down the rest of the minute in progress', () => {
    expect(delayUntilNextMinute(NOW)).toBe(FIRST_TICK_DELAY);
    expect(delayUntilNextMinute(NOW)).toBe(22_838);
  });

  it('is short just before the boundary', () => {
    expect(delayUntilNextMinute(Date.parse('2026-05-12T09:59:59.900Z'))).toBe(100 + REMINDER_SETTLE_MS);
  });

  it('re-aligns after a late wake-up instead of walking the phase', () => {
    // A tick five seconds late (a blocked event loop, a paused container) must
    // aim at 09:02:00.250, so the next delay is five seconds short of a minute.
    // Rescheduling a flat minute would drift further off the clock every tick.
    const late = NOW + FIRST_TICK_DELAY + 5_000;
    expect(delayUntilNextMinute(late)).toBe(55_000);
  });
});

describe('the reminder ticker', () => {
  it('is not running until it is started', () => {
    expect(isReminderSchedulerRunning()).toBe(false);
  });

  it('sweeps at the top of the minute, not a minute after boot', async () => {
    startReminderScheduler();
    expect(isReminderSchedulerRunning()).toBe(true);

    await vi.advanceTimersByTimeAsync(FIRST_TICK_DELAY - 1);
    expect(sweep).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(1);
    // The sweep is handed the real clock, which is now a quarter second past
    // the minute — enough for a reminder due at 09:01:00 to be due.
    expect(sweep).toHaveBeenCalledWith(NOW + FIRST_TICK_DELAY);
  });

  it('keeps to the minute afterwards', async () => {
    startReminderScheduler();

    await vi.advanceTimersByTimeAsync(FIRST_TICK_DELAY);
    expect(sweep).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(59_999);
    expect(sweep).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(sweep).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(sweep).toHaveBeenCalledTimes(3);
  });

  it('starts one ticker however many times it is asked', async () => {
    startReminderScheduler();
    startReminderScheduler();

    await vi.advanceTimersByTimeAsync(FIRST_TICK_DELAY);

    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it('stops ticking when stopped', async () => {
    startReminderScheduler();
    stopReminderScheduler();

    await vi.advanceTimersByTimeAsync(60_000 * 3);

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
    await vi.advanceTimersByTimeAsync(FIRST_TICK_DELAY);
    await vi.advanceTimersByTimeAsync(60_000);

    // The catch is in the timer callback rather than in `runReminderTick`, which
    // is why this drives the ticker instead of awaiting a tick: one bad sweep
    // must not take the ticker down with it.
    expect(error).toHaveBeenCalled();
    expect(sweep).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
