/**
 * The prediction read.
 *
 * Its own endpoint rather than a field on the overview, because the UI may want
 * to recompute it for a different `asOf` (a date the user tapped) without
 * re-fetching everything. The response carries the full `basis`, so the screen
 * can explain *why* the dates are what they are.
 */
import { badRequest, ok, route, searchParam } from '@/server/http';
import { buildUserPrediction } from '@/server/repos/period';
import { getSettings } from '@/server/repos/settings';
import { todayIn } from '@/lib/dates';
import { parseDateParam } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const rawAsOf = searchParam(req, 'asOf');
  if (rawAsOf && !parseDateParam(rawAsOf)) throw badRequest('“asOf” must be a YYYY-MM-DD date.', 'invalid_date');

  return ok(await buildUserPrediction(user.id, rawAsOf ?? todayIn(zone), zone));
});
