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
 *
 * ## One section, not two
 *
 * This used to be two sibling cards — a "Calendar subscriptions" list and a
 * separate "New subscription" form — that were really two halves of one job.
 * Reading them apart, the empty state told you to "create one" and then the
 * creation form lived in a different card below, as if it were another feature.
 * They are now one `SettingsGroup`: the existing feeds sit at the top and the
 * form to add another follows in the same card (divided by the group's own row
 * hairlines), with the freshly minted URL appearing there too. Nothing about the
 * outward behaviour changes — same endpoints, same copy buttons, same revoke
 * confirmation — only the surface they are grouped under.
 *
 * The freshly minted URL renders as one more row in the group rather than a
 * bespoke paper: it is a caption and a one-time warning, which is exactly what
 * the group already is, so it lines up with the rows above it.
 */
import { useState } from 'react';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { ClipboardCopyIcon } from '@svg-animated-icons/react/clipboard-copy';
import { Link1Icon } from '@svg-animated-icons/react/link-1';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { copyText, toWebcal } from './clipboard';
import { MONO_URL_BOX_CLASS } from './styles';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
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
        footer="A subscription is read-only: the other app pulls from TaskTick and can never write back. Revoke a URL here if it was shared by mistake. To add one — Apple Calendar: File ▸ New Calendar Subscription, or on iOS Settings ▸ Calendar ▸ Accounts ▸ Add Account ▸ Other ▸ Add Subscribed Calendar. Google Calendar: Other calendars ▸ From URL."
      >
        {tokens.isInitialLoading ? (
          <SettingsRow>
            <Skeleton className="h-10 w-full" />
          </SettingsRow>
        ) : list.length === 0 ? (
          <SettingsRow>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">No subscriptions yet</span>
              <span className="block text-xs text-muted-foreground">Create one to publish a read-only feed.</span>
            </span>
          </SettingsRow>
        ) : (
          list.map((token) => (
            <SettingsRow key={token.id} stacked>
              <div className="flex items-center gap-3">
                <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                  <Link1Icon />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{token.name || 'Calendar feed'}</p>
                  <p className="text-xs text-muted-foreground">
                    {[token.includeTasks ? 'tasks' : null, token.includeEvents ? 'events' : null].filter(Boolean).join(' and ') ||
                      'tasks'}
                    {token.lastUsedAtMs ? ' · used recently' : ' · never used yet'}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-destructive"
                  aria-label={`Revoke ${token.name || 'calendar feed'}`}
                  onClick={() => setRevokeTarget(token)}
                >
                  <TrashIcon />
                  Revoke
                </Button>
              </div>

              {token.url ? (
                <div className="flex flex-col gap-2 sm:pl-11">
                  <p className={MONO_URL_BOX_CLASS}>{token.url}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => void copy(token.url!, 'Subscription URL')}
                    >
                      <ClipboardCopyIcon />
                      Copy URL
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void copy(toWebcal(token.url!), 'webcal:// URL')}
                    >
                      <CalendarIcon />
                      Copy for Apple Calendar
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground sm:pl-11">
                  This subscription was already used, so its link is no longer shown. Create a new one if you need the URL
                  again.
                </p>
              )}
            </SettingsRow>
          ))
        )}

        {/*
         * The add half of the same job. It used to be its own card; keeping it as
         * a row of this group is what makes "the feeds I have" and "make another"
         * read as one section.
         */}
        <SettingsRow stacked>
          <h3 className="text-sm font-medium">New subscription</h3>

          <Label htmlFor="ical-name">Name</Label>
          <Input
            id="ical-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Phone calendar"
            autoComplete="off"
            maxLength={120}
          />

          <div className="flex items-center gap-3">
            <Label htmlFor="ical-tasks" className="min-w-0 flex-1">
              Include tasks
            </Label>
            <Switch
              id="ical-tasks"
              aria-label="Include tasks"
              checked={includeTasks}
              onCheckedChange={setIncludeTasks}
            />
          </div>

          <div className="flex items-center gap-3">
            <Label htmlFor="ical-events" className="min-w-0 flex-1">
              Include calendar events
            </Label>
            <Switch
              id="ical-events"
              aria-label="Include calendar events"
              checked={includeEvents}
              onCheckedChange={setIncludeEvents}
            />
          </div>

          <Button
            className="w-full"
            aria-busy={create.isPending || undefined}
            disabled={create.isPending || (!includeTasks && !includeEvents)}
            onClick={() => void create.run()}
          >
            <PlusIcon />
            Create subscription
          </Button>

          {!includeTasks && !includeEvents ? (
            <p className="text-xs text-destructive">Choose at least one thing to publish.</p>
          ) : null}
        </SettingsRow>

        {freshUrl ? (
          <SettingsRow stacked>
            <h3 className="text-sm font-medium">Your new subscription URL</h3>
            <p className={MONO_URL_BOX_CLASS}>{freshUrl}</p>
            <p className="text-xs text-muted-foreground">
              Copy it now — it is shown in full only once, and anyone holding it can read your feed.
            </p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => void copy(freshUrl, 'Subscription URL')}>
                <ClipboardCopyIcon />
                Copy URL
              </Button>
              <Button size="sm" variant="ghost" onClick={() => void copy(toWebcal(freshUrl), 'webcal:// URL')}>
                <CalendarIcon />
                Copy for Apple Calendar
              </Button>
            </div>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <Dialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke this subscription?</DialogTitle>
            <DialogDescription>
              The URL stops working immediately. Any calendar app that uses it will stop updating.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRevokeTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (revokeTarget) void revoke.run(revokeTarget);
                setRevokeTarget(null);
              }}
            >
              Revoke
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
