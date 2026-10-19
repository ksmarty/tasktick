/**
 * The reminder ticker.
 *
 * Deliberately separate from the CalDAV ticker, for two reasons:
 *
 *  - **Cadence.** A reminder wants to land near its time. `SYNC_TICK_SECONDS`
 *    defaults to fifteen minutes, which would make every reminder up to a
 *    quarter of an hour late. This one wakes at the top of every minute.
 *  - **Reach.** The CalDAV ticker only starts when the instance has a syncable
 *    account or a feed (`ensureSyncScheduler`). Gating reminders on it would mean
 *    an account whose only integrations are habits got a scheduler that never
 *    started — silently, because there is nothing to show an error on.
 *
 * The tick is aligned to the wall clock rather than spaced one minute from
 * whenever the process started. A plain sixty-second interval keeps perfect
 * cadence but an arbitrary phase, so a reminder set for 09:00 could be announced
 * at 09:00:47 — the reminder's fire time is a minute on the clock, so the wake-up
 * is scheduled against the clock too.
 *
 * It is cheap by construction: this module imports no CalDAV transport and no
 * iCalendar codec, only the dispatcher and the repositories it reads.
 */
import { runReminderSweep } from './reminders';

/** One minute: the granularity a reminder's fire time has. */
export const REMINDER_TICK_MS = 60_000;

/**
 * How far past the top of the minute the sweep runs.
 *
 * Not zero: `setTimeout` may fire a hair early, and a sweep that asks for "what
 * is due now" two milliseconds before the minute would find the reminder not yet
 * due and leave it for the next tick a whole minute later. A quarter of a second
 * is invisible to a person and makes that race impossible.
 */
export const REMINDER_SETTLE_MS = 250;

let timer: ReturnType<typeof setTimeout> | null = null;
let ticking = false;

export function isReminderSchedulerRunning(): boolean {
  return timer !== null;
}

/**
 * Milliseconds from `nowMs` until the next sweep: the coming minute boundary plus
 * the settle offset.
 */
export function delayUntilNextMinute(nowMs: number, settleMs: number = REMINDER_SETTLE_MS): number {
  const boundary = Math.floor(nowMs / REMINDER_TICK_MS) * REMINDER_TICK_MS + REMINDER_TICK_MS;
  return boundary - nowMs + settleMs;
}

/**
 * One tick. Re-entrancy is refused rather than queued: a sweep that overruns the
 * interval means the database is slow, and stacking sweeps would only add
 * pressure. Nothing is lost by skipping — the next tick finds the same reminders
 * still inside the grace window.
 */
export async function runReminderTick(nowMs: number = Date.now()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const counts = await runReminderSweep(nowMs);
    if (counts.sent > 0 || counts.failed > 0) {
      console.log(`[reminder] sent ${counts.sent}, failed ${counts.failed}, skipped ${counts.skipped}`);
    }
  } finally {
    ticking = false;
  }
}

/**
 * Arms the next tick. The following one is computed when this one fires, not when
 * it was scheduled, so a wake-up that was late by a few seconds re-aligns to the
 * minute instead of walking the phase forward a little every minute.
 */
function scheduleNextTick(): void {
  const handle = setTimeout(() => {
    void runReminderTick().catch((error: unknown) => {
      console.error('[reminder] tick failed:', error);
    });
    scheduleNextTick();
  }, delayUntilNextMinute(Date.now()));
  // Unref'd so a pending wake-up never blocks process shutdown.
  handle.unref();
  timer = handle;
}

/**
 * Starts the ticker. Idempotent. The first sweep is at the next minute boundary,
 * which is at most a minute away and, after a restart, still inside the grace
 * window for anything that fell due while the process was down.
 */
export function startReminderScheduler(): void {
  if (timer !== null) return;
  scheduleNextTick();
  console.log('[startup] reminder scheduler running');
}

/** Stops the ticker. Idempotent. */
export function stopReminderScheduler(): void {
  if (timer === null) return;
  clearTimeout(timer);
  timer = null;
}

/** Test seam: stops the ticker and clears the re-entrancy guard. */
export function resetReminderScheduler(): void {
  stopReminderScheduler();
  ticking = false;
}
