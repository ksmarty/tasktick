'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { ArrowRightIcon } from '@svg-animated-icons/react/arrow-right';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ChevronRightIcon } from '@svg-animated-icons/react/chevron-right';
import { EnvelopeClosedIcon } from '@svg-animated-icons/react/envelope-closed';
import { EyeClosedIcon } from '@svg-animated-icons/react/eye-closed';
import { EyeOpenIcon } from '@svg-animated-icons/react/eye-open';
import { IdCardIcon } from '@svg-animated-icons/react/id-card';
import { LockClosedIcon } from '@svg-animated-icons/react/lock-closed';
import { LoaderCircle } from 'lucide-react';
import { AuroraText } from '@/components/godui/aurora-text';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { AUTH_AURORA_COLORS } from './aurora-colors';
import { signIn, startOidcSignIn } from '@/lib/auth-client';

/**
 * Positions a decorative field glyph inside a `relative` input wrapper.
 *
 * A class string rather than a component: the glyph is an `<span aria-hidden>`
 * (the animated icons forward a `className` but no ARIA props), so wrapping it
 * in anything would be a wrapper for the sake of a wrapper.
 */
const GLYPH =
  'pointer-events-none absolute top-1/2 left-3 inline-flex -translate-y-1/2 text-base text-muted-foreground';

/**
 * Sign-in form.
 *
 * Uses better-auth's own client rather than posting to the API by hand, so
 * CSRF, the session cookie and error shaping are all handled by the library —
 * none of that logic changed in the move off Material; only the presentation did.
 */
export function LoginForm({ oidcEnabled, oidcName }: { oidcEnabled: boolean; oidcName: string }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
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
    router.replace('/tasks');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <span aria-hidden className="inline-flex text-4xl">
            <CheckIcon />
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            <AuroraText colors={AUTH_AURORA_COLORS}>TaskTick</AuroraText>
          </h1>
          <p className="text-sm text-muted-foreground">Sign in to your tasks, calendar and habits.</p>
        </div>
      </header>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">Email</Label>
          <div className="relative">
            <span aria-hidden className={GLYPH}>
              <EnvelopeClosedIcon />
            </span>
            <Input
              id="email"
              type="email"
              name="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              className="h-11 pl-9"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="password">Password</Label>
          <div className="relative">
            <span aria-hidden className={GLYPH}>
              <LockClosedIcon />
            </span>
            <Input
              id="password"
              type={showPassword ? 'text' : 'password'}
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="••••••••"
              className="h-11 pr-10 pl-9"
            />
            <button
              type="button"
              onClick={() => setShowPassword((visible) => !visible)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute top-1/2 right-2 inline-flex -translate-y-1/2 rounded-md p-1 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span aria-hidden className="inline-flex text-base">
                {showPassword ? <EyeClosedIcon /> : <EyeOpenIcon />}
              </span>
            </button>
          </div>
        </div>

        {error ? (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        ) : null}

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full"
          disabled={!email || !password}
        >
          Sign in
          <span aria-hidden className="inline-flex">
            {busy ? <LoaderCircle className="animate-spin" /> : <ArrowRightIcon />}
          </span>
        </Button>
      </form>

      {oidcEnabled ? (
        <>
          <div className="flex items-center gap-3">
            <Separator className="flex-1" />
            <span className="text-xs text-muted-foreground">or</span>
            <Separator className="flex-1" />
          </div>
          <Button
            type="button"
            variant="outline"
            size="lg"
            className="h-auto w-full justify-start gap-3 px-row py-3 text-left whitespace-normal"
            onClick={() => void startOidcSignIn('/tasks')}
          >
            <span aria-hidden className="inline-flex text-lg text-primary">
              <IdCardIcon />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{oidcName}</span>
              <span className="text-xs text-muted-foreground">
                Continue with your identity provider
              </span>
            </span>
            <span aria-hidden className="ml-auto inline-flex text-muted-foreground">
              <ChevronRightIcon />
            </span>
          </Button>
        </>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">
        Need an account?{' '}
        <NextLink
          href="/register"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Create one
        </NextLink>
      </p>
    </div>
  );
}
