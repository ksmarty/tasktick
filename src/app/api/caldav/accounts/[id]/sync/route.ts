/**
 * Triggers a sync run for one account and returns the resulting counters.
 *
 * A manual sync is the escape hatch when a user has just made a change on their
 * phone and does not want to wait for the scheduler tick.
 */
import { notFound, ok, parseJson, route } from '@/server/http';
import { getAccount } from '@/server/repos/calendars';
import { discoverAccountCalendars, syncAccount } from '@/server/sync';
import { syncRequestSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const POST = route(async ({ user, params, req }) => {
  const account = await getAccount(user.id, params.id);
  if (!account) throw notFound('That calendar account does not exist.');

  const body = await parseJson(req, syncRequestSchema);

  const result =
    body.kind === 'discover'
      ? await discoverAccountCalendars(params.id)
      : await syncAccount(params.id, {
          kind: (body.kind as 'full' | 'incremental' | 'push' | undefined) ?? 'incremental',
          calendarId: body.calendarId,
          trigger: 'manual',
        });

  return ok(result);
});
