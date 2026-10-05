/**
 * The reminder ticker.
 *
 * Deliberately separate from the CalDAV ticker, for two reasons:
 *
 *  - **Cadence.** A reminder wants to land near its time. `SYNC_TICK_SECONDS`
 *    defaults to fifteen minutes, which would make every reminder up to a
 *    quarter of an hour late. This one runs every minute.
 *  - **Reach.** The CalDAV ticker only starts when the instance has a syncable
 *    account or a feed (`ensureSyncScheduler`). Gating reminders on it would mean
 *    an account whose only integrations are habits got a scheduler that never
 *    started — silently, because there is nothing to show an error on.
 *
 * It is cheap by construction: this module imports no CalDAV transport and no
 * iCalendar codec, only the dispatcher and the repositories it reads.
 */
import { runReminderSweep } from './reminders';

/** How often the dispatcher looks for due reminders. */
export const REMINDER_TICK_SECONDS = 60;

let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

export function isReminderSchedulerRunning(): boolean {
  return timer !== null;
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
 * Starts the ticker. Idempotent, and the interval is unref'd so it never blocks
 * process shutdown.
 */
export function startReminderScheduler(): void {
  if (timer !== null) return;
  const handle = setInterval(() => {
    void runReminderTick().catch((error: unknown) => {
      console.error('[reminder] tick failed:', error);
    });
  }, REMINDER_TICK_SECONDS * 1000);
  handle.unref();
  timer = handle;
  console.log('[startup] reminder scheduler running');
}

/** Stops the ticker. Idempotent. */
export function stopReminderScheduler(): void {
  if (timer === null) return;
  clearInterval(timer);
  timer = null;
}

/** Test seam: stops the ticker and clears the re-entrancy guard. */
export function resetReminderScheduler(): void {
  stopReminderScheduler();
  ticking = false;
}
