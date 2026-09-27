/**
 * Contraception method history.
 *
 * Switching methods is two rows, not an edit: the old one is closed with an
 * `endDate` and a new one starts. `?activeOn=YYYY-MM-DD` filters to what was in
 * use on a day, which is what the UI needs to label a past date.
 */
import { ok, parseJson, route, searchParam } from '@/server/http';
import { createContraceptionMethod, listContraceptionMethods } from '@/server/repos/period';
import { createContraceptionMethodSchema, parseDateParam } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const activeOn = parseDateParam(searchParam(req, 'activeOn')) ?? undefined;
  return ok(await listContraceptionMethods(user.id, { activeOn }));
});

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createContraceptionMethodSchema);
  return ok(await createContraceptionMethod(user.id, body), 201);
});
