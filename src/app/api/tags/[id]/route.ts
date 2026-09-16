/** A single tag. */
import { notFound, ok, parseJson, route } from '@/server/http';
import { deleteTag, updateTag } from '@/server/repos/lists';
import { updateTagSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updateTagSchema);
  const tag = await updateTag(user.id, params.id, body as never);
  if (!tag) throw notFound('That tag does not exist.');
  return ok(tag);
});

export const DELETE = route(async ({ user, params }) => {
  const deleted = await deleteTag(user.id, params.id);
  if (!deleted) throw notFound('That tag does not exist.');
  return ok({ deleted: true });
});
