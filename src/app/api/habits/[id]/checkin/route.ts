/**
 * Check in (or undo) a habit for a day.
 *
 * POST with `count: null` or `0` clears the entry; with `delta` it increments,
 * which is what the +1 button on a countable habit uses.
 */
import { notFound, ok, parseJson, route } from '@/server/http';
import { checkIn, incrementHabit } from '@/server/repos/habits';
import { clearHabitReminders } from '@/server/services/reminder-clear';
import { getSettings } from '@/server/repos/settings';
import { checkInSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, params, req }) => {
  const body = await parseJson(req, checkInSchema);
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const result =
    body.delta !== undefined
      ? await incrementHabit(user.id, params.id, body.delta, body.date, zone)
      : await checkIn(user.id, params.id, body, zone);

  if (!result) throw notFound('That habit does not exist.');

  /*
   * A habit whose period goal is met has nothing left to be reminded about, so
   * the reminder that got it here goes away. Not awaited: the check-in is
   * committed and the answer is the same either way, so making the user's tick
   * wait on a push service would trade the thing they asked for against a
   * courtesy. `doneToday` is the same "the goal is met" flag the dispatcher uses
   * to decide a habit has been settled (`settledHabitDates`), so the
   * notification clearing and the notification sending agree about what done
   * means.
   */
  if (result.doneToday) void clearHabitReminders(user.id, params.id, zone);

  return ok(result);
});
