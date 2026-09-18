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
 * can never succeed would be worse than saying so. It is a plain row with its text
 * at full contrast, not a disabled control — dimming a fact made it unreadable.
 *
 * shadcn's `Button` has no `loading` prop (MUI's did), so a pending write keeps
 * the button disabled, marks it `aria-busy` and shows a spinning glyph instead of
 * swapping the label — the width stays put, so nothing jumps under the thumb.
 *
 * There is deliberately no "delete account" control. The endpoint
 * (`POST /api/auth/delete-user`) is served by better-auth only when
 * `user.deleteUser.enabled` is set, and `src/server/auth.ts` does not set it, so
 * the call would always fail — and that file is outside this migration. A button
 * that cannot work is worse than no button; enabling it is a one-line change on
 * the server, after which this group can grow a confirm dialog.
 */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ExitIcon } from '@svg-animated-icons/react/exit';
import { LockClosedIcon } from '@svg-animated-icons/react/lock-closed';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/app/Toast';
import { authClient, signOut } from '@/lib/auth-client';
import { useMutation } from '@/lib/store';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
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
        <SettingsRow stacked>
          <Label htmlFor="account-name">Name</Label>
          <Input
            id="account-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            maxLength={200}
          />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            aria-busy={saveName.isPending || undefined}
            disabled={saveName.isPending || !name.trim() || name.trim() === user.name}
            onClick={() => void saveName.run()}
          >
            {saveName.isPending ? <ReloadIcon className="animate-spin" /> : null}
            Save name
          </Button>
        </SettingsRow>

        <SettingsRow>
          <span className="min-w-0 flex-1">
            <span className="block text-sm">Email</span>
            <span className="block text-xs break-all text-muted-foreground">{user.email}</span>
          </span>
        </SettingsRow>

        <SettingsRow>
          <Button
            variant="outline"
            className="w-full"
            aria-busy={leave.isPending || undefined}
            disabled={leave.isPending}
            onClick={() => void leave.run()}
          >
            <ExitIcon />
            Sign out
          </Button>
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title="Change password" footer="At least 8 characters. Other sessions are signed out afterwards.">
        <SettingsRow stacked>
          <Label htmlFor="current-password">Current password</Label>
          <div className="relative">
            <LockClosedIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="current-password"
              className="pl-9"
              type="password"
              autoComplete="current-password"
              maxLength={500}
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          </div>

          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            autoComplete="new-password"
            maxLength={200}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
          />

          <Button
            className="w-full"
            aria-busy={savePassword.isPending || undefined}
            disabled={!canChangePassword || savePassword.isPending}
            onClick={() => void savePassword.run()}
          >
            {savePassword.isPending ? <ReloadIcon className="animate-spin" /> : null}
            Change password
          </Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );
}
