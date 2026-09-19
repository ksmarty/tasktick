/**
 * Unsubscribe.
 *
 * Deleting removes the events the feed mirrored as well as the calendar: they
 * came from the remote, and leaving them behind would be rows nothing can reach
 * or refresh. Refreshing lives on `./sync`, so a client cannot confuse "pull
 * now" with "remove".
 */
import { notFound, ok, route } from '@/server/http';
import { unsubscribeIcal } from '@/server/services/ical-subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const DELETE = route(async ({ user, params }) => {
  const removed = await unsubscribeIcal(user.id, params.id);
  if (!removed) throw notFound('That subscription does not exist.');
  return ok({ id: params.id });
});
