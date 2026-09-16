/** A single calendar. Local-storage note: the calendar id doubles as a storage
 *  root for local events, so a local calendar can also be deleted directly. */
import { notFound, ok, parseJson, route } from '@/server/http';
import { deleteCalendar, getCalendar, updateCalendar } from '@/server/repos/calendars';
import { updateCalendarSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const calendar = await getCalendar(user.id, params.id);
  if (!calendar) throw notFound('That calendar does not exist.');
  return ok(calendar);
});

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updateCalendarSchema);
  const calendar = await updateCalendar(user.id, params.id, body as never);
  if (!calendar) throw notFound('That calendar does not exist.');
  return ok(calendar);
});

export const DELETE = route(async ({ user, params }) => {
  const deleted = await deleteCalendar(user.id, params.id);
  if (!deleted) throw notFound('That calendar does not exist.');
  return ok({ deleted: true });
});
