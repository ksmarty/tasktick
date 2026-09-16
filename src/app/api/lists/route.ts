/** Lists (projects): collection endpoints. */
import { ok, parseJson, route } from '@/server/http';
import { createList, listLists } from '@/server/repos/lists';
import { getSettings } from '@/server/repos/settings';
import { createListSchema, reorderSchema } from '@/lib/schemas';
import { reorderLists } from '@/server/repos/lists';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const includeArchived = new URL(req.url).searchParams.get('includeArchived') === '1';
  return ok(await listLists(user.id, { includeArchived }));
});

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createListSchema);
  return ok(await createList(user.id, body), 201);
});

export const PUT = route(async ({ user, req }) => {
  const { orderedIds } = await parseJson(req, reorderSchema);
  await reorderLists(user.id, orderedIds);
  void getSettings;
  return ok({ reordered: orderedIds.length });
});
