/** A single habit. */
import { notFound, ok, parseJson, route } from '@/server/http';
import { deleteHabit, getHabit, updateHabit } from '@/server/repos/habits';
import { getSettings } from '@/server/repos/settings';
import { updateHabitSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const settings = await getSettings(user.id);
  const habit = await getHabit(user.id, params.id, settings.timezone || user.timezone, settings.weekStartsOn);
  if (!habit) throw notFound('That habit does not exist.');
  return ok(habit);
});

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updateHabitSchema);
  const habit = await updateHabit(user.id, params.id, body as never);
  if (!habit) throw notFound('That habit does not exist.');
  return ok(habit);
});

export const DELETE = route(async ({ user, params }) => {
  const deleted = await deleteHabit(user.id, params.id);
  if (!deleted) throw notFound('That habit does not exist.');
  return ok({ deleted: true });
});
