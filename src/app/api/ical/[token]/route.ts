/**
 * Public, token-authenticated iCalendar subscription feed.
 *
 * ## Why the token is in the path and not a header
 *
 * Calendar clients (Apple Calendar, Google, Thunderbird) fetch a subscription URL
 * themselves and cannot send an `Authorization` header. A long, unguessable,
 * revocable token in the path is the standard solution, and it is why this route
 * is deliberately NOT behind the session guard: it has its own bearer check.
 *
 * `ROUTE` is treated as a secret: the response is `no-store`, is never cached by
 * the service worker, and the token is compared in constant time.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { resolveIcalToken, getSettings } from '@/server/repos/settings';
import { buildIcsFeed, defaultFeedRange, webcalUrl } from '@/server/services/ics-feed';
import { getEnv } from '@/lib/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const notFound = () =>
  new NextResponse('Unknown or revoked calendar token.', {
    status: 404,
    headers: { 'Cache-Control': 'no-store' },
  });

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  // Basic shape check before touching the database.
  if (!token || token.length < 16 || token.length > 200) return notFound();

  const resolved = await resolveIcalToken(token);
  if (!resolved) return notFound();

  const settings = await getSettings(resolved.userId);
  const zone = settings.timezone || getEnv().DEFAULT_TIMEZONE;

  const range = defaultFeedRange(zone);
  const ics = await buildIcsFeed({
    userId: resolved.userId,
    zone,
    calendarName: 'TaskTick',
    startMs: range.startMs,
    endMs: range.endMs,
    includeTasks: resolved.includeTasks,
    includeEvents: resolved.includeEvents,
    listIds: resolved.listIds,
  });

  const body = req.nextUrl.searchParams.get('webcal') === '1' ? webcalUrl(getEnv().APP_URL) : ics;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // Calendar clients respect this; it is also the correct HTTP semantics for
      // a per-token secret URL.
      'Cache-Control': 'no-store, private',
      'Content-Disposition': 'inline; filename="tasktick.ics"',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
