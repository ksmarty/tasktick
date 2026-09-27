import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { getSessionUser } from '@/server/http';
import { PERIOD_MODE_COOKIE, periodModeFromCookie } from '@/components/period/mode';
import type { NextRequest } from 'next/server';

/**
 * Entry point.
 *
 * The session decides where to send the visitor: straight into the task list when
 * signed in, otherwise to the auth flow. A fresh instance has no users at all, so
 * `/login` itself routes on to `/register`, which is the "first account becomes
 * admin" bootstrap.
 *
 * The landing screen is All tasks rather than Today. Today is a filtered view of
 * the same list, so opening there hid most of the user's work behind a view they
 * never chose — and the app's own grouping already surfaces what is due today,
 * which is what the Today view existed to do.
 *
 * Period tracking, when it is on, moves the landing screen to the period
 * interface. The mode is a preference rather than a one-off detour, so the
 * installed app's `start_url` (`/`) has to open where the user enabled —
 * otherwise "/" would be the one door that always led back out of the mode, and
 * re-entering it would be a trip through Settings every single launch. `/tasks`
 * still resolves directly, which is what makes the exit control non-destructive:
 * it takes you to the task list without turning the mode off.
 *
 * The switch is decided server-side from a display cookie that the client mirrors
 * `PeriodSettings.enabled` into (see `@/components/period/mode`), exactly as the
 * theme preference is mirrored into `tasktick-theme` for the same reason: a
 * redirect cannot wait for a client fetch. The cookie is a cache — the API stays
 * the source of truth — and the worst a stale one can do is land a user on
 * `/tasks`, from where the period interface is one tap away.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const request = { headers: await headers() } as unknown as NextRequest;
  const user = await getSessionUser(request);

  if (!user) redirect('/login');

  const store = await cookies();
  const periodMode = periodModeFromCookie(store.get(PERIOD_MODE_COOKIE)?.value);
  redirect(periodMode ? '/period' : '/tasks');
}
