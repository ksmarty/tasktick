/** CalDAV accounts: list and create. */
import { ok, parseJson, route } from '@/server/http';
import { createAccount, listAccounts } from '@/server/repos/calendars';
import { createAccountSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => ok(await listAccounts(user.id)));

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createAccountSchema);
  const account = await createAccount(user.id, body);
  return ok(account, 201);
});
