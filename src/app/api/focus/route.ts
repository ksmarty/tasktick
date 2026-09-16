/** Pomodoro focus sessions: list recent, start a new one. */
import { ok, parseJson, route, searchParamInt } from '@/server/http';
import { focusCountToday, recentFocusSessions, startFocusSession } from '@/server/repos/settings';
import { getSettings } from '@/server/repos/settings';
import { startFocusSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;
  const [sessions, completedToday] = await Promise.all([
    recentFocusSessions(user.id, searchParamInt(req, 'limit', 20)),
    focusCountToday(user.id, zone),
  ]);
  return ok({ sessions, completedToday });
});

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, startFocusSchema);
  return ok(await startFocusSession(user.id, body), 201);
});
