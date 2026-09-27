/**
 * Logged contraception days: what actually happened, as opposed to the schedule.
 *
 * A day log belongs to a method record, so `POST` needs `methodId`. It upserts
 * on (method, date) — logging the same day twice corrects it, which is what a
 * user tapping the wrong status means.
 */
import { notFound, ok, parseJson, route, searchParam } from '@/server/http';
import { listContraceptionDays, upsertContraceptionDay } from '@/server/repos/period';
import { contraceptionDayLogSchema, parseDateParam } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const from = parseDateParam(searchParam(req, 'from')) ?? undefined;
  const to = parseDateParam(searchParam(req, 'to')) ?? undefined;
  const methodId = searchParam(req, 'methodId');
  return ok(await listContraceptionDays(user.id, { from, to, methodId }));
});

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, contraceptionDayLogSchema);
  const saved = await upsertContraceptionDay(user.id, body);
  if (!saved) throw notFound('That contraception record does not exist.');
  return ok(saved, 201);
});
