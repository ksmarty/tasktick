'use client';

/**
 * One CalDAV account: its state, its last run, and the four things you can do
 * with it (discover, sync now, edit, remove).
 *
 * Sync results are reported as counters, because "it worked" is not useful when
 * what a user wants to know is whether their phone's new event arrived. A failed
 * run shows advice rather than the raw server text — see `./caldav`.
 *
 * The removal choice — keep the synced events or delete them with the account —
 * is a real decision with no safe default, so it stays a dialog with both options
 * spelled out rather than a confirm/cancel pair.
 *
 * The state badge is a shadcn `Badge`: `tint` is the plain primary pill, `danger`
 * is the destructive one, and the resting state is `secondary` so a healthy
 * account is quiet rather than loud.
 */
import { useState } from 'react';
import { DownloadIcon } from '@svg-animated-icons/react/download';
import { Pencil1Icon } from '@svg-animated-icons/react/pencil-1';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { ServerIcon } from '@svg-animated-icons/react/server';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { caldavErrorMessage, syncStatusLabel, syncStatusTone, syncStatusWord } from './caldav';
import { SettingsRow } from './SettingsGroup';
import type { CaldavAccount } from '@/lib/types';
import type { SyncRunPayload } from '@/lib/view-types';

export interface CalDavAccountRowProps {
  account: CaldavAccount;
  onEdit: () => void;
  onChanged?: () => void;
}

/** `Pulled 12 · pushed 3 · conflicts 0`, skipping the zeroes. */
export function syncResultSummary(result: SyncRunPayload): string {
  const parts: string[] = [];
  if (result.pulled) parts.push(`${result.pulled} pulled`);
  if (result.pushed) parts.push(`${result.pushed} pushed`);
  if (result.deletedLocal) parts.push(`${result.deletedLocal} removed locally`);
  if (result.deletedRemote) parts.push(`${result.deletedRemote} removed remotely`);
  if (result.conflicts) parts.push(`${result.conflicts} conflicts`);
  if (result.calendars?.length) parts.push(`${result.calendars.length} calendars found`);
  return parts.length > 0 ? parts.join(' · ') : 'Nothing changed.';
}

/** The chip tone the old badge used, on the shadcn `Badge` variants. */
function statusBadgeVariant(tone: 'default' | 'tint' | 'danger'): 'secondary' | 'default' | 'destructive' {
  if (tone === 'tint') return 'default';
  if (tone === 'danger') return 'destructive';
  return 'secondary';
}

export function CalDavAccountRow({ account, onEdit, onChanged }: CalDavAccountRowProps) {
  const { toast } = useToast();
  const [removeOpen, setRemoveOpen] = useState(false);

  const advice = caldavErrorMessage(account.lastError, account.serverUrl);

  const discover = useMutation(async () => api.post<SyncRunPayload>(`/api/caldav/accounts/${account.id}/discover`), {
    invalidates: ['/api/caldav/accounts', '/api/calendars', '/api/bootstrap'],
    onSuccess: (result) => {
      if (!result) return;
      report(result, 'Discovery');
      onChanged?.();
    },
  });

  const sync = useMutation(
    async () => api.post<SyncRunPayload>(`/api/caldav/accounts/${account.id}/sync`, { kind: 'incremental' }),
    {
      invalidates: ['/api/caldav/accounts', '/api/calendars', '/api/tasks', '/api/calendar/items'],
      onSuccess: (result) => {
        if (!result) return;
        report(result, 'Sync');
        onChanged?.();
      },
    },
  );

  const toggle = useMutation(
    async (enabled: boolean) => api.patch<CaldavAccount>(`/api/caldav/accounts/${account.id}`, { enabled }),
    {
      invalidates: ['/api/caldav/accounts', '/api/bootstrap'],
      onSuccess: (_result, [enabled]) => {
        toast({ title: enabled ? `${account.name} enabled` : `${account.name} disabled`, variant: 'success' });
        onChanged?.();
      },
      onError: (message) => toast({ title: 'Could not change that account', description: message, variant: 'error' }),
    },
  );

  const remove = useMutation(
    async (purgeData: boolean) =>
      api.delete<{ deleted: boolean; purged: boolean }>(
        `/api/caldav/accounts/${account.id}`,
        purgeData ? { purge: 1 } : undefined,
      ),
    {
      invalidates: ['/api/caldav/accounts', '/api/calendars', '/api/bootstrap'],
      onSuccess: (_result, [purgeData]) => {
        toast({
          title: `${account.name} removed`,
          description: purgeData ? 'Its synced events were deleted too.' : 'Its synced events were kept.',
          variant: 'success',
        });
        onChanged?.();
      },
      onError: (message) => toast({ title: 'Could not remove that account', description: message, variant: 'error' }),
    },
  );

  function report(result: SyncRunPayload, label: string) {
    const failed = result.status === 'error' || Boolean(result.error);
    toast({
      title: failed ? `${label} failed` : `${label} finished`,
      description: failed
        ? caldavErrorMessage(result.error ?? 'Unknown error', account.serverUrl) ?? 'Unknown error'
        : syncResultSummary(result),
      variant: failed ? 'error' : 'success',
    });
  }

  const busy = discover.isPending || sync.isPending || remove.isPending;

  return (
    <SettingsRow stacked>
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
          <ServerIcon />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{account.name}</p>
          <p className="truncate text-xs text-muted-foreground">
            {account.username} · {account.serverUrl}
          </p>
        </div>
        <Badge variant={statusBadgeVariant(syncStatusTone(account))}>{syncStatusWord(account)}</Badge>
      </div>

      <p className="text-xs text-muted-foreground">{syncStatusLabel(account)}</p>
      {advice ? (
        <p className="text-xs text-destructive">{advice}</p>
      ) : null}
      {!advice && account.consecutiveFailures > 0 ? (
        <p className="text-xs text-muted-foreground">
          {account.consecutiveFailures} failed {account.consecutiveFailures === 1 ? 'attempt' : 'attempts'} in a row.
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <Label htmlFor={`caldav-sync-${account.id}`} className="min-w-0 flex-1">
          {account.enabled ? 'Sync enabled' : 'Sync paused'}
        </Label>
        <Switch
          id={`caldav-sync-${account.id}`}
          aria-label={`Sync ${account.name}`}
          checked={account.enabled}
          disabled={busy}
          onCheckedChange={(next) => void toggle.run(next)}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          aria-busy={discover.isPending || undefined}
          disabled={busy}
          onClick={() => void discover.run()}
        >
          <DownloadIcon />
          Discover
        </Button>
        <Button
          size="sm"
          variant="outline"
          aria-busy={sync.isPending || undefined}
          disabled={busy}
          onClick={() => void sync.run()}
        >
          <ReloadIcon />
          Sync now
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onEdit}>
          <Pencil1Icon />
          Edit
        </Button>
        <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => setRemoveOpen(true)}>
          <TrashIcon />
          Remove
        </Button>
      </div>

      <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Remove ${account.name}?`}</DialogTitle>
            <DialogDescription>
              Choose whether the events already synced from this account stay on this server.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setRemoveOpen(false);
                void remove.run(false);
              }}
            >
              Remove and keep events
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setRemoveOpen(false);
                void remove.run(true);
              }}
            >
              Remove and delete synced events
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsRow>
  );
}
