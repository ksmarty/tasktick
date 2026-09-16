/** Read-only calendar subscription tokens. */
import { ok, parseJson, route } from '@/server/http';
import { createIcalToken, listIcalTokens } from '@/server/repos/settings';
import { createIcalTokenSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => ok(await listIcalTokens(user.id)));

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createIcalTokenSchema);
  return ok(await createIcalToken(user.id, body), 201);
});
