'use client';

/**
 * Subscribing to a remote iCal feed.
 *
 * This is the inbound direction, and it is the opposite of the card next to it:
 * `IcalSubscriptionCard` *publishes* a feed that other calendar apps pull from
 * TaskTick, while this one *pulls* somebody else's feed into TaskTick. Both are
 * "subscriptions" and the words are easy to mix up, so the copy here says which
 * way the data flows.
 *
 * Three things shape the screen:
 *
 *   1. **The first fetch happens on add, not later.** A URL that 404s, points at
 *      a private address, or is not a calendar says so while the user is still
 *      looking at the form — the alternative is a calendar that appears to work
 *      and is silently empty forever.
 *   2. **The feed decides the name.** A subscription named "Untitled" in a list of
 *      six is useless, so the name is optional and the feed's own `X-WR-CALNAME`
 *      is preferred when present.
 *   3. **Read-only is stated, not implied.** Nothing is ever written back to a
 *      feed, so the row says so rather than leaving the user to discover it when
 *      an edit does not stick.
 *
 * A feed that has been failing shows *why*, because "no events" and "the remote
 * has been down for two days" look identical otherwise.
 */
import { useCallback, useEffect, useState } from 'react';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { Link1Icon } from '@svg-animated-icons/react/link-1';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { api, errorMessage } from '@/lib/api-client';
import { useToast } from '@/components/app/Toast';
import type { Calendar } from '@/lib/types';

interface Payload {
  subscriptions: Calendar[];
}

/** "3 hours ago" — a timestamp is not what a reader wants to know here. */
function sinceLabel(ms: number | null): string {
  if (!ms) return 'Never refreshed';
  const seconds = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (seconds < 60) return 'Refreshed just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Refreshed ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Refreshed ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `Refreshed ${days} day${days === 1 ? '' : 's'} ago`;
}

export function IcalSubscribeSection({ onChanged }: { onChanged?: () => void }) {
  const { toast } = useToast();
  const [subs, setSubs] = useState<Calendar[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.get<Payload>('/api/ical/subscriptions');
      setSubs(data.subscriptions);
    } catch (error) {
      toast({ title: 'Could not load subscriptions', description: errorMessage(error), variant: 'error' });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit() {
    if (!url.trim() || busy) return;
    setBusy('add');
    setFormError(null);
    try {
      const result = await api.post<{ calendar: Calendar; imported: number }>('/api/ical/subscriptions', {
        url: url.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
      });
      setUrl('');
      setName('');
      setAdding(false);
      toast({
        title: 'Subscribed',
        description: `Imported ${result.imported} event${result.imported === 1 ? '' : 's'}.`,
        variant: 'success',
      });
      await load();
      onChanged?.();
    } catch (error) {
      // The server distinguishes a bad URL from a private address from an
      // unreachable host, and that distinction is the whole value of the message.
      setFormError(errorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  async function refresh(id: string) {
    setBusy(id);
    try {
      const result = await api.post<{ created: number; updated: number; deleted: number; error: string | null }>(
        `/api/ical/subscriptions/${id}/sync`,
        {},
      );
      if (result.error) {
        toast({ title: 'Could not refresh', description: result.error, variant: 'error' });
      } else {
        const total = result.created + result.updated + result.deleted;
        toast({
          title: 'Refreshed',
          description: total === 0 ? 'No changes.' : `${result.created} new, ${result.updated} updated, ${result.deleted} removed.`,
          variant: 'success',
        });
      }
      await load();
      onChanged?.();
    } catch (error) {
      toast({ title: 'Could not refresh', description: errorMessage(error), variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  async function remove(id: string, label: string) {
    setBusy(id);
    try {
      await api.delete(`/api/ical/subscriptions/${id}`);
      toast({ title: 'Unsubscribed', description: `${label} and its events were removed.`, variant: 'success' });
      await load();
      onChanged?.();
    } catch (error) {
      toast({ title: 'Could not unsubscribe', description: errorMessage(error), variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  return (
    <SettingsGroup
      title="Subscribed calendars"
      footer="Read-only. TaskTick pulls this feed on a schedule and never writes back to it."
      action={
        <Button type="button" size="sm" variant="ghost" onClick={() => setAdding((open) => !open)}>
          {adding ? 'Cancel' : 'Add feed'}
        </Button>
      }
    >
      {adding ? (
        <SettingsRow>
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium" htmlFor="ical-feed-url">
              Calendar URL
            </label>
            <Input
              id="ical-feed-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/calendar.ics"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(formError)}
              aria-describedby={formError ? 'ical-feed-error' : undefined}
            />
            <label className="text-sm font-medium" htmlFor="ical-feed-name">
              Name <span className="text-muted-foreground">(optional)</span>
            </label>
            <Input
              id="ical-feed-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Taken from the feed if left blank"
              autoComplete="off"
            />
            {formError ? (
              <p id="ical-feed-error" role="alert" className="text-sm text-destructive">
                {formError}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Any URL ending in <code>.ics</code>, including <code>webcal://</code> links.
              </p>
            )}
            <div>
              <Button type="button" onClick={submit} disabled={!url.trim() || busy === 'add'}>
                {busy === 'add' ? 'Checking…' : 'Subscribe'}
              </Button>
            </div>
          </div>
        </SettingsRow>
      ) : null}

      {loading ? (
        <SettingsRow>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </SettingsRow>
      ) : subs.length === 0 && !adding ? (
        <SettingsRow>
          <p className="text-sm text-muted-foreground">
            No subscribed calendars. Add one to mirror a feed somebody else publishes.
          </p>
        </SettingsRow>
      ) : (
        subs.map((calendar) => (
          <SettingsRow key={calendar.id}>
            <div className="flex items-start gap-3">
              <span aria-hidden className="mt-0.5 inline-flex text-lg text-muted-foreground">
                <CalendarIcon />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{calendar.name}</p>
                <p className="truncate text-xs text-muted-foreground" title={calendar.remoteHref ?? ''}>
                  {calendar.remoteHref}
                </p>
                {calendar.lastSyncError ? (
                  // Being explicit matters: "no events" and "the remote has been
                  // down for two days" look identical without this.
                  <p role="status" className="text-xs text-destructive">
                    {calendar.lastSyncError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">{sinceLabel(calendar.lastSyncedAtMs)}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Refresh ${calendar.name}`}
                  disabled={busy === calendar.id}
                  onClick={() => refresh(calendar.id)}
                >
                  <ReloadIcon />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  aria-label={`Unsubscribe from ${calendar.name}`}
                  disabled={busy === calendar.id}
                  onClick={() => remove(calendar.id, calendar.name)}
                >
                  <TrashIcon />
                </Button>
              </div>
            </div>
          </SettingsRow>
        ))
      )}

      {!adding && subs.length > 0 ? (
        <SettingsRow>
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link1Icon aria-hidden /> Feeds refresh hourly; use refresh to pull now.
          </p>
        </SettingsRow>
      ) : null}
    </SettingsGroup>
  );
}
