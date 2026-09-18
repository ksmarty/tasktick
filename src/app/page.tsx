import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSessionUser } from '@/server/http';
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
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const request = { headers: await headers() } as unknown as NextRequest;
  const user = await getSessionUser(request);

  redirect(user ? '/tasks' : '/login');
}
