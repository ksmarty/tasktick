/**
 * Reorders a list.
 *
 * Takes the WHOLE ordered id list, not a pair of neighbours: a client that
 * computed neighbours from a stale snapshot would otherwise corrupt the
 * ordering of any rows another device changed in the meantime.
 */
import { ok, parseJson, route } from '@/server/http';
import { reorderTasks } from '@/server/repos/tasks';
import { reorderTasksSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, req }) => {
  const { orderedIds } = await parseJson(req, reorderTasksSchema);
  await reorderTasks(user.id, orderedIds);
  return ok({ reordered: orderedIds.length });
});
