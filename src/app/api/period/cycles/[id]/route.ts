/** A single cycle. */
import { conflict, notFound, ok, parseJson, route } from '@/server/http';
import {
  deletePeriodCycle,
  getPeriodCycle,
  getPeriodCycleByStart,
  updatePeriodCycle,
} from '@/server/repos/period';
import { updatePeriodCycleSchema } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, params }) => {
  const cycle = await getPeriodCycle(user.id, params.id);
  if (!cycle) throw notFound('That cycle does not exist.');
  return ok(cycle);
});

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, updatePeriodCycleSchema);
  if (body.startDate) {
    const clash = await getPeriodCycleByStart(user.id, body.startDate);
    if (clash && clash.id !== params.id) throw conflict('Another cycle already starts on that date.');
  }
  const cycle = await updatePeriodCycle(user.id, params.id, body);
  if (!cycle) throw notFound('That cycle does not exist.');
  return ok(cycle);
});

export const DELETE = route(async ({ user, params }) => {
  const deleted = await deletePeriodCycle(user.id, params.id);
  if (!deleted) throw notFound('That cycle does not exist.');
  return ok({ deleted: true });
});
