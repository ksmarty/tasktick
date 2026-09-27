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
 *
 * The shell resolves period mode from the *route*, so this layout does not read the
 * account's switch and does not render different chrome for it. The switch lives
 * in the period feature's own settings (`/api/period/settings`), and two other
 * places consume it: `app/(app)/period/layout.tsx` bounces a deep link into a
 * disabled mode, and the settings card flips it. Keeping it out of here is what
 * lets every route render one frame of chrome that cannot disagree with the page
 * inside it.
 */
export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const request = { headers: await headers() } as unknown as NextRequest;
  const user = await getSessionUser(request);

  if (!user) redirect('/login');

  return <AppShell>{children}</AppShell>;
}
