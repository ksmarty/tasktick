/** A single list: rename, archive, recolour, delete. */
import { conflict, notFound, ok, parseJson, route } from '@/server/http';
import { deleteList, getList, updateList } from '@/server/repos/lists';
import { updateListSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const list = await getList(user.id, params.id);
  if (!list) throw notFound('That list does not exist.');
  return ok(list);
});

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updateListSchema);
  const list = await updateList(user.id, params.id, body);
  if (!list) throw notFound('That list does not exist.');
  return ok(list);
});

export const DELETE = route(async ({ user, params }) => {
  try {
    const deleted = await deleteList(user.id, params.id);
    if (!deleted) throw notFound('That list does not exist.');
    return ok({ deleted: true });
  } catch (error) {
    if (error instanceof Error && error.message === 'inbox-undeletable') {
      throw conflict('The Inbox cannot be deleted. Tasks in a deleted list are moved here instead.');
    }
    throw error;
  }
});
