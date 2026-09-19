/**
 * Refresh one subscription now.
 *
 * The escape hatch when a user has just changed something upstream and does not
 * want to wait for the hourly scheduler tick.
 */
import { notFound, ok, route } from '@/server/http';
import { syncIcalCalendar } from '@/server/services/ical-subscription';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = route(async ({ user, params }) => {
  const result = await syncIcalCalendar(user.id, params.id);
  if (result.error === 'not-found') throw notFound('That subscription does not exist.');
  return ok(result);
});
