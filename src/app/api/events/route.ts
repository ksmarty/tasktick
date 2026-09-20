/** Calendar events: create. Listing by range lives at /api/calendar/items. */
import { forbidden, ok, parseJson, route } from '@/server/http';
import { createEvent } from '@/server/repos/calendars';
import { getSettings } from '@/server/repos/settings';
import { createEventSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createEventSchema);
  const settings = await getSettings(user.id);

  try {
    const event = await createEvent(user.id, body as never, settings.timezone || user.timezone);
    return ok(event, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'not-found') {
      throw new Error('That calendar does not exist.');
    }
    if (error instanceof Error && error.message === 'invalid-span') {
      throw new Error('An event needs a start date or start time.');
    }
    if (error instanceof Error && error.message === 'read-only') {
      throw forbidden('That calendar is read-only, so nothing is written back.');
    }
    throw error;
  }
});
