/**
 * Multi-select bulk actions.
 */
import { ok, parseJson, route } from '@/server/http';
import { bulkUpdate } from '@/server/repos/tasks';
import { getSettings } from '@/server/repos/settings';
import { bulkActionSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, bulkActionSchema);
  const settings = await getSettings(user.id);

  const affected = await bulkUpdate(
    user.id,
    body.ids,
    body.action,
    { listId: body.listId ?? null, priority: body.priority, tagId: body.tagId },
    settings.timezone || user.timezone,
  );

  return ok({ affected });
});
