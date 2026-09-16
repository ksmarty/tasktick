/**
 * A single CalDAV account: update, or remove.
 *
 * Removal detaches by default (`keepData=true`) so a user who stops syncing does
 * not silently lose their calendar. Pass `?purge=1` to delete the events too.
 */
import { notFound, ok, parseJson, route } from '@/server/http';
import { deleteAccount, getAccount, updateAccount } from '@/server/repos/calendars';
import { updateAccountSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const account = await getAccount(user.id, params.id);
  if (!account) throw notFound('That calendar account does not exist.');
  return ok(account);
});

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updateAccountSchema);
  const account = await updateAccount(user.id, params.id, body);
  if (!account) throw notFound('That calendar account does not exist.');
  return ok(account);
});

export const DELETE = route(async ({ user, params, req }) => {
  const purge = new URL(req.url).searchParams.get('purge') === '1';
  const deleted = await deleteAccount(user.id, params.id, !purge);
  if (!deleted) throw notFound('That calendar account does not exist.');
  return ok({ deleted: true, purged: purge });
});
