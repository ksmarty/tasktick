/**
 * Runs collection discovery for an account: resolves the principal, enumerates
 * the calendars and upserts them.
 */
import { notFound, ok, route } from '@/server/http';
import { getAccount } from '@/server/repos/calendars';
import { discoverAccountCalendars } from '@/server/sync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route(async ({ user, params }) => {
  const account = await getAccount(user.id, params.id);
  if (!account) throw notFound('That calendar account does not exist.');

  const result = await discoverAccountCalendars(params.id);
  return ok(result);
});
