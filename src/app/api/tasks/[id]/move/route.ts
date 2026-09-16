/**
 * Moves one task between two neighbours, writing a single row.
 * The fallback path: reordering a whole list uses /api/tasks/reorder.
 */
import { notFound, ok, parseJson, route } from '@/server/http';
import { moveTaskBetween } from '@/server/repos/tasks';
import { moveTaskSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, params, req }) => {
  const body = await parseJson(req, moveTaskSchema);
  const task = await moveTaskBetween(user.id, params.id, body.beforeSortOrder, body.afterSortOrder);
  if (!task) throw notFound('That task does not exist.');
  return ok(task);
});
