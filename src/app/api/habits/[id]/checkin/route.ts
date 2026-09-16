/**
 * Check in (or undo) a habit for a day.
 *
 * POST with `count: null` or `0` clears the entry; with `delta` it increments,
 * which is what the +1 button on a countable habit uses.
 */
import { notFound, ok, parseJson, route } from '@/server/http';
import { checkIn, incrementHabit } from '@/server/repos/habits';
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
  return ok(result);
});
