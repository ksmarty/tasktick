/**
 * Cycles: list and create.
 *
 * A cycle's start date is its natural key, so a second cycle on the same day is
 * a 409 rather than a duplicate row — the CSV import treats that case as an
 * update, and the UI must not be able to create the state the importer would
 * collapse.
 */
import { conflict, ok, parseJson, route, searchParam } from '@/server/http';
import { createPeriodCycle, getPeriodCycleByStart, listPeriodCycles } from '@/server/repos/period';
import { createPeriodCycleSchema } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const from = searchParam(req, 'from');
  const to = searchParam(req, 'to');
  return ok(await listPeriodCycles(user.id, { from, to }));
});

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createPeriodCycleSchema);
  const existing = await getPeriodCycleByStart(user.id, body.startDate);
  if (existing) throw conflict('A cycle already starts on that date.');
  return ok(await createPeriodCycle(user.id, body), 201);
});
