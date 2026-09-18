'use client';

/**
 * Add or edit a CalDAV account.
 *
 * The password is write-only. The API never returns it, so the edit form must not
 * pretend it is there: the field is empty, its hint says "leave blank to keep the
 * current password", and an empty value is simply omitted from the PATCH body.
 * It is never logged, never put in a URL and never rendered back into an input.
 *
 * iCloud is called out explicitly because an iCloud account *will* fail with the
 * Apple Account password, and the fix (an app-specific password) is not
 * discoverable from the 401 the server receives. There is no link, deliberately:
 * the instruction is complete on its own and a deep link into Apple's account
 * pages rots quickly.
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import CloudIcon from '@mui/icons-material/Cloud';
import DnsIcon from '@mui/icons-material/Dns';
import KeyIcon from '@mui/icons-material/Key';
import MailIcon from '@mui/icons-material/Mail';
import PersonIcon from '@mui/icons-material/Person';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { CALDAV_HELP, caldavErrorMessage, isIcloudServer } from './caldav';
import type { CaldavAccount, SyncDirection } from '@/lib/types';

const INTERVAL_OPTIONS = [
  { value: '5', label: 'Every 5 minutes' },
  { value: '15', label: 'Every 15 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every hour' },
  { value: '240', label: 'Every 4 hours' },
  { value: '1440', label: 'Once a day' },
];

const DIRECTION_OPTIONS: { value: SyncDirection; label: string }[] = [
  { value: 'auto', label: 'Two-way' },
  { value: 'pull', label: 'Read only' },
  { value: 'push', label: 'Write only' },
];

export interface CalDavAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account being edited, or `null` to add one. */
  account?: CaldavAccount | null;
  onSaved?: () => void;
}

export function CalDavAccountSheet({ open, onOpenChange, account = null, onSaved }: CalDavAccountSheetProps) {
  const { toast } = useToast();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const editing = Boolean(account);

  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(30);
  const [direction, setDirection] = useState<SyncDirection>('auto');
  const [error, setError] = useState<string | null>(null);

  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    const key = account?.id ?? 'new';
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;

    setName(account?.name ?? '');
    setServerUrl(account?.serverUrl ?? 'https://caldav.icloud.com');
    setUsername(account?.username ?? '');
    setPassword('');
    setSyncIntervalMinutes(account?.syncIntervalMinutes ?? 30);
    setDirection(account?.direction ?? 'auto');
    setError(null);
  }, [account, open]);

  const save = useMutation(
    async () => {
      const trimmedUrl = serverUrl.trim();
      const trimmedName = name.trim();

      if (!trimmedName) throw new Error('Give the account a name.');
      if (!trimmedUrl) throw new Error('Enter the CalDAV server URL.');
      if (!username.trim()) throw new Error('Enter the username.');
      if (!editing && !password) throw new Error('Enter the password (or an app-specific password).');

      const body: Record<string, unknown> = {
        name: trimmedName,
        serverUrl: trimmedUrl,
        username: username.trim(),
        syncIntervalMinutes,
        direction,
      };
      // An empty password on an edit means "keep the current one" — the API never
      // sends it back, so there is nothing to prefill.
      if (password) body.password = password;

      return editing
        ? await api.patch<CaldavAccount>(`/api/caldav/accounts/${account?.id}`, body)
        : await api.post<CaldavAccount>('/api/caldav/accounts', body);
    },
    {
      invalidates: ['/api/caldav/accounts', '/api/calendars', '/api/bootstrap'],
      onSuccess: () => {
        toast({
          title: editing ? 'Account updated' : 'Account added',
          description: editing ? undefined : 'Run “Discover” on the account to fetch its calendars.',
          variant: 'success',
        });
        onSaved?.();
        onOpenChange(false);
      },
      onError: (message) => {
        // A rejected password is the one failure worth translating into advice.
        setError(caldavErrorMessage(message, serverUrl) ?? message);
      },
    },
  );

  const icloud = isIcloudServer(serverUrl);

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle>{editing ? 'Edit calendar account' : 'Add calendar account'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pb: 2 }}>
          <TextField
            fullWidth
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="iCloud"
            autoComplete="off"
            slotProps={{
              htmlInput: { maxLength: 200 },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <CloudIcon fontSize="small" aria-hidden />
                  </InputAdornment>
                ),
              },
            }}
          />

          <TextField
            fullWidth
            label="Server URL"
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="https://caldav.icloud.com"
            helperText={CALDAV_HELP.server}
            autoComplete="url"
            slotProps={{
              htmlInput: { inputMode: 'url', maxLength: 500 },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <DnsIcon fontSize="small" aria-hidden />
                  </InputAdornment>
                ),
              },
            }}
          />

          <TextField
            fullWidth
            label="Username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="you@example.com"
            helperText={icloud ? 'Your Apple Account email address.' : undefined}
            autoComplete="username"
            slotProps={{
              htmlInput: { maxLength: 320 },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <PersonIcon fontSize="small" aria-hidden />
                  </InputAdornment>
                ),
              },
            }}
          />

          <TextField
            fullWidth
            label="Password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={editing ? 'Leave blank to keep the current password' : 'App-specific password'}
            helperText={error ?? CALDAV_HELP.password}
            error={Boolean(error)}
            autoComplete="new-password"
            slotProps={{
              htmlInput: { maxLength: 500 },
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <KeyIcon fontSize="small" aria-hidden />
                  </InputAdornment>
                ),
              },
            }}
          />

          {icloud ? (
            <Box sx={{ borderRadius: 2, bgcolor: 'action.hover', px: 1.5, py: 1.25 }}>
              <Typography variant="caption">{CALDAV_HELP.icloud}</Typography>
            </Box>
          ) : null}

          <TextField
            select
            fullWidth
            label="Sync every"
            value={String(syncIntervalMinutes)}
            onChange={(event) => setSyncIntervalMinutes(Number.parseInt(event.target.value, 10) || 30)}
          >
            {INTERVAL_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <TextField
            select
            fullWidth
            label="Direction"
            value={direction}
            onChange={(event) => setDirection(event.target.value as SyncDirection)}
            helperText={`Two-way keeps both sides in step. Read only never writes back to ${icloud ? 'iCloud' : 'the server'}.`}
          >
            {DIRECTION_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>

          <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
            <MailIcon sx={{ fontSize: 14, mt: 0.25, flexShrink: 0, color: 'text.disabled' }} aria-hidden />
            <Typography variant="caption" color="text.disabled">
              TaskTick talks to the server directly. If your provider emails you about a new sign-in, that message is
              expected.
            </Typography>
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="contained" loading={save.isPending} onClick={() => void save.run()}>
          {editing ? 'Save account' : 'Add account'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
