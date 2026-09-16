'use client';

/**
 * Calendar subscriptions: the read-only feed the server publishes for other
 * calendar apps.
 *
 * A subscription URL contains its own token, so it is both the credential and the
 * address: the screen shows it once, offers to copy it in the two forms that
 * matter (`https://` for Google and Outlook, `webcal://` for Apple Calendar, which
 * is what makes iOS hand the URL to Calendar instead of printing it), and lets it
 * be revoked when it leaks. A revoked URL stops working immediately, which is why
 * revocation asks for confirmation.
 */
import { useState } from 'react';
import { CalendarPlus, Copy, Link2, Plus, Trash2 } from 'lucide-react';
import { Button, ConfirmDialog, ListRow, Skeleton, Switch, TextField, useToast } from '@/components/ui';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { copyText, toWebcal } from './clipboard';
import { SettingsGroup } from './SettingsGroup';
import type { IcalTokenPayload } from '@/lib/view-types';

export function IcalSubscriptionCard() {
  const { toast } = useToast();
  const tokens = useResource<IcalTokenPayload[]>('/api/ical-tokens');

  const [name, setName] = useState('');
  const [includeTasks, setIncludeTasks] = useState(true);
  const [includeEvents, setIncludeEvents] = useState(false);
  const [freshUrl, setFreshUrl] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<IcalTokenPayload | null>(null);

  const list = tokens.data ?? [];

  const refresh = () => {
    invalidate('/api/ical-tokens');
    void tokens.refresh();
  };

  const create = useMutation(
    async () => {
      const created = await api.post<IcalTokenPayload>('/api/ical-tokens', {
        name: name.trim() || undefined,
        includeTasks,
        includeEvents,
      });
      return created;
    },
    {
      invalidates: ['/api/ical-tokens'],
      onSuccess: (created) => {
        setFreshUrl(created?.url ?? null);
        setName('');
        refresh();
      },
      onError: (message) => toast({ title: 'Could not create a subscription', description: message, variant: 'error' }),
    },
  );

  const revoke = useMutation(async (token: IcalTokenPayload) => api.delete<{ revoked: boolean }>(`/api/ical-tokens/${token.id}`), {
    invalidates: ['/api/ical-tokens'],
    onSuccess: () => {
      toast({ title: 'Subscription revoked', description: 'That URL no longer works.', variant: 'success' });
      refresh();
    },
    onError: (message) => toast({ title: 'Could not revoke the subscription', description: message, variant: 'error' }),
  });

  async function copy(url: string, label: string) {
    const copied = await copyText(url);
    toast(
      copied
        ? { title: `${label} copied`, variant: 'success' }
        : { title: 'Copying is not available', description: 'Select the URL and copy it by hand.', variant: 'error' },
    );
  }

  return (
    <>
      <SettingsGroup
        title="Calendar subscriptions"
        footer="A subscription is read-only: the other app pulls from TaskTick and can never write back. Revoke a URL here if it was shared by mistake."
      >
        {tokens.isInitialLoading ? (
          <div className="px-4 py-3">
            <Skeleton variant="rect" className="h-10" />
          </div>
        ) : list.length === 0 ? (
          <ListRow title="No subscriptions yet" subtitle="Create one to publish a read-only feed." disabled />
        ) : (
          list.map((token) => (
            <div key={token.id} className="hairline-t px-4 py-3 first:border-t-0">
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-ios bg-tint-soft text-tint">
                  <Link2 className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body text-label">{token.name || 'Calendar feed'}</p>
                  <p className="text-footnote text-secondary">
                    {[token.includeTasks ? 'tasks' : null, token.includeEvents ? 'events' : null].filter(Boolean).join(' and ') ||
                      'tasks'}
                    {token.lastUsedAtMs ? ' · used recently' : ' · never used yet'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="plain"
                  icon={Trash2}
                  aria-label={`Revoke ${token.name || 'calendar feed'}`}
                  onClick={() => setRevokeTarget(token)}
                >
                  Revoke
                </Button>
              </div>

              {token.url ? (
                <div className="pt-2">
                  <p className="overflow-wrap-anywhere break-all rounded-ios-md bg-inset px-3 py-2 font-mono text-caption-1 text-secondary">
                    {token.url}
                  </p>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button size="sm" variant="tinted" icon={Copy} onClick={() => void copy(token.url!, 'Subscription URL')}>
                      Copy URL
                    </Button>
                    <Button size="sm" variant="gray" icon={CalendarPlus} onClick={() => void copy(toWebcal(token.url!), 'webcal:// URL')}>
                      Copy for Apple Calendar
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="pt-2 text-footnote text-secondary">
                  This subscription was already used, so its link is no longer shown. Create a new one if you need the URL
                  again.
                </p>
              )}
            </div>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup
        title="New subscription"
        footer="How to add it — Apple Calendar: File ▸ New Calendar Subscription, or on iOS Settings ▸ Calendar ▸ Accounts ▸ Add Account ▸ Other ▸ Add Subscribed Calendar. Google Calendar: Other calendars ▸ From URL."
      >
        <div className="space-y-3 px-4 py-3">
          <TextField
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Phone calendar"
            maxLength={120}
            autoComplete="off"
          />
          <Switch label="Include tasks" checked={includeTasks} onCheckedChange={setIncludeTasks} />
          <Switch label="Include calendar events" checked={includeEvents} onCheckedChange={setIncludeEvents} />
          <Button
            fullWidth
            icon={Plus}
            loading={create.isPending}
            disabled={!includeTasks && !includeEvents}
            onClick={() => void create.run()}
          >
            Create subscription
          </Button>
          {!includeTasks && !includeEvents ? (
            <p className="text-footnote text-danger">Choose at least one thing to publish.</p>
          ) : null}
        </div>
      </SettingsGroup>

      {freshUrl ? (
        <div className="grouped mx-4 mt-4 p-4">
          <p className="text-subhead font-semibold text-label">Your new subscription URL</p>
          <p className="break-all pt-1 font-mono text-caption-1 text-secondary">{freshUrl}</p>
          <div className="flex flex-wrap gap-2 pt-3">
            <Button size="sm" icon={Copy} onClick={() => void copy(freshUrl, 'Subscription URL')}>
              Copy URL
            </Button>
            <Button size="sm" variant="gray" icon={CalendarPlus} onClick={() => void copy(toWebcal(freshUrl), 'webcal:// URL')}>
              Copy for Apple Calendar
            </Button>
          </div>
          <p className="pt-2 text-caption-1 text-tertiary">
            Copy it now — it is shown in full only once, and anyone holding it can read your feed.
          </p>
        </div>
      ) : null}

      <ConfirmDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
        title="Revoke this subscription?"
        message="The URL stops working immediately. Any calendar app that uses it will stop updating."
        confirmLabel="Revoke"
        destructive
        onConfirm={() => {
          if (revokeTarget) void revoke.run(revokeTarget);
          setRevokeTarget(null);
        }}
      />
    </>
  );
}
