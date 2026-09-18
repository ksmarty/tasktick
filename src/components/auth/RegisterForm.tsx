'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import { ArrowRightIcon } from '@svg-animated-icons/react/arrow-right';
import { ChevronRightIcon } from '@svg-animated-icons/react/chevron-right';
import { ClipboardCopyIcon } from '@svg-animated-icons/react/clipboard-copy';
import { EnvelopeClosedIcon } from '@svg-animated-icons/react/envelope-closed';
import { EyeClosedIcon } from '@svg-animated-icons/react/eye-closed';
import { EyeOpenIcon } from '@svg-animated-icons/react/eye-open';
import { IdCardIcon } from '@svg-animated-icons/react/id-card';
import { LockClosedIcon } from '@svg-animated-icons/react/lock-closed';
import { PersonIcon } from '@svg-animated-icons/react/person';
import { StarIcon } from '@svg-animated-icons/react/star';
import { LoaderCircle } from 'lucide-react';
import { AuroraText } from '@/components/godui/aurora-text';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AUTH_AURORA_COLORS } from './aurora-colors';
import { signUp, startOidcSignIn } from '@/lib/auth-client';

export interface RegisterFormProps {
  /** No accounts yet — this registration creates the administrator. */
  isFirstRun: boolean;
  /** An invite code is required, so the field is shown and validated. */
  requiresInvite: boolean;
  oidcEnabled: boolean;
  oidcName: string;
  /** Pre-filled from `?invite=` in the link the admin shared. */
  initialInvite?: string;
}

/**
 * Positions a decorative field glyph inside a `relative` input wrapper. See the
 * note on the same constant in `LoginForm.tsx`.
 */
const GLYPH =
  'pointer-events-none absolute top-1/2 left-3 inline-flex -translate-y-1/2 text-base text-muted-foreground';

/**
 * Registration form.
 *
 * The invite code is passed through to better-auth in the request body, where
 * the server-side `databaseHooks.user.create.before` hook validates it before the
 * user row is written — so an invalid code never leaves a half-created account.
 *
 * The first-run case is not a separate screen: the same form renders the
 * "create the administrator account" copy and submit label, because the
 * behaviour behind it is identical.
 */
export function RegisterForm({
  isFirstRun,
  requiresInvite,
  oidcEnabled,
  oidcName,
  initialInvite = '',
}: RegisterFormProps) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invite, setInvite] = useState(initialInvite);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = password.length > 0 && password.length < 8;

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Choose a password with at least 8 characters.');
      return;
    }
    if (requiresInvite && !invite.trim()) {
      setError('An invite code is required to register on this instance.');
      return;
    }

    setBusy(true);

    // `inviteToken` is read by the server-side user-create hook from the raw
    // body; better-auth does not type unknown fields, hence the widening cast.
    const payload = {
      name: name.trim() || email.split('@')[0],
      email: email.trim(),
      password,
      ...(invite.trim() ? { inviteToken: invite.trim() } : {}),
    };

    const { error: authError } = await signUp.email(payload as never);

    if (authError) {
      setError(authError.message ?? 'We could not create that account.');
      setBusy(false);
      return;
    }

    router.replace('/tasks');
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-16 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <span aria-hidden className="inline-flex text-4xl">
            {isFirstRun ? <StarIcon /> : <PersonIcon />}
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-bold tracking-tight">
            <AuroraText colors={AUTH_AURORA_COLORS}>
              {isFirstRun ? 'Set up TaskTick' : 'Create your account'}
            </AuroraText>
          </h1>
          <p className="text-sm text-muted-foreground">
            {isFirstRun
              ? 'This first account becomes the administrator of this instance.'
              : 'Your tasks, calendars and habits stay on this server.'}
          </p>
        </div>
      </header>

      <form className="flex flex-col gap-4" onSubmit={onSubmit} noValidate>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">Name</Label>
          <div className="relative">
            <span aria-hidden className={GLYPH}>
              <PersonIcon />
            </span>
            <Input
              id="name"
              name="name"
              autoComplete="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ada Lovelace"
              className="h-11 pl-9"
            />
          </div>
        </div>

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
              autoComplete="new-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="At least 8 characters"
              aria-invalid={tooShort}
              aria-describedby={tooShort ? 'password-error' : undefined}
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
          {tooShort ? (
            <p id="password-error" className="text-xs text-destructive">
              Passwords must be at least 8 characters.
            </p>
          ) : null}
        </div>

        {requiresInvite ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite">Invite code</Label>
            <div className="relative">
              <span aria-hidden className={GLYPH}>
                <ClipboardCopyIcon />
              </span>
              <Input
                id="invite"
                name="invite"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                required
                value={invite}
                onChange={(event) => setInvite(event.target.value)}
                placeholder="Paste your invite code"
                aria-describedby="invite-hint"
                className="h-11 pl-9"
              />
            </div>
            <p id="invite-hint" className="text-xs text-muted-foreground">
              Issued by an administrator of this instance.
            </p>
          </div>
        ) : null}

        {error ? (
          <Alert variant="destructive" role="alert">
            {error}
          </Alert>
        ) : null}

        <Button
          type="submit"
          size="lg"
          className="h-11 w-full"
          disabled={!email || password.length < 8 || (requiresInvite && !invite.trim())}
        >
          {isFirstRun ? 'Create administrator account' : 'Create account'}
          <span aria-hidden className="inline-flex">
            {busy ? <LoaderCircle className="animate-spin" /> : <ArrowRightIcon />}
          </span>
        </Button>
      </form>

      {oidcEnabled ? (
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
          <span className="text-sm font-medium">Continue with {oidcName}</span>
          <span aria-hidden className="ml-auto inline-flex text-muted-foreground">
            <ChevronRightIcon />
          </span>
        </Button>
      ) : null}

      <p className="text-center text-sm text-muted-foreground">
        Already have an account?{' '}
        <NextLink
          href="/login"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          Sign in
        </NextLink>
      </p>
    </div>
  );
}
