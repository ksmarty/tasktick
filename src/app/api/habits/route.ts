/**
 * Habits: list with streaks and heatmap data, and create.
 */
import { ok, parseJson, route, searchParam, searchParamBool } from '@/server/http';
import { createHabit, listHabits } from '@/server/repos/habits';
import { getSettings } from '@/server/repos/settings';
import { createHabitSchema, reorderSchema } from '@/lib/schemas';
import { reorderHabits } from '@/server/repos/habits';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const habits = await listHabits({
    userId: user.id,
    zone,
    weekStartsOn: settings.weekStartsOn,
    from: searchParam(req, 'from'),
    to: searchParam(req, 'to'),
    includeArchived: searchParamBool(req, 'includeArchived', false),
  });

  return ok(habits);
});

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createHabitSchema);
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;
  return ok(await createHabit(user.id, body as never, zone), 201);
});

export const PUT = route(async ({ user, req }) => {
  const { orderedIds } = await parseJson(req, reorderSchema);
  await reorderHabits(user.id, orderedIds);
  return ok({ reordered: orderedIds.length });
});
