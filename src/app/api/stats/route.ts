/** Productivity statistics for the Today header and the stats view. */
import { ok, route, searchParamInt } from '@/server/http';
import { buildStats } from '@/server/repos/settings';
import { getSettings } from '@/server/repos/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;
  const days = Math.min(365, Math.max(7, searchParamInt(req, 'days', 30)));
  return ok(await buildStats({ userId: user.id, zone, days }));
});
