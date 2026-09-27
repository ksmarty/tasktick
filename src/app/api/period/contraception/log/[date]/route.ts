/** Removes the log for one day of one method. */
import { badRequest, notFound, ok, route, searchParam } from '@/server/http';
import { deleteContraceptionDay } from '@/server/repos/period';
import { parseDateParam } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route(async ({ user, params, req }) => {
  const date = parseDateParam(params.date);
  if (!date) throw badRequest('Expected a YYYY-MM-DD date in the path.', 'invalid_date');

  const methodId = searchParam(req, 'methodId');
  if (!methodId) throw badRequest('A methodId query parameter is required.', 'missing_method');

  const deleted = await deleteContraceptionDay(user.id, methodId, date);
  if (!deleted) throw notFound('No log for that method and day.');
  return ok({ deleted: true });
});
