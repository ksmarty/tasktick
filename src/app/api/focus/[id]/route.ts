/** Complete or abandon a focus session. */
import { notFound, ok, parseJson, route } from '@/server/http';
import { finishFocusSession } from '@/server/repos/settings';
import { finishFocusSchema } from '@/lib/schemas';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, finishFocusSchema);
  const session = await finishFocusSession(user.id, params.id, body);
  if (!session) throw notFound('That focus session does not exist.');
  return ok(session);
});
