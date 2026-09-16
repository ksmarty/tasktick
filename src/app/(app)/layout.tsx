import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getSessionUser } from '@/server/http';
import { AppShell } from '@/components/app/AppShell';

/**
 * Layout for every signed-in route.
 *
 * The session check happens here once, on the server, so no child page has to
 * repeat it and a signed-out visitor never sees a flash of app chrome.
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const request = { headers: await headers() } as unknown as NextRequest;
  const user = await getSessionUser(request);

  if (!user) redirect('/login');

  return <AppShell>{children}</AppShell>;
}
