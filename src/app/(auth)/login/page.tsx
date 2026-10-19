import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { describeOidcCallbackError } from '@/lib/oidc-errors';
import { safeNextPath } from '@/lib/safe-next';
import { getInstanceState } from '@/server/services/instance';
import { describeOidcAvailability } from '@/server/oidc';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [params, state] = await Promise.all([searchParams, getInstanceState()]);

  // A fresh instance has nobody to sign in as; the only useful screen is
  // registration, which is also the admin bootstrap.
  if (state.isFirstRun) redirect('/register');

  if (state.registrationMode === 'closed' && state.userCount === 0) redirect('/register');

  // Only probed when the button would be shown: a signed-out page nobody can
  // act on should not pay for a network round trip to the identity provider.
  const oidc = state.oidc.enabled ? await describeOidcAvailability() : null;

  // The provider sends a failed round trip back here (`errorCallbackURL`), so
  // this is where the reason it failed finally becomes visible.
  const oidcFailure = describeOidcCallbackError(params.error, params.error_description);

  return (
    <LoginForm
      oidcEnabled={state.oidc.enabled}
      oidcName={state.oidc.name}
      oidcProblem={oidc?.problem}
      oidcFailure={oidcFailure}
      // A notification deep link remembered by the middleware, so signing in
      // lands on the reminder instead of the generic list.
      next={safeNextPath(params.next)}
    />
  );
}
