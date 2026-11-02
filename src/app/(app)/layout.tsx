import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { NextRequest } from 'next/server';
import { getSessionUser } from '@/server/http';
import { AppShell } from '@/components/app/AppShell';
import { previewAuthEmail } from '@/lib/preview-auth';

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

  /*
   * Whether this session is the one preview sign-in handed out — see
   * `src/lib/preview-auth.ts`. Compared against the session rather than read from
   * the environment alone, so a machine with the switch on that signed in the
   * ordinary way still gets an unlabelled shell: the banner's job is to say "no
   * password was typed for this", which is only true of the account it names.
   */
  const preview = previewAuthEmail();
  const previewEmail = preview && preview === user.email.toLowerCase() ? user.email : null;

  return <AppShell previewEmail={previewEmail}>{children}</AppShell>;
}
