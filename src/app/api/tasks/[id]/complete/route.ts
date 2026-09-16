/**
 * Completing and un-completing a task.
 *
 * For a recurring task, `completed` returns the task with an ADVANCED due date
 * rather than a completed status — the series rolls forward instead of ending.
 * The `recurred` flag tells the client to show "moved to <date>" feedback.
 */
import { notFound, ok, route } from '@/server/http';
import { completeTask, getTask, uncompleteTask } from '@/server/repos/tasks';
import { getSettings } from '@/server/repos/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, params, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const url = new URL(req.url);
  const undo = url.searchParams.get('undo') === '1';

  const before = await getTask(user.id, params.id);
  if (!before) throw notFound('That task does not exist.');

  const task = undo ? await uncompleteTask(user.id, params.id) : await completeTask(user.id, params.id, zone);

  const recurred = !undo && Boolean(before.recurrenceRule) && task?.status === 'todo';

  return ok({ task, recurred });
});
