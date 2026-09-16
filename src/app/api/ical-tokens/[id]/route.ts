/** Revokes a subscription token. The URL stops working immediately. */
import { ok, route } from '@/server/http';
import { revokeIcalToken } from '@/server/repos/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route(async ({ user, params }) => {
  await revokeIcalToken(user.id, params.id);
  return ok({ revoked: true });
});
