/**
 * Reminder dispatcher — the piece that was missing.
 *
 * ## Why this exists
 *
 * Reminders were stored, offered in the editors, and never sent. `task_reminders`
 * rows were written and flipped to `sent` when the task was completed; events and
 * habits carried reminder fields that nothing read; and `deliverUserNotification`
 * — the Apprise/Web Push fan-out — had no caller anywhere in the server. The only
 * reminder that ever arrived was the one sent by hand from Settings.
 *
 * ## What makes it safe to run every minute
 *
 * A reminder must go out exactly once. Every claim here is a single conditional
 * write whose result decides whether to send:
 *
 *  - **Tasks** already have a per-reminder `sent` flag, so the claim is
 *    `UPDATE ... WHERE sent = false RETURNING id` and exactly one caller wins.
 *  - **Events and habits** have no per-occurrence state — an event reminder fires
 *    once per *occurrence* and a habit reminder once per *day* — so those claims
 *    go into `reminder_dispatches`, whose unique index makes a duplicate insert a
 *    no-op.
 *
 * The claim is written BEFORE the notification is sent. A crash between the two
 * therefore loses that reminder rather than repeating it, which is the right way
 * round: a missed reminder is invisible, a repeated one is a bug report.
 *
 * ## Which transport
 *
 * A `tasktick` Home Assistant takes this account's reminders when the integration
 * registered a webhook, and the app's own Apprise/Web Push fan-out is the
 * fallback — not the other way round, because Home Assistant's notification can
 * finish the item, arrives on a phone that is awake, and is configured by the
 * person who already runs the reminders. The choice is per account and per tick,
 * decided by a registration the integration keeps fresh by its own polling (see
 * `src/server/services/ha-delivery.ts`), and a POST that fails falls straight
 * through to the app's push so a Home Assistant that went away costs a slower
 * notification rather than a lost one.
 *
 * ## The window
 *
 * A reminder is due when `fireAt > now - grace && fireAt <= now`. The upper bound
 * means a future reminder is never sent early; the lower bound means a reminder
 * older than {@link REMINDER_GRACE_MS} is dropped rather than delivered at a
 * random hour because the server was down. Both ends are exclusive so that a
 * tick landing exactly on a boundary cannot send the same reminder twice.
 */
import { addDaysToDateOnly, dateOnlyToMillis, toDateOnly } from '@/lib/dates';
import { reminderLink } from '@/lib/reminder-notification';
import type { DateOnly, Habit, Millis } from '@/lib/types';
import { habitsWithReminders, matchesSchedule, settledHabitDates } from '../repos/habits';
import { claimDispatch, notificationRecipients, pruneDispatches } from '../repos/reminder-dispatches';
import { dueTaskReminders, markTaskReminderSent } from '../repos/tasks';
import { expandedEventsInRange, type ExpandedEvent } from './calendar-items';
import { freshHaDeliveries, type HaDeliveryTarget } from './ha-delivery';
import { sendToHomeAssistant, type HaPushDelivery } from './ha-push';
import { deliverUserNotification, type NotificationPayload } from './notifications';

/**
 * How late a reminder may be and still be worth sending.
 *
 * An hour is long enough to ride out a restart, a deploy or a short outage, and
 * short enough that a reminder never turns up at an hour nobody asked for. It is
 * also what makes the `isDue` window meaningful rather than "everything overdue
 * forever", which is what a server that was down overnight would otherwise send
 * in one burst at boot.
 */
export const REMINDER_GRACE_MS = 60 * 60 * 1000;

/**
 * How far either side of an event's start a reminder offset may sit.
 *
 * The offset list is user data, so the query window has to be picked before the
 * offsets are known. A week either way covers everything the editors can produce
 * with room to spare; the exact fire time is filtered afterwards regardless, so
 * this only bounds the read rather than deciding what is due.
 */
const MAX_EVENT_OFFSET_MINUTES = 7 * 24 * 60;

/** Claims older than this are pruned on each sweep. */
const DISPATCH_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

