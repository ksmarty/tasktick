/**
 * Web Push registration.
 *
 * Only ever called after an explicit user tap — browsers (and iOS in
 * particular) treat an unsolicited permission prompt as abuse.
 */
import { ok, parseJson, route } from '@/server/http';
import { removePushSubscription, savePushSubscription } from '@/server/repos/settings';
import { pushSubscribeSchema, pushUnsubscribeSchema } from '@/lib/schemas';
import { pushConfigured } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = route(async ({ user, req }) => {
  if (!pushConfigured()) {
    return ok({ subscribed: false, reason: 'push-not-configured' });
  }

  const body = await parseJson(req, pushSubscribeSchema);
  await savePushSubscription(user.id, {
    endpoint: body.endpoint,
    keys: body.keys,
    userAgent: body.userAgent ?? req.headers.get('user-agent'),
  });

  return ok({ subscribed: true });
});

export const DELETE = route(async ({ user, req }) => {
  const body = await parseJson(req, pushUnsubscribeSchema);
  await removePushSubscription(user.id, body.endpoint);
  return ok({ unsubscribed: true });
});
