import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import type { NextRequest } from 'next/server';
import { LoginForm } from '@/components/auth/LoginForm';
import { describeOidcCallbackError } from '@/lib/oidc-errors';
import { safeNextPath } from '@/lib/safe-next';
import { AUTH_COOKIE_PREFIX } from '@/lib/auth-cookie';
import { getSessionCookie } from 'better-auth/cookies';
import { getSessionUser } from '@/server/http';
import { getInstanceState, registrationAllowed } from '@/server/services/instance';
import { previewAuthAvailable } from '@/lib/preview-auth';
import { describeOidcAvailability } from '@/server/oidc';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, state] = await Promise.all([searchParams, getInstanceState()]);
  const next = safeNextPath(params.next);

  // A fresh instance has nobody to sign in as; the only useful screen is
  // registration, which is also the admin bootstrap.
  if (state.isFirstRun) redirect('/register');

  if (state.registrationMode === 'closed' && state.userCount === 0) redirect('/register');

  // Already signed in — which happens when a reminder link is tapped in a browser
  // that still has the session. Showing the form again would be a dead end: the
  // destination the link carried is right there, so follow it.
  const request = { headers: await headers() } as unknown as NextRequest;
  if (await getSessionUser(request)) redirect(next);

  /*
   * Preview sign-in — `src/lib/preview-auth.ts`. A browser on this machine, on a
   * server where an operator named an account, is sent to mint a session rather
   * than shown a password box it cannot be typed into by the tools that look at
   * this app. The check runs after the session check above, so an ordinary
   * visitor with a session is untouched, and it is skipped once the endpoint has
   * refused (`?preview=`), which is what keeps the two screens from bouncing.
   */
  if (!params.preview && previewAuthAvailable(request.headers)) {
    redirect(`/api/auth/preview-session?next=${encodeURIComponent(next)}`);
  }

  /*
   * A session cookie that is present but rejected is a different problem from no
   * cookie at all, and the difference is invisible from the form: one means the
   * cookie expired or its signature no longer matches, the other means the browser
   * never sent it (dropped for its `Secure` flag, evicted, or a different cookie
   * jar entirely — an installed app has its own). Saying which one it is turns
   * "it forgot me again" into something diagnosable.
   */
  const sentSessionCookie = Boolean(
    getSessionCookie({ headers: request.headers } as Request, { cookiePrefix: AUTH_COOKIE_PREFIX }),
  );

  // Only probed when the button would be shown: a signed-out page nobody can
  // act on should not pay for a network round trip to the identity provider.
  const oidc = state.oidc.enabled ? await describeOidcAvailability() : null;

  // The provider sends a failed round trip back here (`errorCallbackURL`), so
  // this is where the reason it failed finally becomes visible.
  const oidcFailure = describeOidcCallbackError(params.error, params.error_description);

  /*
   * Why the preview sign-in failed, in the words of the one who would have to fix
   * it. `unavailable` means the request did not reach this machine over loopback
   * (the `Host` header is not a loopback name) even though the variable is set;
   * `no-account` means it names an account this database does not have. Both are
   * configuration, not something the visitor did.
   */
  const previewProblem =
    params.preview === 'unavailable'
      ? `Preview sign-in is on, but this page was not reached over localhost, so it was refused. Open http://127.0.0.1 instead.`
      : params.preview === 'no-account'
        ? 'Preview sign-in names an account this server does not have. Check TASKTICK_PREVIEW_AUTH, or run npm run db:seed.'
        : params.preview
          ? 'Preview sign-in could not create a session. The server log has the details.'
          : null;

  return (
    <LoginForm
      oidcEnabled={state.oidc.enabled}
      oidcName={state.oidc.name}
      oidcProblem={oidc?.problem}
      oidcFailure={oidcFailure}
      expiredSession={sentSessionCookie && !oidcFailure}
      canRegister={registrationAllowed(state)}
      requiresInvite={state.requiresInvite}
      previewProblem={previewProblem}
      // A notification deep link remembered by the middleware, so signing in
      // lands on the reminder instead of the generic list.
      next={next}
    />
  );
}
