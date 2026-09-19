/**
 * Edit a subscription, or unsubscribe from it.
 *
 * The name and colour are edited in place; a new URL is a re-subscribe, so the
 * old mirror's events are dropped and the new feed imported afresh — the URL is
 * the feed's identity. Deleting removes the events the feed mirrored as well as
 * the calendar: they came from the remote, and leaving them behind would be rows
 * nothing can reach or refresh. Refreshing lives on `./sync`, so a client cannot
 * confuse "pull now" with "remove".
 */
import { notFound, ok, parseJson, route } from '@/server/http';
import { icalSubscriptionPatchSchema } from '@/lib/schemas';
import { updateIcalSubscription, unsubscribeIcal } from '@/server/services/ical-subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const PATCH = route(async ({ user, params, req }) => {
  const body = await parseJson(req, icalSubscriptionPatchSchema);
  const result = await updateIcalSubscription(user.id, params.id, body);
  if (!result) throw notFound('That subscription does not exist.');
  return ok(result);
});

export const DELETE = route(async ({ user, params }) => {
  const removed = await unsubscribeIcal(user.id, params.id);
  if (!removed) throw notFound('That subscription does not exist.');
  return ok({ id: params.id });
});
