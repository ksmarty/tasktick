'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { ArrowRightIcon } from '@svg-animated-icons/react/arrow-right';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { ChevronRightIcon } from '@svg-animated-icons/react/chevron-right';
import { EnvelopeClosedIcon } from '@svg-animated-icons/react/envelope-closed';
import { IdCardIcon } from '@svg-animated-icons/react/id-card';
import { LoaderCircle } from 'lucide-react';
import { AuroraText } from '@/components/godui/aurora-text';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AUTH_AURORA_COLORS } from './aurora-colors';
import { AuthField, AuthPasswordField } from './fields';
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
export function LoginForm({
  oidcEnabled,
  oidcName,
  oidcProblem,
  oidcFailure,
  expiredSession = false,
  canRegister = true,
  requiresInvite = false,
  previewProblem,
  next,
}: {
  oidcEnabled: boolean;
  oidcName: string;
  /**
   * Whether this instance accepts new accounts at all.
   *
   * The "create one" link used to be unconditional, so on an instance with
   * registration closed the only footer on the sign-in page led to `/register`,
   * which bounces straight back here. A dead end on the one screen a new visitor
   * sees, and nothing on it explained why.
   */
  canRegister?: boolean;
  /** Registration is open but gated by a code, so say so before the click. */
  requiresInvite?: boolean;
  /**
   * Why the preview sign-in (`src/lib/preview-auth.ts`) did not happen. Only
   * ever set on a machine that turned that feature on, and only when it failed —
   * which is the case worth a sentence, because the expected behaviour there is
   * never seeing this page at all.
   */
  previewProblem?: string | null;
  /** Why the provider cannot be reached, from the server-side discovery probe. */
  oidcProblem?: string;
  /** Why the last single sign-on round trip failed, from the callback's `?error=`. */
  oidcFailure?: string | null;
  /**
   * The request carried a session cookie the server would not accept. Worth a
   * sentence: without it, "it asked again" is indistinguishable from "the browser
   * threw the cookie away", and the two have nothing in common to fix.
   */
  expiredSession?: boolean;
  /**
   * Where to go once signed in — the page the middleware caught the visitor
   * asking for, so a reminder deep link survives the sign-in it interrupted.
   * Already sanitised by `safeNextPath()` on the server.
   */
  next: string;
}) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // Seeded from the query so a failed round trip explains itself without the
  // user having to retry first to see something happen.
  const [error, setError] = useState<string | null>(oidcFailure ?? null);
  const [busy, setBusy] = useState(false);
  const [oidcBusy, setOidcBusy] = useState(false);

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
    router.replace(next);
    router.refresh();
  }

  /**
   * Starts single sign-on, and — the part that was missing — says so when it
   * cannot.
   *
   * `startOidcSignIn` already throws with the server's own explanation; it used
   * to be called with `void`, which discarded that rejection. The button then
   * looked inert: no error, no navigation, no clue why. On success this function
   * never returns, because the browser leaves for the provider.
   */
  async function onOidcSignIn() {
    setError(null);
    setOidcBusy(true);
    try {
      // The same destination on both legs: a deep link has to survive the
      // round trip through the provider, not just a password sign-in.
      await startOidcSignIn(next);
    } catch (oidcError) {
      setError(
        oidcError instanceof Error && oidcError.message
          ? oidcError.message
          : 'Could not start single sign-on.',
      );
      setOidcBusy(false);
    }
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
        <AuthField
          id="email"
          label="Email"
          icon={<EnvelopeClosedIcon />}
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
        />

        <AuthPasswordField
          id="password"
          label="Password"
          autoComplete="current-password"
          value={password}
          onChange={setPassword}
          placeholder="••••••••"
        />

        {error ? (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        ) : previewProblem ? (
          <Alert role="status">{previewProblem}</Alert>
        ) : expiredSession ? (
          <Alert role="status">
            Your saved session is no longer valid, so signing in once more is
            expected. If this happens every time you open the app, the browser is
            discarding the cookie — see <em>HTTPS is required</em> in the README.
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
            onClick={() => void onOidcSignIn()}
            disabled={oidcBusy}
            aria-busy={oidcBusy}
          >
            <span aria-hidden className="inline-flex text-lg text-primary">
              <IdCardIcon />
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium">{oidcName}</span>
              <span className="text-xs text-muted-foreground">
                {oidcBusy ? 'Contacting your identity provider…' : 'Continue with your identity provider'}
              </span>
            </span>
            <span aria-hidden className="ml-auto inline-flex text-muted-foreground">
              {oidcBusy ? <LoaderCircle className="animate-spin" /> : <ChevronRightIcon />}
            </span>
          </Button>
          {oidcProblem ? (
            <p className="text-xs leading-relaxed text-muted-foreground" role="status">
              <span className="font-medium text-foreground">
                Single sign-on is not reachable right now.
              </span>{' '}
              {oidcProblem}
            </p>
          ) : null}
        </>
      ) : null}

      {canRegister ? (
        <p className="text-center text-sm text-muted-foreground">
          Need an account?{' '}
          <NextLink
            href="/register"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Create one
          </NextLink>
          {requiresInvite ? ' with an invite code' : ''}
        </p>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          New accounts are disabled on this server. An administrator can add you
          from Settings.
        </p>
      )}
    </div>
  );
}
