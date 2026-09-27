/** The period feature's own settings — the switch that enables the interface. */
import { ok, parseJson, route } from '@/server/http';
import { getPeriodSettings, updatePeriodSettings } from '@/server/repos/period';
import { updatePeriodSettingsSchema } from '@/lib/period-schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => ok(await getPeriodSettings(user.id)));

export const PATCH = route(async ({ user, req }) => {
  const body = await parseJson(req, updatePeriodSettingsSchema);
  return ok(await updatePeriodSettings(user.id, body));
});
