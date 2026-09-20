/** A single event. */
import { forbidden, notFound, ok, parseJson, route } from '@/server/http';
import { deleteEvent, getEvent, updateEvent } from '@/server/repos/calendars';
import { getSettings } from '@/server/repos/settings';
import { updateEventSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const event = await getEvent(user.id, params.id);
  if (!event) throw notFound('That event does not exist.');
  return ok(event);
});

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updateEventSchema);
  const settings = await getSettings(user.id);
  try {
    const event = await updateEvent(user.id, params.id, body as never, settings.timezone || user.timezone);
    if (!event) throw notFound('That event does not exist.');
    return ok(event);
  } catch (error) {
    if (error instanceof Error && error.message === 'read-only') {
      throw forbidden('That calendar is read-only, so nothing is written back.');
    }
    throw error;
  }
});

export const DELETE = route(async ({ user, params }) => {
  const deleted = await deleteEvent(user.id, params.id);
  if (!deleted) throw notFound('That event does not exist.');
  return ok({ deleted: true });
});
