import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { LoginForm } from '@/components/auth/LoginForm';
import { getInstanceState } from '@/server/services/instance';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const state = await getInstanceState();

  // A fresh instance has nobody to sign in as; the only useful screen is
  // registration, which is also the admin bootstrap.
  if (state.isFirstRun) redirect('/register');

  if (state.registrationMode === 'closed' && state.userCount === 0) redirect('/register');

  return <LoginForm oidcEnabled={state.oidc.enabled} oidcName={state.oidc.name} />;
}
