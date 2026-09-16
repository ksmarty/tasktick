/**
 * Single task: read, update, delete.
 */
import { notFound, ok, parseJson, route } from '@/server/http';
import { deleteTask, getTask, updateTask } from '@/server/repos/tasks';
import { getSettings } from '@/server/repos/settings';
import { updateTaskSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const task = await getTask(user.id, params.id);
  if (!task) throw notFound('That task does not exist.');
  return ok(task);
});

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updateTaskSchema);
  const settings = await getSettings(user.id);

  try {
    const task = await updateTask(user.id, params.id, body, settings.timezone || user.timezone);
    return ok(task);
  } catch (error) {
    if (error instanceof Error && error.message === 'not-found') throw notFound('That task does not exist.');
    throw error;
  }
});

export const DELETE = route(async ({ user, params }) => {
  const existing = await getTask(user.id, params.id);
  if (!existing) throw notFound('That task does not exist.');

  await deleteTask(user.id, params.id);
  return ok({ deleted: true });
});
