'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ListChecks, Mail, Lock, ShieldCheck } from 'lucide-react';
import { Button, ListGroup, ListRow, TextField } from '@/components/ui';
import { signIn, startOidcSignIn } from '@/lib/auth-client';

/**
 * Sign-in form.
 *
 * Uses better-auth's own client rather than posting to the API by hand, so
 * CSRF, the session cookie and error shaping are all handled by the library.
 */
export function LoginForm({ oidcEnabled, oidcName }: { oidcEnabled: boolean; oidcName: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);

    const { error: authError } = await signIn.email({ email: email.trim(), password });

    if (authError) {
      // Deliberately vague: distinguishing "no such account" from "wrong
      // password" hands an attacker a user-enumeration oracle.
      setError(authError.message ?? 'That email and password combination was not recognised.');
      setBusy(false);
      return;
    }

    // A full replace (not push) so the sign-in page is not in the back stack.
    router.replace('/today');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-[19px] bg-tint text-tint-contrast shadow-ios">
          <ListChecks className="size-9" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-title-1 font-bold tracking-tight">TaskTick</h1>
          <p className="text-subhead text-secondary">Sign in to your tasks, calendar and habits.</p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <ListGroup>
          <TextField
            label="Email"
            type="email"
            name="email"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            leading={<Mail className="size-5" aria-hidden />}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@example.com"
            className="hairline-b"
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="current-password"
            required
            leading={<Lock className="size-5" aria-hidden />}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="••••••••"
          />
        </ListGroup>

        {error ? (
          <p role="alert" className="rounded-ios bg-danger/10 px-3 py-2 text-footnote text-danger">
            {error}
          </p>
        ) : null}

        <Button type="submit" variant="filled" size="lg" fullWidth loading={busy} disabled={!email || !password}>
          Sign in
        </Button>
      </form>

      {oidcEnabled ? (
        <>
          <div className="flex items-center gap-3 text-caption-1 text-tertiary">
            <span className="h-px flex-1 bg-separator" />
            or
            <span className="h-px flex-1 bg-separator" />
          </div>
          <ListGroup>
            <ListRow
              title={oidcName}
              subtitle="Continue with your identity provider"
              leading={<ShieldCheck className="size-5 text-tint" aria-hidden />}
              onClick={() => void startOidcSignIn('/today')}
              showChevron
            />
          </ListGroup>
        </>
      ) : null}

      <p className="text-center text-footnote text-secondary">
        Need an account?{' '}
        <Link href="/register" className="text-tint">
          Create one
        </Link>
      </p>
    </div>
  );
}
