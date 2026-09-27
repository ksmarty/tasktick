/**
 * The period screen's single read.
 *
 * Cycles are returned in full because the prediction needs the history; day logs
 * and the contraception schedule are windowed, because those grow without bound.
 * The window defaults to the 90 days either side of today, which is what a phone
 * screen shows; a range-picker passes `from`/`to` explicitly.
 */
import { ok, route, searchParam } from '@/server/http';
import { getPeriodOverview } from '@/server/repos/period';
import { getSettings } from '@/server/repos/settings';
import { addDaysToDateOnly, todayIn } from '@/lib/dates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;
  const today = todayIn(zone);

  const from = searchParam(req, 'from') ?? addDaysToDateOnly(today, -90, zone);
  const to = searchParam(req, 'to') ?? addDaysToDateOnly(today, 90, zone);
  const asOf = searchParam(req, 'asOf') ?? today;

  return ok(await getPeriodOverview(user.id, { from, to, asOf, zone }));
});
