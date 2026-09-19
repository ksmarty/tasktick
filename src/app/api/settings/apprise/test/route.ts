/**
 * Sends a test notification through the caller's Apprise gateway.
 *
 * A misconfigured gateway is otherwise invisible until a real reminder is due,
 * so this is the only way for a user to check the wiring. It deliberately does
 * NOT fail the HTTP request when the gateway refuses the POST: the request to
 * *this* server succeeded, and the interesting part — whether Apprise accepted
 * it — is reported in the body so the UI can show exactly what went wrong.
 */
import { ok, route } from '@/server/http';
import { getAppriseConfig } from '@/server/repos/settings';
import { APPRISE_TEST_PAYLOAD, sendApprise } from '@/server/services/notifications';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user }) => {
  const config = await getAppriseConfig(user.id);
  if (!config) {
    return ok({ configured: false, delivered: false, error: 'not-configured' });
  }

  const result = await sendApprise(config, APPRISE_TEST_PAYLOAD);
  return ok({ configured: true, ...result });
});
