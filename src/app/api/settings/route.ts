/** Read and update the caller's preferences. */
import { ok, parseJson, route } from '@/server/http';
import { getSettings, updateSettings } from '@/server/repos/settings';
import { countPushSubscriptions } from '@/server/repos/settings';
import { updateSettingsSchema } from '@/lib/schemas';
import { oidcConfigured, pushConfigured } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user }) => {
  const [settings, pushDevices] = await Promise.all([getSettings(user.id), countPushSubscriptions(user.id)]);
  return ok({
    settings,
    capabilities: {
      push: pushConfigured(),
      oidc: oidcConfigured(),
      // Read from the server-side variable, not a NEXT_PUBLIC_ one: those are
      // inlined at BUILD time, so a container configured at runtime would hand the
      // browser an undefined key and push would silently stay disabled.
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    },
    pushDevices,
  });
});

export const PATCH = route(async ({ user, req }) => {
  const body = await parseJson(req, updateSettingsSchema);
  return ok(await updateSettings(user.id, body));
});
