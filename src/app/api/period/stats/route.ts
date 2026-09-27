/**
 * Descriptive statistics over the recorded history.
 *
 * Separate from the prediction: the prediction is a claim about the future and
 * this is a summary of the past (cycle lengths, flow counts, symptom frequency,
 * the temperature series). A chart needs the latter and should not have to
 * re-derive it from the prediction's basis.
 */
import { badRequest, ok, route, searchParam } from '@/server/http';
import { buildPeriodStats } from '@/server/repos/period';
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

  const from = rawFrom ?? addDaysToDateOnly(today, -365, zone);
  const to = rawTo ?? addDaysToDateOnly(today, 365, zone);

  return ok(await buildPeriodStats(user.id, { from, to, zone }));
});
