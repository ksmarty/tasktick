/**
 * Day logs: list and upsert.
 *
 * There is exactly one log per user per day, so POST is an upsert keyed by the
 * body's `date`. That is the shape the UI wants: toggling a symptom sends the
 * whole day, and a double-tap cannot create two rows.
 */
import { ok, parseJson, route, searchParam } from '@/server/http';
import { listPeriodDayLogs, upsertPeriodDayLog } from '@/server/repos/period';
import { periodDayLogSchema } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const from = searchParam(req, 'from');
  const to = searchParam(req, 'to');
  return ok(await listPeriodDayLogs(user.id, { from, to }));
});

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, periodDayLogSchema);
  return ok(await upsertPeriodDayLog(user.id, body), 201);
});
