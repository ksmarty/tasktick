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
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import ListItem from '@mui/material/ListItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import CloudIcon from '@mui/icons-material/Cloud';
import CloudDownloadIcon from '@mui/icons-material/CloudDownload';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SyncIcon from '@mui/icons-material/Sync';
import { useToast } from '@/components/app/Toast';
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

/** The chip tone the old badge used, on MUI's palette. */
function statusChipColor(tone: 'default' | 'tint' | 'danger'): 'default' | 'primary' | 'error' {
  if (tone === 'tint') return 'primary';
  if (tone === 'danger') return 'error';
  return 'default';
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
    <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: 36,
            height: 36,
            flexShrink: 0,
            borderRadius: 1,
            bgcolor: 'action.hover',
            color: 'primary.main',
          }}
        >
          <CloudIcon fontSize="small" />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography variant="body1" sx={{ fontWeight: 500 }} noWrap>
            {account.name}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
            {account.username} · {account.serverUrl}
          </Typography>
        </Box>
        <Chip size="small" color={statusChipColor(syncStatusTone(account))} label={syncStatusWord(account)} />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1 }}>
        {syncStatusLabel(account)}
      </Typography>
      {advice ? (
        <Typography variant="caption" color="error.main" sx={{ display: 'block', pt: 0.5 }}>
          {advice}
        </Typography>
      ) : null}
      {!advice && account.consecutiveFailures > 0 ? (
        <Typography variant="caption" color="warning.main" sx={{ display: 'block', pt: 0.5 }}>
          {account.consecutiveFailures} failed {account.consecutiveFailures === 1 ? 'attempt' : 'attempts'} in a row.
        </Typography>
      ) : null}

      <Box sx={{ pt: 1 }}>
        <FormControlLabel
          sx={{ m: 0, display: 'flex', width: '100%', justifyContent: 'space-between' }}
          labelPlacement="start"
          label={account.enabled ? 'Sync enabled' : 'Sync paused'}
          control={
            <Switch
              size="small"
              checked={account.enabled}
              disabled={busy}
              onChange={(_event, next) => void toggle.run(next)}
              slotProps={{ input: { 'aria-label': `Sync ${account.name}` } }}
            />
          }
        />
      </Box>

      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, pt: 1 }}>
        <Button
          size="small"
          variant="outlined"
          startIcon={<CloudDownloadIcon aria-hidden />}
          loading={discover.isPending}
          disabled={busy}
          onClick={() => void discover.run()}
        >
          Discover
        </Button>
        <Button
          size="small"
          variant="outlined"
          startIcon={<SyncIcon aria-hidden />}
          loading={sync.isPending}
          disabled={busy}
          onClick={() => void sync.run()}
        >
          Sync now
        </Button>
        <Button
          size="small"
          variant="text"
          color="inherit"
          startIcon={<EditIcon aria-hidden />}
          disabled={busy}
          onClick={onEdit}
        >
          Edit
        </Button>
        <Button
          size="small"
          variant="text"
          color="error"
          startIcon={<DeleteIcon aria-hidden />}
          disabled={busy}
          onClick={() => setRemoveOpen(true)}
        >
          Remove
        </Button>
      </Stack>

      <Dialog open={removeOpen} onClose={() => setRemoveOpen(false)}>
        <DialogTitle>{`Remove ${account.name}?`}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Choose whether the events already synced from this account stay on this server.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
          <Button variant="text" onClick={() => setRemoveOpen(false)}>
            Cancel
          </Button>
          <Button
            variant="outlined"
            onClick={() => {
              setRemoveOpen(false);
              void remove.run(false);
            }}
          >
            Remove and keep events
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              setRemoveOpen(false);
              void remove.run(true);
            }}
          >
            Remove and delete synced events
          </Button>
        </DialogActions>
      </Dialog>
    </ListItem>
  );
}
