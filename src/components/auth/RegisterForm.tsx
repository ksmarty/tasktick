'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import InputAdornment from '@mui/material/InputAdornment';
import Link from '@mui/material/Link';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import LockIcon from '@mui/icons-material/Lock';
import MailIcon from '@mui/icons-material/Mail';
import PersonIcon from '@mui/icons-material/Person';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
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
    <Stack spacing={3}>
      <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 64,
            height: 64,
            borderRadius: 3,
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
          }}
        >
          {isFirstRun ? (
            <AutoAwesomeIcon sx={{ fontSize: 36 }} aria-hidden />
          ) : (
            <PersonIcon sx={{ fontSize: 36 }} aria-hidden />
          )}
        </Box>
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
            {isFirstRun ? 'Set up TaskTick' : 'Create your account'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {isFirstRun
              ? 'This first account becomes the administrator of this instance.'
              : 'Your tasks, calendars and habits stay on this server.'}
          </Typography>
        </Box>
      </Stack>

      <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
        <TextField
          fullWidth
          label="Name"
          name="name"
          autoComplete="name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ada Lovelace"
          slotProps={{
            inputLabel: { shrink: true },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <PersonIcon aria-hidden />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          fullWidth
          label="Email"
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
          slotProps={{
            inputLabel: { shrink: true },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <MailIcon aria-hidden />
                </InputAdornment>
              ),
            },
          }}
        />
        <TextField
          fullWidth
          label="Password"
          type="password"
          name="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="At least 8 characters"
          error={tooShort}
          helperText={tooShort ? 'Passwords must be at least 8 characters.' : undefined}
          slotProps={{
            inputLabel: { shrink: true },
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <LockIcon aria-hidden />
                </InputAdornment>
              ),
            },
          }}
        />
        {requiresInvite ? (
          <TextField
            fullWidth
            label="Invite code"
            name="invite"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            value={invite}
            onChange={(event) => setInvite(event.target.value)}
            placeholder="Paste your invite code"
            helperText="Issued by an administrator of this instance."
            slotProps={{
              inputLabel: { shrink: true },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <ConfirmationNumberIcon aria-hidden />
                  </InputAdornment>
                ),
              },
            }}
          />
        ) : null}

        {error ? (
          <Alert severity="error" role="alert">
            {error}
          </Alert>
        ) : null}

        <Button
          type="submit"
          variant="contained"
          size="large"
          fullWidth
          disabled={!email || password.length < 8 || (requiresInvite && !invite.trim())}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          {isFirstRun ? 'Create administrator account' : 'Create account'}
        </Button>
      </Stack>

      {oidcEnabled ? (
        <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
          <List disablePadding>
            <ListItem disablePadding>
              <ListItemButton onClick={() => void startOidcSignIn('/tasks')} sx={{ gap: 1.5, py: 1.25 }}>
                <ListItemIcon sx={{ minWidth: 0, color: 'primary.main' }}>
                  <VerifiedUserIcon aria-hidden />
                </ListItemIcon>
                <ListItemText primary={`Continue with ${oidcName}`} />
                <ChevronRightIcon sx={{ color: 'text.disabled', flexShrink: 0 }} aria-hidden />
              </ListItemButton>
            </ListItem>
          </List>
        </Paper>
      ) : null}

      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        Already have an account?{' '}
        <Link component={NextLink} href="/login" underline="hover">
          Sign in
        </Link>
      </Typography>
    </Stack>
  );
}