/** One reminder that is due right now, whatever it belongs to. */
export interface DueReminder {
  source: 'task' | 'event' | 'habit';
  /** The task, event or habit id. */
  sourceId: string;
  /** The per-occurrence key; see the file header. */
  occurrenceKey: string;
  /** For tasks only: the `task_reminders` row id, which is itself the claim. */
  reminderId?: string;
  title: string;
  body: string;
  fireAtMs: Millis;
}

/** True when a reminder at `fireAtMs` is due at `nowMs` and not yet stale. */
export function isDue(fireAtMs: Millis, nowMs: Millis, graceMs: number = REMINDER_GRACE_MS): boolean {
  return fireAtMs <= nowMs && fireAtMs > nowMs - graceMs;
}

/**
 * Event reminders due in the window.
 *
 * Takes *occurrences*, not rows. The expander has already resolved the series
 * and an all-day event's local-midnight base, so this only applies the offsets —
 * re-deriving either here would be the second implementation of date maths this
 * file is careful to avoid.
 *
 * The occurrence start is part of the claim key, which is what lets a weekly
 * event announce itself again next week while two reminders on one occurrence
 * stay separate.
 */
export function dueEventReminders(
  occurrences: readonly ExpandedEvent[],
  nowMs: Millis,
  graceMs: number = REMINDER_GRACE_MS,
): DueReminder[] {
  const due: DueReminder[] = [];
  for (const { event, startMs } of occurrences) {
    for (const offsetMinutes of event.reminders ?? []) {
      const fireAtMs = startMs + offsetMinutes * 60_000;
      if (!isDue(fireAtMs, nowMs, graceMs)) continue;
      due.push({
        source: 'event',
        sourceId: event.id,
        occurrenceKey: `${startMs}:${offsetMinutes}`,
        title: event.summary,
        body: 'Calendar event',
        fireAtMs,
      });
    }
  }
  return due;
}

/**
 * The days a habit reminder can belong to: yesterday and today.
 *
 * Exported because the caller has to ask the database about exactly these dates
 * before the reminders are computed — whether each one is already settled — and
 * a second copy of the rule would drift from this one.
 */
export function habitReminderDates(zone: string, nowMs: Millis): DateOnly[] {
  const today: DateOnly = toDateOnly(nowMs, zone);
  return [addDaysToDateOnly(today, -1, zone), today];
}

/**
 * Habit reminders due in the window.
 *
 * A habit reminder is a time of day, so it is stored as minutes since local
 * midnight and only becomes an instant once the date is known. Yesterday is
 * checked as well as today: a 23:59 reminder whose tick lands at 00:00:30
 * belongs to yesterday's date, and with a one-hour grace window a date-only sweep
 * of "today" would drop it every single night.
 *
 * `settled` carries the days this habit has already met its goal for (see
 * `settledHabitDates`). A habit that has been ticked off is not reminded again
 * that day — or, for a weekly habit, again that week: the point of the reminder
 * is to get the check-in done, and it has been.
 */
export function dueHabitReminders(
  habit: Habit,
  zone: string,
  nowMs: Millis,
  graceMs: number = REMINDER_GRACE_MS,
  settled?: ReadonlySet<DateOnly> | null,
): DueReminder[] {
  /*
   * The dates come from `nowMs`, not from the wall clock: taking them from the
   * clock made the function's own `nowMs` a lie, so a sweep replayed at any
   * other instant still looked at today and every reminder missed.
   */
  const due: DueReminder[] = [];

  for (const date of habitReminderDates(zone, nowMs)) {
    if (settled?.has(date)) continue;
    if (!matchesSchedule(habit, date)) continue;
    const midnightMs = dateOnlyToMillis(date, zone);
    for (const minute of habit.reminders ?? []) {
      const fireAtMs = midnightMs + minute * 60_000;
      if (!isDue(fireAtMs, nowMs, graceMs)) continue;
      due.push({
        source: 'habit',
        sourceId: habit.id,
        occurrenceKey: `${date}:${minute}`,
        title: habit.name,
        body: 'Habit reminder',
        fireAtMs,
      });
    }
  }
  return due;
}

/** What one sweep did. `skipped` is a reminder another caller had already claimed. */
export interface DispatchCounts {
  sent: number;
  skipped: number;
  failed: number;
}

