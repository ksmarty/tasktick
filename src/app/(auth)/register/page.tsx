import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { RegisterForm } from '@/components/auth/RegisterForm';
import { getInstanceState, registrationAllowed } from '@/server/services/instance';

export const metadata: Metadata = { title: 'Create account' };
export const dynamic = 'force-dynamic';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const [{ invite }, state] = await Promise.all([searchParams, getInstanceState()]);

  // With registration closed, the only reachable path is the first-run bootstrap.
  if (!registrationAllowed(state)) redirect('/login');

  return (
    <RegisterForm
      isFirstRun={state.isFirstRun}
      // An invite supplied in the URL satisfies the requirement, so the field is
      // hidden rather than shown pre-filled and immutable.
      requiresInvite={state.requiresInvite && !invite}
      oidcEnabled={state.oidc.enabled}
      oidcName={state.oidc.name}
      initialInvite={invite ?? ''}
    />
  );
}
