'use client';

/**
 * Invitations.
 *
 * Registration is invite-gated, so this is how anyone else gets in. The link is
 * returned in full exactly once — when the invite is created — which is why the
 * create response is rendered as its own card with a copy button and a plain
 * warning that it will not be shown again. Listing existing invites shows only
 * whether each one is still usable.
 */
import { useState } from 'react';
import { Copy, Mail, UserPlus } from 'lucide-react';
import { Button, ListRow, Skeleton, Switch, TextField, useToast } from '@/components/ui';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { relativeTimeAgo } from '@/lib/dates';
import { copyText } from './clipboard';
import { SettingsGroup } from './SettingsGroup';
import type { InvitePayload } from '@/lib/view-types';

const EXPIRY_OPTIONS = [
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
        <div className="space-y-3 px-4 py-3">
          <TextField
            label="Email address"
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            leading={<Mail className="size-4" aria-hidden />}
            placeholder="friend@example.com"
            maxLength={320}
          />
          <Switch label="Make them an administrator" checked={isAdmin} onCheckedChange={setIsAdmin} />
          <div>
            <p className="mb-1.5 px-1 text-footnote text-secondary">Link expires in</p>
            <div className="flex gap-2">
              {EXPIRY_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  size="sm"
                  variant={expiresInDays === option.value ? 'filled' : 'gray'}
                  onClick={() => setExpiresInDays(option.value)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
          <Button fullWidth icon={UserPlus} loading={create.isPending} disabled={!email.trim()} onClick={() => void create.run()}>
            Create invitation
          </Button>
        </div>
      </SettingsGroup>

      {freshUrl ? (
        <div className="grouped mx-4 mt-4 p-4">
          <p className="text-subhead font-semibold text-label">Invitation link</p>
          <p className="break-all pt-1 font-mono text-caption-1 text-secondary">{freshUrl}</p>
          <div className="pt-3">
            <Button size="sm" icon={Copy} onClick={() => void copy(freshUrl)}>
              Copy link
            </Button>
          </div>
          <p className="pt-2 text-caption-1 text-tertiary">
            Send this to them yourself — this server has no mail delivery, and the link is shown in full only once.
          </p>
        </div>
      ) : null}

      <SettingsGroup title="Invitations" footer="Accepted invitations are spent and cannot be reused.">
        {invites.isInitialLoading ? (
          <div className="px-4 py-3">
            <Skeleton variant="rect" className="h-10" />
          </div>
        ) : list.length === 0 ? (
          <ListRow title="No invitations yet" subtitle="Invite someone above to get a link." />
        ) : (
          list.map((invite) => {
            const expired = invite.expiresAtMs < Date.now();
            const status = invite.acceptedAtMs
              ? 'accepted'
              : expired
                ? `expired ${relativeTimeAgo(invite.expiresAtMs)}`
                : `expires in ${Math.max(1, Math.round((invite.expiresAtMs - Date.now()) / 86_400_000))} days`;
            return (
              <ListRow
                key={invite.id}
                title={invite.email}
                subtitle={`${invite.isAdmin ? 'Administrator · ' : ''}${status}`}
                trailing={
                  invite.url && !expired && !invite.acceptedAtMs ? (
                    <Button size="sm" variant="plain" icon={Copy} onClick={() => void copy(invite.url!)}>
                      Copy
                    </Button>
                  ) : undefined
                }
              />
            );
          })
        )}
      </SettingsGroup>
    </>
  );
}
