import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSessionUser } from '@/server/http';
import type { NextRequest } from 'next/server';

/**
 * Entry point.
 *
 * The session decides where to send the visitor: straight into Today when signed
 * in, otherwise to the auth flow. A fresh instance has no users at all, so
 * `/login` itself routes on to `/register`, which is the "first account becomes
 * admin" bootstrap.
 */
export const dynamic = 'force-dynamic';

export default async function Home() {
  const request = { headers: await headers() } as unknown as NextRequest;
  const user = await getSessionUser(request);

  redirect(user ? '/today' : '/login');
}
