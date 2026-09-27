/**
 * The generated on/off plan — the "on & off days" view.
 *
 * Nothing here is stored: each day's expected state is derived from the method's
 * start date and its schedule, then merged with what the user logged. Editing a
 * schedule therefore changes the whole future plan immediately.
 */
import { badRequest, ok, route, searchParam } from '@/server/http';
import { listContraceptionSchedule } from '@/server/repos/period';
import { getSettings } from '@/server/repos/settings';
import { addDaysToDateOnly, todayIn } from '@/lib/dates';
import { parseDateParam } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;
  const today = todayIn(zone);

  const rawFrom = searchParam(req, 'from');
  const rawTo = searchParam(req, 'to');
  if (rawFrom && !parseDateParam(rawFrom)) throw badRequest('“from” must be a YYYY-MM-DD date.', 'invalid_date');
  if (rawTo && !parseDateParam(rawTo)) throw badRequest('“to” must be a YYYY-MM-DD date.', 'invalid_date');

  const from = rawFrom ?? addDaysToDateOnly(today, -30, zone);
  const to = rawTo ?? addDaysToDateOnly(today, 90, zone);
  if (from > to) throw badRequest('“from” cannot be after “to”.', 'invalid_range');

  return ok(await listContraceptionSchedule(user.id, from, to, zone));
});
