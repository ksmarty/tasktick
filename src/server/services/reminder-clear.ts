/**
 * Taking a habit's reminder away once the habit is done.
 *
 * A reminder exists to get one thing finished. Once the thing *is* finished the
 * notification has no job left, and leaving it in the shade means the user's own
 * doing is reported back to them as an outstanding chore — the worst possible
 * moment to say something is due. So a check-in clears it.
 *
 * ## Two transports, two mechanisms
 *
 * The app's own Web Push notifications are its to close: it built them, it chose
 * their tags, and its service worker can look one up by that tag
 * (`buildWebPushPayload`'s `clear`, handled in `public/sw.js`). Nothing is
 * displayed for a clear, so a close is one silent push.
 *
 * Home Assistant is not ours. Its notifications are sent by Home Assistant
 * Reminders, which picks the tag itself (`taskReminder╡<id>`), so this app cannot
 * address one by name. The integration is asked instead — see
 * `sendClearToHomeAssistant` — and it closes what it sent for that habit.
 *
 * ## Which notifications, exactly
 *
 * Every habit reminder the app could have sent for this habit today, which is
 * yesterday's and today's: `habitReminderDates` is the same window the dispatcher
 * uses, so the set that is cleared is by construction the set that could exist.
 * A habit reminded twice a day is two notifications and both go; yesterday's is
 * included because a 7 am reminder is still on the shade at 9 am and a habit can
 * be ticked off the next morning.
 *
 * ## Failure is silence
 *
 * Nothing here throws. Clearing is a courtesy to the user, never a step a
 * check-in depends on: a phone that cannot be reached, an expired push
 * subscription, a Home Assistant that is asleep — all of them leave the check-in
 * committed and the notification where it was, which is exactly what a failure
 * to *send* a reminder already does.
 */
import { habitReminderTag } from '@/lib/reminder-notification';
import type { Millis } from '@/lib/types';
import { getHabit } from '@/server/repos/habits';
import { haDeliveryTarget, type HaDeliveryTarget } from './ha-delivery';
import { sendClearToHomeAssistant, type HaClearRequest } from './ha-push';
import { habitReminderDates } from './reminders';
import { sendWebPush } from './web-push';

/** What one clear managed to reach. Reported for tests and logs, not for users. */
export interface HabitClearResult {
  /** The tags that were asked to close, today's first. */
  tags: string[];
  /** True when the app's own push transport accepted the clear. */
  pushed: boolean;
  /** True when a Home Assistant was asked to clear its copy. */
  sentToHomeAssistant: boolean;
  /** True when a "you did it" note was shown. */
  confirmed: boolean;
}

export interface HabitClearOptions {
  /** The instant to clear for; defaults to now. A seam for tests. */
  nowMs?: Millis;
  /**
   * Show a short confirmation after clearing.
   *
   * Used when the check-in came *from* a notification: the button's own
   * feedback is otherwise the notification vanishing, which reads as a
   * dismissal rather than as something having been recorded. A check-in made on
   * the habit's own screen does not need this — the screen already showed it.
   */
  confirm?: boolean;
  /** Defaults to the real transports; every one is a seam for tests. */
  loadHabit?: (userId: string, habitId: string, zone: string) => Promise<{ name: string } | null>;
  sendPush?: typeof sendWebPush;
  loadTarget?: (userId: string, nowMs: Millis) => Promise<HaDeliveryTarget | null>;
  sendClear?: typeof sendClearToHomeAssistant;
}

/**
 * The copy a confirmation shows.
 *
 * Short and past tense on purpose: it is the answer to "did that work", not a
 * second reminder. The habit's name is the title so the note is recognisable
 * without opening anything.
 */
const CONFIRMATION_BODY = 'Checked in. Nice work.';

/**
 * Clears the reminders a habit could have left, and optionally says well done.
 *
 * Called from the two places a habit becomes done — the screen's own route and
 * the notification's button — because both are the user finishing the habit, and
 * neither is more true than the other.
 */
export async function clearHabitReminders(
  userId: string,
  habitId: string,
  zone: string,
  options: HabitClearOptions = {},
): Promise<HabitClearResult> {
  const nowMs = options.nowMs ?? Date.now();
  const loadHabit = options.loadHabit ?? ((owner, id, userZone) => getHabit(owner, id, userZone, 1));
  const push = options.sendPush ?? sendWebPush;
  const loadTarget = options.loadTarget ?? haDeliveryTarget;
  const sendClear = options.sendClear ?? sendClearToHomeAssistant;

  const dates = habitReminderDates(zone, nowMs);
  const tags = dates.map((date) => habitReminderTag(habitId, date));
  const result: HabitClearResult = { tags, pushed: false, sentToHomeAssistant: false, confirmed: false };

  if (tags.length === 0) return result;

  try {
    await push(userId, { title: '', body: '', clear: true, tags, tag: tags[tags.length - 1] });
    result.pushed = true;
  } catch (error) {
    console.warn(`[reminder] could not clear the habit reminders for ${userId}: ${describeError(error)}`);
  }

  const habit = await loadHabit(userId, habitId, zone).catch(() => null);
  const message = options.confirm
    ? { title: habit?.name ?? 'Habit', body: CONFIRMATION_BODY }
    : undefined;

  try {
    const target = await loadTarget(userId, nowMs);
    if (target) {
      const request: HaClearRequest = { source: 'habit', sourceId: habitId, tags, ...(message ? { message } : {}) };
      const delivery = await sendClear(target.webhookUrl, request);
      result.sentToHomeAssistant = delivery.delivered;
      if (delivery.delivered) result.confirmed = Boolean(message);
    }
  } catch (error) {
    console.warn(`[reminder] could not clear the Home Assistant copy for ${userId}: ${describeError(error)}`);
  }

  /*
   * The app's own confirmation rides on today's tag: a replacement, not an
   * addition, so the shade ends with one line saying the habit is done rather
   * than a cleared reminder plus a new one.
   */
  if (message) {
    try {
      await push(userId, {
        title: message.title,
        body: message.body,
        url: `/habits?habit=${encodeURIComponent(habitId)}`,
        tag: tags[tags.length - 1],
        data: { source: 'habit', sourceId: habitId, occurrenceKey: `${dates[dates.length - 1]}:0` },
      });
      result.confirmed = true;
    } catch (error) {
      console.warn(`[reminder] could not confirm the habit check-in for ${userId}: ${describeError(error)}`);
    }
  }

  return result;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