/** Injectable seams. The default deliverer is the real Apprise + Web Push fan-out. */
export interface ReminderDeps {
  deliver?: (userId: string, payload: NotificationPayload) => Promise<unknown>;
  /**
   * The Home Assistant leg, injectable so a test can watch the POST without a
   * network. Nothing else about the transport is stubbed: routing, the fallback
   * and the accounting all run for real.
   */
  pushToHomeAssistant?: (webhookUrl: string, payload: NotificationPayload) => Promise<HaPushDelivery>;
}

/**
 * The deliverer for one account at one instant.
 *
 * With no registration this *is* the fallback, so an account without Home
 * Assistant keeps exactly the call path it had before. With one, the POST goes
 * first and the fallback follows only when Home Assistant did not take the
 * reminder — a 404 from a webhook the integration has since removed, a 5xx from
 * its own delivery failing, or no answer at all.
 *
 * The fallback is awaited rather than fired and forgotten: `deliverQuietly` reads
 * its outcome to count the reminder as sent or failed, and a fallback that is
 * still in flight when the sweep returns would be counted wrong.
 */
function routeDelivery(
  target: HaDeliveryTarget | null,
  fallback: NonNullable<ReminderDeps['deliver']>,
  push: (webhookUrl: string, payload: NotificationPayload) => Promise<HaPushDelivery>,
): NonNullable<ReminderDeps['deliver']> {
  if (!target) return fallback;

  return async (userId, payload) => {
    const delivery = await push(target.webhookUrl, payload);
    if (delivery.delivered) return;
    console.warn(
      `[reminder] Home Assistant did not take the reminder for ${userId}: ${delivery.error ?? 'unknown error'}; falling back`,
    );
    await fallback(userId, payload);
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Sends one reminder, reporting whether the transport accepted it.
 *
 * The transport never throws by contract, but a bug in it must not abandon the
 * rest of the sweep — every later reminder in this tick would be lost with it.
 *
 * The payload carries where a tap should land and what the notification can do
 * about the item (see `reminderLink`), which is the difference between a
 * reminder that says a task is due and one that gets it done: the button
 * finishes the item, and the tap opens the screen it belongs to rather than the
 * app's front page.
 */
async function deliverQuietly(
  deliver: NonNullable<ReminderDeps['deliver']>,
  userId: string,
  reminder: DueReminder,
  zone: string,
): Promise<boolean> {
  const link = reminderLink(reminder, zone);
  try {
    await deliver(userId, {
      title: reminder.title,
      body: reminder.body,
      type: 'info',
      url: link.url,
      tag: link.tag,
      actions: link.actions,
      data: link.data,
    });
    return true;
  } catch (error) {
    console.warn(`[reminder] delivery failed for ${userId} (${reminder.source} ${reminder.sourceId}): ${describeError(error)}`);
    return false;
  }
}

/** Claims one event or habit reminder and sends it when this caller won the race. */
async function dispatchClaimed(
  userId: string,
  reminder: DueReminder,
  nowMs: Millis,
  deliver: NonNullable<ReminderDeps['deliver']>,
  counts: DispatchCounts,
  zone: string,
): Promise<void> {
  const claimed = await claimDispatch({
    userId,
    source: reminder.source === 'habit' ? 'habit' : 'event',
    sourceId: reminder.sourceId,
    occurrenceKey: reminder.occurrenceKey,
    fireAtMs: reminder.fireAtMs,
    nowMs,
  });
  if (!claimed) {
    counts.skipped += 1;
    return;
  }
  if (await deliverQuietly(deliver, userId, reminder, zone)) counts.sent += 1;
  else counts.failed += 1;
}

/** Every reminder due for one account, claimed and sent. */
export async function dispatchRemindersForUser(
  userId: string,
  zone: string,
  nowMs: Millis,
  deliver: NonNullable<ReminderDeps['deliver']>,
  /** The account's week start, which decides the weekly habit periods. */
  weekStartsOn = 1,
): Promise<DispatchCounts> {
  const counts: DispatchCounts = { sent: 0, skipped: 0, failed: 0 };

  for (const reminder of await dueTaskReminders(userId, nowMs, REMINDER_GRACE_MS)) {
    const claimed = await markTaskReminderSent(userId, reminder.reminderId, nowMs);
    if (!claimed) {
      counts.skipped += 1;
      continue;
    }
    const due: DueReminder = {
      source: 'task',
      sourceId: reminder.taskId,
      occurrenceKey: reminder.reminderId,
      reminderId: reminder.reminderId,
      title: reminder.title,
      body: 'Task due',
      fireAtMs: reminder.fireAtMs,
    };
    if (await deliverQuietly(deliver, userId, due, zone)) counts.sent += 1;
    else counts.failed += 1;
  }

  /*
   * The window is widened by the largest offset the editors can produce, because
   * a reminder that fires *before* its event sits earlier than the event does.
   * `expandedEventsInRange` is the same server-side recurrence expansion the
   * calendar screen renders — a client must never re-derive that, and neither
   * does this. It also applies the per-calendar dedupe rule, so an event the
   * calendar has hidden as a duplicate does not remind.
   */
  const span = MAX_EVENT_OFFSET_MINUTES * 60_000;
  const occurrences = await expandedEventsInRange(userId, nowMs - REMINDER_GRACE_MS - span, nowMs + span, zone);
  for (const reminder of dueEventReminders(occurrences, nowMs)) {
    await dispatchClaimed(userId, reminder, nowMs, deliver, counts, zone);
  }

  /*
   * Habits are asked what they have already settled before their reminders are
   * computed: a habit that has been checked in for the day (or, for a weekly
   * habit, for the week) has nothing left to be reminded about, and the answer
   * needs the check-ins, not just the habit row.
   */
  const habits = await habitsWithReminders(userId);
  if (habits.length > 0) {
    const settled = await settledHabitDates(userId, habits, habitReminderDates(zone, nowMs), weekStartsOn, zone);
    for (const habit of habits) {
      for (const reminder of dueHabitReminders(habit, zone, nowMs, REMINDER_GRACE_MS, settled.get(habit.id))) {
        await dispatchClaimed(userId, reminder, nowMs, deliver, counts, zone);
      }
    }
  }

  return counts;
}

/**
 * One sweep across every account that can receive a notification.
 *
 * Accounts are swept one at a time and a failing one is logged rather than
 * rethrown, so a single bad row cannot stop everyone else's reminders. Each
 * account is then delivered the way it prefers — through its Home Assistant when
 * the integration has registered a webhook, otherwise through the app's own push.
 * The prune rides along here rather than on a second timer: this is already the only
 * periodic job that owns the table.
 */
export async function runReminderSweep(nowMs: Millis = Date.now(), deps: ReminderDeps = {}): Promise<DispatchCounts> {
  const fallback = deps.deliver ?? ((userId: string, payload: NotificationPayload) => deliverUserNotification(userId, payload));
  const push = deps.pushToHomeAssistant ?? sendToHomeAssistant;
  const total: DispatchCounts = { sent: 0, skipped: 0, failed: 0 };

  const recipients = await notificationRecipients();
  /*
   * One read for the whole tick: where a Home Assistant wants this account's
   * reminders, if anywhere. The sweep is where the choice belongs rather than the
   * transport, because only the sweep knows both what is due and where it should
   * go — and the read is one query for every account, not one per account.
   */
  const homes = await freshHaDeliveries(nowMs);
  for (const recipient of recipients) {
    try {
      const deliver = routeDelivery(homes.get(recipient.userId) ?? null, fallback, push);
      const counts = await dispatchRemindersForUser(
        recipient.userId,
        recipient.zone,
        nowMs,
        deliver,
        recipient.weekStartsOn,
      );
      total.sent += counts.sent;
      total.skipped += counts.skipped;
      total.failed += counts.failed;
    } catch (error) {
      console.error(`[reminder] sweep failed for ${recipient.userId}: ${describeError(error)}`);
    }
  }

  try {
    const pruned = await pruneDispatches(nowMs - DISPATCH_RETENTION_MS);
    if (pruned > 0) console.log(`[reminder] pruned ${pruned} stale dispatch claims`);
  } catch (error) {
    console.warn(`[reminder] pruning dispatch claims failed: ${describeError(error)}`);
  }

  return total;
}
