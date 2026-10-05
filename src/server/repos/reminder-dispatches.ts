/**
 * The claim table for reminders that have no per-occurrence state.
 *
 * Tasks carry a `sent` flag on `task_reminders`, so they need nothing here.
 * Events and habits do not: an event reminder fires once per *occurrence* and a
 * habit reminder once per *day*, and neither the event row nor the habit row can
 * record which of those have already been announced.
 *
 * The insert *is* the claim. `reminder_dispatches` has a unique index over
 * (user, source, source_id, occurrence_key), so `onConflictDoNothing` turns a
 * second attempt into a no-op and `returning` reports which caller won. That is
 * what makes the dispatcher safe to run every minute, from more than one
 * process, and safe to restart in the middle of a sweep.
 */
import { eq, lt } from 'drizzle-orm';
import type { Millis } from '@/lib/types';
import { newId } from '../crypto';
import { getDb } from '../db';
import { pushSubscriptions, reminderDispatches, userSettings } from '../db/schema';

/** Only the two sources without per-occurrence state of their own. */
export type ReminderSource = 'event' | 'habit';

/** An account that can actually receive a notification, and the zone to read it in. */
export interface NotificationRecipient {
  userId: string;
  zone: string;
}

/**
 * Claims one reminder occurrence. True when this caller won the race and should
 * send; false when somebody else already did.
 */
export async function claimDispatch(input: {
  userId: string;
  source: ReminderSource;
  sourceId: string;
  occurrenceKey: string;
  fireAtMs: Millis;
  nowMs: Millis;
}): Promise<boolean> {
  const db = getDb();
  const inserted = await db
    .insert(reminderDispatches)
    .values({
      id: newId(),
      userId: input.userId,
      source: input.source,
      sourceId: input.sourceId,
      occurrenceKey: input.occurrenceKey,
      fireAtMs: input.fireAtMs,
      sentAtMs: input.nowMs,
    })
    .onConflictDoNothing()
    .returning({ id: reminderDispatches.id });
  return inserted.length > 0;
}

/**
 * Accounts that can actually receive a notification, with the zone their habit
 * reminders are measured in.
 *
 * A user with no destination is skipped rather than claimed-and-dropped. The
 * claim is what makes a reminder at-most-once, so writing one for an account
 * that could not receive anything would throw that reminder away permanently.
 * Left unclaimed it stays due for the rest of the grace window, which gives the
 * user a chance to finish configuring Apprise while the reminder is still worth
 * sending.
 *
 * `notificationsEnabled` is the master switch, and it is honoured here rather
 * than at the send site so that a muted account costs nothing per tick.
 */
export async function notificationRecipients(): Promise<NotificationRecipient[]> {
  const db = getDb();
  const rows = await db
    .select({
      userId: userSettings.userId,
      zone: userSettings.timezone,
      appriseUrl: userSettings.appriseUrl,
      appriseKey: userSettings.appriseKey,
    })
    .from(userSettings)
    .where(eq(userSettings.notificationsEnabled, true));

  const subscribed = await db.selectDistinct({ userId: pushSubscriptions.userId }).from(pushSubscriptions);
  const pushUsers = new Set(subscribed.map((row) => row.userId));

  return rows
    .filter((row) => pushUsers.has(row.userId) || ((row.appriseUrl ?? '').trim().length > 0 && row.appriseKey.length > 0))
    .map((row) => ({ userId: row.userId, zone: row.zone }));
}

/**
 * Drops claims older than `beforeMs`.
 *
 * `sourceId` cannot be a foreign key — `source` points at either
 * `calendar_events` or `habits`, and one column cannot reference two tables — so
 * deleting an event leaves its claims behind. Nothing reads them again, but the
 * table would otherwise grow without bound on a long-lived instance.
 */
export async function pruneDispatches(beforeMs: Millis): Promise<number> {
  const db = getDb();
  const removed = await db
    .delete(reminderDispatches)
    .where(lt(reminderDispatches.fireAtMs, beforeMs))
    .returning({ id: reminderDispatches.id });
  return removed.length;
}
