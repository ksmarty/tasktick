'use client';

/**
 * Invitations.
 *
 * Registration is invite-gated, so this is how anyone else gets in. The link is
 * returned in full exactly once — when the invite is created — which is why the
 * create response is rendered as its own card with a copy button and a plain
 * warning that it will not be shown again. Listing existing invites shows only
 * whether each one is still usable.
 *
 * The expiry choices were a row of buttons changing weight on selection; they are
 * a genuine either/or set, so they are the GodUI `SegmentedControl` — the primitive
 * the MUI `ToggleButtonGroup` was standing in for — and the newly minted link
 * reuses `SettingsGroup` so it lines up with the cards around it.
 */
import { useState } from 'react';
import { ClipboardCopyIcon } from '@svg-animated-icons/react/clipboard-copy';
import { EnvelopeClosedIcon } from '@svg-animated-icons/react/envelope-closed';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { SegmentedControl, type SegmentedOption } from '@/components/godui/segmented-control';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { relativeTimeAgo } from '@/lib/dates';
import { copyText } from './clipboard';
import { MONO_URL_BOX_CLASS } from './styles';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import type { InvitePayload } from '@/lib/view-types';

const EXPIRY_OPTIONS: SegmentedOption[] = [
  { value: '7', label: '7 days' },
  { value: '14', label: '14 days' },
  { value: '30', label: '30 days' },
];

export function InviteManager() {
  const { toast } = useToast();
  const invites = useResource<InvitePayload[]>('/api/invites');

  const [email, setEmail] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);
  const [expiresInDays, setExpiresInDays] = useState('14');
  const [freshUrl, setFreshUrl] = useState<string | null>(null);

  const list = invites.data ?? [];

  const refresh = () => {
    invalidate('/api/invites');
    void invites.refresh();
  };

  const create = useMutation(
    async () => {
      const trimmed = email.trim();
      if (!trimmed) throw new Error('Enter the email address to invite.');
      return api.post<{ id: string; url: string; expiresAtMs: number }>('/api/invites', {
        email: trimmed,
        isAdmin,
        expiresInDays: Number.parseInt(expiresInDays, 10) || 14,
      });
    },
    {
      invalidates: ['/api/invites'],
      onSuccess: (created) => {
        setFreshUrl(created?.url ?? null);
        setEmail('');
        setIsAdmin(false);
        refresh();
      },
      onError: (message) => toast({ title: 'Could not create the invitation', description: message, variant: 'error' }),
    },
  );

  async function copy(url: string) {
    const copied = await copyText(url);
    toast(
      copied
        ? { title: 'Invitation link copied', variant: 'success' }
        : { title: 'Copying is not available', description: 'Select the link and copy it by hand.', variant: 'error' },
    );
  }

  return (
    <>
      <SettingsGroup
        title="Invite someone"
        footer="Creating a new invitation for the same address cancels the previous one, so only the newest link works."
      >
        <SettingsRow stacked>
          <Label htmlFor="invite-email">Email address</Label>
          <div className="relative">
            <EnvelopeClosedIcon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="invite-email"
              className="pl-9"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="friend@example.com"
              maxLength={320}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="invite-admin" className="min-w-0 flex-1">
              Make them an administrator
            </Label>
            <Switch
              id="invite-admin"
              aria-label="Make them an administrator"
              checked={isAdmin}
              onCheckedChange={setIsAdmin}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p id="invite-expiry-label" className="text-sm font-medium">
              Link expires in
            </p>
            <SegmentedControl
              aria-labelledby="invite-expiry-label"
              size="sm"
              options={EXPIRY_OPTIONS}
              value={expiresInDays}
              onChange={setExpiresInDays}
            />
          </div>

          <Button
            className="w-full"
            aria-busy={create.isPending || undefined}
            disabled={create.isPending || !email.trim()}
            onClick={() => void create.run()}
          >
            <PlusIcon />
            Create invitation
          </Button>
        </SettingsRow>
      </SettingsGroup>

      {freshUrl ? (
        <SettingsGroup
          title="Invitation link"
          footer="Send this to them yourself — this server has no mail delivery, and the link is shown in full only once."
        >
          <SettingsRow stacked>
            <p className={MONO_URL_BOX_CLASS}>{freshUrl}</p>
            <Button size="sm" className="self-start" onClick={() => void copy(freshUrl)}>
              <ClipboardCopyIcon />
              Copy link
            </Button>
          </SettingsRow>
        </SettingsGroup>
      ) : null}

      <SettingsGroup title="Invitations" footer="Accepted invitations are spent and cannot be reused.">
        {invites.isInitialLoading ? (
          <SettingsRow>
            <Skeleton className="h-10 w-full" />
          </SettingsRow>
        ) : list.length === 0 ? (
          <SettingsRow>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">No invitations yet</span>
              <span className="block text-xs text-muted-foreground">Invite someone above to get a link.</span>
            </span>
          </SettingsRow>
        ) : (
          list.map((invite) => {
            const expired = invite.expiresAtMs < Date.now();
            const status = invite.acceptedAtMs
              ? 'accepted'
              : expired
                ? `expired ${relativeTimeAgo(invite.expiresAtMs)}`
                : `expires in ${Math.max(1, Math.round((invite.expiresAtMs - Date.now()) / 86_400_000))} days`;
            return (
              <SettingsRow key={invite.id}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{invite.email}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {`${invite.isAdmin ? 'Administrator · ' : ''}${status}`}
                  </span>
                </span>
                {invite.url && !expired && !invite.acceptedAtMs ? (
                  <Button size="sm" variant="ghost" onClick={() => void copy(invite.url!)}>
                    <ClipboardCopyIcon />
                    Copy
                  </Button>
                ) : null}
              </SettingsRow>
            );
          })
        )}
      </SettingsGroup>
    </>
  );
}
