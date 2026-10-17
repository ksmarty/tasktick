/**
 * The write a reminder notification's button makes.
 *
 * `public/sw.js` posts here when the user taps **Complete** (or **Check in**) on
 * a reminder notification, so the item can be finished from the notification
 * without the app ever being opened. The write itself is
 * `acknowledgeReminder` (src/server/services/reminder-actions.ts); this route is
 * only the transport — parse the body, resolve the zone the day is read in, and
 * map the outcome onto a status.
 */
import { badRequest, notFound, ok, parseJson, route } from '@/server/http';
import { getSettings } from '@/server/repos/settings';
import { acknowledgeReminder } from '@/server/services/reminder-actions';
import { reminderAckSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, reminderAckSchema);
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const result = await acknowledgeReminder(user.id, body, zone);

  if (result.status === 'missing') throw notFound(result.message);
  if (result.status === 'unsupported') throw badRequest(result.message);
  return ok(result);
});
