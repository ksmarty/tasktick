'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Lock, Mail, ShieldCheck, Sparkles, Ticket, User } from 'lucide-react';
import { Button, ListGroup, ListRow, TextField } from '@/components/ui';
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
 * Registration form.
 *
 * The invite code is passed through to better-auth in the request body, where
 * the server-side `databaseHooks.user.create.before` hook validates it before the
 * user row is written — so an invalid code never leaves a half-created account.
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

    router.replace('/today');
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <header className="space-y-3 text-center">
        <div className="mx-auto flex size-16 items-center justify-center rounded-ios-2xl bg-tint text-tint-contrast shadow-ios">
          {isFirstRun ? <Sparkles className="size-9" aria-hidden /> : <User className="size-9" aria-hidden />}
        </div>
        <div className="space-y-1">
          <h1 className="text-title-1 font-bold tracking-tight">
            {isFirstRun ? 'Set up TaskTick' : 'Create your account'}
          </h1>
          <p className="text-subhead text-secondary">
            {isFirstRun
              ? 'This first account becomes the administrator of this instance.'
              : 'Your tasks, calendars and habits stay on this server.'}
          </p>
        </div>
      </header>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <ListGroup>
          <TextField
            label="Name"
            name="name"
            autoComplete="name"
            leading={<User className="size-5" aria-hidden />}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Ada Lovelace"
          />
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
          />
          <TextField
            label="Password"
            type="password"
            name="password"
            autoComplete="new-password"
            required
            leading={<Lock className="size-5" aria-hidden />}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="At least 8 characters"
            error={tooShort ? 'Passwords must be at least 8 characters.' : undefined}
          />
          {requiresInvite ? (
            <TextField
              label="Invite code"
              name="invite"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              leading={<Ticket className="size-5" aria-hidden />}
              value={invite}
              onChange={(event) => setInvite(event.target.value)}
              placeholder="Paste your invite code"
              hint="Issued by an administrator of this instance."
            />
          ) : null}
        </ListGroup>

        {error ? (
          <p role="alert" className="rounded-ios bg-danger/10 px-3 py-2 text-footnote text-danger">
            {error}
          </p>
        ) : null}

        <Button
          type="submit"
          variant="filled"
          size="lg"
          fullWidth
          loading={busy}
          disabled={!email || password.length < 8 || (requiresInvite && !invite.trim())}
        >
          {isFirstRun ? 'Create administrator account' : 'Create account'}
        </Button>
      </form>

      {oidcEnabled ? (
        <ListGroup>
          <ListRow
            title={`Continue with ${oidcName}`}
            leading={<ShieldCheck className="size-5 text-tint" aria-hidden />}
            onClick={() => void startOidcSignIn('/today')}
            showChevron
          />
        </ListGroup>
      ) : null}

      <p className="text-center text-footnote text-secondary">
        Already have an account?{' '}
        <Link href="/login" className="text-tint">
          Sign in
        </Link>
      </p>
    </div>
  );
}
