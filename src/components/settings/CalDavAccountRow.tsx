'use client';

/**
 * One CalDAV account: its state, its last run, and the four things you can do
 * with it (discover, sync now, edit, remove).
 *
 * Sync results are reported as counters, because "it worked" is not useful when
 * what a user wants to know is whether their phone's new event arrived. A failed
 * run shows advice rather than the raw server text — see `./caldav`.
 */
import { useState } from 'react';
import { Cloud, CloudDownload, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { ActionSheet, Badge, Button, Switch, useToast } from '@/components/ui';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { caldavErrorMessage, syncStatusLabel, syncStatusTone, syncStatusWord } from './caldav';
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
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-ios bg-tint-soft text-tint">
          <Cloud className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-label">{account.name}</p>
          <p className="truncate text-footnote text-secondary">
            {account.username} · {account.serverUrl}
          </p>
        </div>
        <Badge variant={syncStatusTone(account)}>{syncStatusWord(account)}</Badge>
      </div>

      <p className="pt-2 text-footnote text-secondary">{syncStatusLabel(account)}</p>
      {advice ? <p className="pt-1 text-footnote text-danger">{advice}</p> : null}
      {!advice && account.consecutiveFailures > 0 ? (
        <p className="pt-1 text-footnote text-warning">
          {account.consecutiveFailures} failed {account.consecutiveFailures === 1 ? 'attempt' : 'attempts'} in a row.
        </p>
      ) : null}

      <div className="pt-2">
        <Switch
          label={account.enabled ? 'Sync enabled' : 'Sync paused'}
          checked={account.enabled}
          size="sm"
          disabled={busy}
          onCheckedChange={(next) => void toggle.run(next)}
          aria-label={`Sync ${account.name}`}
        />
      </div>

      <div className="flex flex-wrap gap-2 pt-2">
        <Button size="sm" variant="tinted" icon={CloudDownload} loading={discover.isPending} disabled={busy} onClick={() => void discover.run()}>
          Discover
        </Button>
        <Button size="sm" variant="tinted" icon={RefreshCw} loading={sync.isPending} disabled={busy} onClick={() => void sync.run()}>
          Sync now
        </Button>
        <Button size="sm" variant="gray" icon={Pencil} disabled={busy} onClick={onEdit}>
          Edit
        </Button>
        <Button size="sm" variant="plain" icon={Trash2} disabled={busy} onClick={() => setRemoveOpen(true)}>
          Remove
        </Button>
      </div>

      <ActionSheet
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        title={`Remove ${account.name}?`}
        message="Choose whether the events already synced from this account stay on this server."
        actions={[
          {
            label: 'Remove and keep events',
            onSelect: () => void remove.run(false),
          },
          {
            label: 'Remove and delete synced events',
            destructive: true,
            onSelect: () => void remove.run(true),
          },
        ]}
      />
    </div>
  );
}
