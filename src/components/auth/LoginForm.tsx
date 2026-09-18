'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import NextLink from 'next/link';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
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
import ChecklistIcon from '@mui/icons-material/Checklist';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import LockIcon from '@mui/icons-material/Lock';
import MailIcon from '@mui/icons-material/Mail';
import VerifiedUserIcon from '@mui/icons-material/VerifiedUser';
import { signIn, startOidcSignIn } from '@/lib/auth-client';

/**
 * Sign-in form.
 *
 * Uses better-auth's own client rather than posting to the API by hand, so
 * CSRF, the session cookie and error shaping are all handled by the library.
 *
 * Presentation is Material: outlined `TextField`s with the glyph as a start
 * adornment (the label is pinned open, `shrink`, so it never collides with the
 * adornment), an `Alert` for the error, and a MUI `Link` wrapping `next/link`
 * for the switch to registration.
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
          <ChecklistIcon sx={{ fontSize: 36 }} aria-hidden />
        </Box>
        <Box>
          <Typography variant="h4" component="h1" sx={{ fontWeight: 700, letterSpacing: '-0.01em' }}>
            TaskTick
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Sign in to your tasks, calendar and habits.
          </Typography>
        </Box>
      </Stack>

      <Stack component="form" spacing={2} onSubmit={onSubmit} noValidate>
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="••••••••"
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
          disabled={!email || !password}
          startIcon={busy ? <CircularProgress size={18} color="inherit" /> : undefined}
        >
          Sign in
        </Button>
      </Stack>

      {oidcEnabled ? (
        <>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', color: 'text.secondary' }}>
            <Divider sx={{ flex: 1 }} />
            <Typography variant="caption">or</Typography>
            <Divider sx={{ flex: 1 }} />
          </Stack>
          <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
            <List disablePadding>
              <ListItem disablePadding>
                <ListItemButton
                  onClick={() => void startOidcSignIn('/tasks')}
                  sx={{ gap: 1.5, py: 1.25 }}
                >
                  <ListItemIcon sx={{ minWidth: 0, color: 'primary.main' }}>
                    <VerifiedUserIcon aria-hidden />
                  </ListItemIcon>
                  <ListItemText primary={oidcName} secondary="Continue with your identity provider" />
                  <ChevronRightIcon sx={{ color: 'text.disabled', flexShrink: 0 }} aria-hidden />
                </ListItemButton>
              </ListItem>
            </List>
          </Paper>
        </>
      ) : null}

      <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
        Need an account?{' '}
        <Link component={NextLink} href="/register" underline="hover">
          Create one
        </Link>
      </Typography>
    </Stack>
  );
}
