/** Calendars: list, create, reorder. */
import { ok, parseJson, route } from '@/server/http';
import { createCalendar, listCalendars, reorderCalendars } from '@/server/repos/calendars';
import { getSettings } from '@/server/repos/settings';
import { createCalendarSchema, reorderSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => ok(await listCalendars(user.id)));

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createCalendarSchema);
  const settings = await getSettings(user.id);
  return ok(await createCalendar(user.id, body as never, settings.timezone || user.timezone), 201);
});

export const PUT = route(async ({ user, req }) => {
  const { orderedIds } = await parseJson(req, reorderSchema);
  await reorderCalendars(user.id, orderedIds);
  return ok({ reordered: orderedIds.length });
});
