/** Tags: list, create, merge. */
import { ok, parseJson, route } from '@/server/http';
import { createTag, listTags, mergeTags } from '@/server/repos/lists';
import { createTagSchema, mergeTagsSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => ok(await listTags(user.id)));

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createTagSchema);
  return ok(await createTag(user.id, body.name, body.color as never), 201);
});

/** Merges a duplicate tag into another, keeping the tasks attached. */
export const PUT = route(async ({ user, req }) => {
  const body = await parseJson(req, mergeTagsSchema);
  const merged = await mergeTags(user.id, body.sourceId, body.targetId);
  return ok({ merged });
});
