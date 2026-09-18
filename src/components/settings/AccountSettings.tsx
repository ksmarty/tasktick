'use client';

/**
 * Account: the display name, the sign-in address, the password and the way out.
 *
 * All of them go through the better-auth client (`@/lib/auth-client`) rather than
 * the app's own API, because the session cookie is better-auth's to manage.
 * Better-auth returns `{ data, error }` instead of throwing, so every call is
 * unwrapped and turned into a toast — a silent failure here means a user who
 * believes a password changed when it did not.
 *
 * The email row is read-only on purpose: better-auth only accepts an email change
 * with a verification mail, and this server has no SMTP. Offering a button that
 * can never succeed would be worse than saying so. It is a plain `ListItem` with
 * its text at full contrast, not a disabled control — dimming a fact made it
 * unreadable.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@mui/material/Button';
import InputAdornment from '@mui/material/InputAdornment';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import KeyIcon from '@mui/icons-material/Key';
import LogoutIcon from '@mui/icons-material/Logout';
import { useToast } from '@/components/app/Toast';
import { authClient, signOut } from '@/lib/auth-client';
import { useMutation } from '@/lib/store';
import { SettingsGroup } from './SettingsGroup';
import type { SessionUser } from '@/lib/types';

export interface AccountSettingsProps {
  user: SessionUser;
}

/**
 * better-auth reports failures inside the result envelope instead of throwing, so
 * an unchecked `await` would treat a rejected password as a success. This turns
 * the envelope back into an exception for `useMutation`.
 */
function ensureOk(result: { error?: { message?: string } | null }, fallback: string): void {
  if (result.error) throw new Error(result.error.message ?? fallback);
}

export function AccountSettings({ user }: AccountSettingsProps) {
  const { toast } = useToast();
  const router = useRouter();

  const [name, setName] = useState(user.name);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const saveName = useMutation(
    async () => {
      const result = await authClient.updateUser({ name: name.trim() });
      ensureOk(result, 'Your name could not be saved.');
    },
    {
      invalidates: ['/api/bootstrap'],
      onSuccess: () => toast({ title: 'Name updated', variant: 'success' }),
      onError: (message) => toast({ title: 'Could not save your name', description: message, variant: 'error' }),
    },
  );

  const savePassword = useMutation(
    async () => {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      ensureOk(result, 'The password could not be changed.');
    },
    {
      onSuccess: () => {
        setCurrentPassword('');
        setNewPassword('');
        toast({
          title: 'Password changed',
          description: 'Other devices were signed out.',
          variant: 'success',
        });
      },
      onError: (message) => toast({ title: 'Could not change the password', description: message, variant: 'error' }),
    },
  );

  const leave = useMutation(
    async () => {
      const result = await signOut();
      ensureOk(result, 'The session could not be closed.');
    },
    {
      onSuccess: () => router.replace('/login'),
      onError: (message) => toast({ title: 'Could not sign out', description: message, variant: 'error' }),
    },
  );

  const canChangePassword = currentPassword.length > 0 && newPassword.length >= 8;

  return (
    <>
      <SettingsGroup
        title="Account"
        footer={`Your sign-in address is ${user.email}. Changing it needs an email verification flow, which this server does not have configured.`}
      >
        <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
          <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <Button
              size="small"
              variant="outlined"
              loading={saveName.isPending}
              disabled={!name.trim() || name.trim() === user.name}
              onClick={() => void saveName.run()}
            >
              Save name
            </Button>
          </Stack>
        </ListItem>

        <ListItem>
          <ListItemText primary="Email" secondary={user.email} />
        </ListItem>

        <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
          <Button
            fullWidth
            variant="outlined"
            color="inherit"
            startIcon={<LogoutIcon aria-hidden />}
            loading={leave.isPending}
            onClick={() => void leave.run()}
          >
            Sign out
          </Button>
        </ListItem>
      </SettingsGroup>

      <SettingsGroup title="Change password" footer="At least 8 characters. Other sessions are signed out afterwards.">
        <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
          <Stack spacing={3}>
            <TextField
              fullWidth
              label="Current password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              slotProps={{
                htmlInput: { maxLength: 500 },
                input: {
                  startAdornment: (
                    <InputAdornment position="start">
                      <KeyIcon fontSize="small" aria-hidden />
                    </InputAdornment>
                  ),
                },
              }}
            />
            <TextField
              fullWidth
              label="New password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />
            <Button
              fullWidth
              variant="contained"
              disabled={!canChangePassword}
              loading={savePassword.isPending}
              onClick={() => void savePassword.run()}
            >
              Change password
            </Button>
          </Stack>
        </ListItem>
      </SettingsGroup>
    </>
  );
}
