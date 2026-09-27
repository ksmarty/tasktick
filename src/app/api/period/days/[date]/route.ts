/** One calendar day's observations, addressed by the date itself. */
import { badRequest, notFound, ok, parseJson, route } from '@/server/http';
import { deletePeriodDayLog, getPeriodDayLog, updatePeriodDayLog } from '@/server/repos/period';
import { parseDateParam, updatePeriodDayLogSchema } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireDate(value: string | undefined): string {
  const date = parseDateParam(value);
  if (!date) throw badRequest('Expected a YYYY-MM-DD date in the path.', 'invalid_date');
  return date;
}

export const GET = route(async ({ user, params }) => {
  const date = requireDate(params.date);
  const log = await getPeriodDayLog(user.id, date);
  if (!log) throw notFound('No log for that day.');
  return ok(log);
});

export const PATCH = route(async ({ user, params, req }) => {
  const date = requireDate(params.date);
  const body = await parseJson(req, updatePeriodDayLogSchema);
  return ok(await updatePeriodDayLog(user.id, date, body));
});

export const DELETE = route(async ({ user, params }) => {
  const date = requireDate(params.date);
  const deleted = await deletePeriodDayLog(user.id, date);
  if (!deleted) throw notFound('No log for that day.');
  return ok({ deleted: true });
});
