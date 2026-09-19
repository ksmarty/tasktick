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
 * A subscription carries the user's colour choice — a palette token or a custom
 * `#rrggbb` in the calendar's `colorOverride` — and the row paints it from the
 * same `calendarColorHex` the calendar screen uses; there is no second colour
 * model here. Editing (name, colour, URL) and removal live on the row itself, so
 * neither is buried behind a detail screen. Removal deletes the mirrored events
 * too, and asks first because that cannot be undone.
 *
 * A feed that has been failing shows *why*, because "no events" and "the remote
 * has been down for two days" look identical otherwise.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link1Icon } from '@svg-animated-icons/react/link-1';
import { Pencil1Icon } from '@svg-animated-icons/react/pencil-1';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { IcalSubscriptionDialog } from './IcalSubscriptionDialog';
import { api, errorMessage } from '@/lib/api-client';
import { useToast } from '@/components/app/Toast';
import { calendarColorHex } from '@/components/calendar/colors';
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
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Calendar | null>(null);
  const [removeTarget, setRemoveTarget] = useState<Calendar | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

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

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(calendar: Calendar) {
    setEditing(calendar);
    setDialogOpen(true);
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
          description:
            total === 0
              ? 'No changes.'
              : `${result.created} new, ${result.updated} updated, ${result.deleted} removed.`,
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

  async function remove(calendar: Calendar) {
    setBusy(calendar.id);
    try {
      await api.delete(`/api/ical/subscriptions/${calendar.id}`);
      toast({
        title: 'Unsubscribed',
        description: `${calendar.name} and its events were removed.`,
        variant: 'success',
      });
      await load();
      onChanged?.();
    } catch (error) {
      toast({ title: 'Could not unsubscribe', description: errorMessage(error), variant: 'error' });
    } finally {
      setBusy(null);
    }
  }

  /** After a create or edit, refetch the list and let the caller refresh too. */
  async function handleSaved() {
    await load();
    onChanged?.();
  }

  return (
    <>
      <SettingsGroup
        title="Subscribed calendars"
        footer="Read-only. TaskTick pulls this feed on a schedule and never writes back to it."
        action={
          <Button type="button" size="sm" variant="ghost" onClick={openCreate}>
            <PlusIcon />
            Add feed
          </Button>
        }
      >
        {loading ? (
          <SettingsRow>
            <p className="text-sm text-muted-foreground">Loading…</p>
          </SettingsRow>
        ) : subs.length === 0 ? (
          <SettingsRow>
            <p className="text-sm text-muted-foreground">
              No subscribed calendars. Add one to mirror a feed somebody else publishes.
            </p>
          </SettingsRow>
        ) : (
          subs.map((calendar) => (
            <SettingsRow key={calendar.id}>
              {/*
                   * `min-w-0 flex-1` is load-bearing, not tidiness.
                   *
                   * `SettingsRow` is a flex container, so this div is a flex item
                   * and gets the default `min-width: auto` — it refuses to shrink
                   * below its content. A long feed URL therefore never truncated:
                   * it kept its full width and pushed the row's buttons past the
                   * card, clipping the last one off the screen. With `min-w-0`
                   * the truncation below actually takes effect.
                   */}
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                {/*
                 * The row's own colour, custom `#rrggbb` included: `calendarColorHex`
                 * is the same resolver the calendar screen paints with.
                 */}
                <span
                  aria-hidden
                  className="mt-1 inline-block size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: calendarColorHex(calendar) }}
                />
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
                    aria-label={`Edit ${calendar.name}`}
                    disabled={busy === calendar.id}
                    onClick={() => openEdit(calendar)}
                  >
                    <Pencil1Icon />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    aria-label={`Unsubscribe from ${calendar.name}`}
                    disabled={busy === calendar.id}
                    onClick={() => setRemoveTarget(calendar)}
                  >
                    <TrashIcon />
                  </Button>
                </div>
              </div>
            </SettingsRow>
          ))
        )}

        {!loading && subs.length > 0 ? (
          <SettingsRow>
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Link1Icon aria-hidden /> Feeds refresh hourly; use refresh to pull now.
            </p>
          </SettingsRow>
        ) : null}
      </SettingsGroup>

      <IcalSubscriptionDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditing(null);
        }}
        subscription={editing}
        onSaved={handleSaved}
      />

      {/*
       * Removal deletes the mirrored events, so it is confirmed rather than done
       * on the tap that opens it — the same shape the calendar editor uses.
       */}
      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Unsubscribe from ${removeTarget?.name ?? 'this feed'}?`}</DialogTitle>
            <DialogDescription>
              Its mirrored events are deleted too. This cannot be undone, but you can subscribe to the same URL
              again.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removeTarget) void remove(removeTarget);
                setRemoveTarget(null);
              }}
            >
              Unsubscribe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
