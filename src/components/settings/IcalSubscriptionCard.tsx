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
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import AddIcon from '@mui/icons-material/Add';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import { useToast } from '@/components/app/Toast';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { copyText, toWebcal } from './clipboard';
import { SettingsGroup } from './SettingsGroup';
import type { IcalTokenPayload } from '@/lib/view-types';

/** The box a subscription URL is shown in: monospace, selectable, wrapping. */
const URL_BOX = {
  p: 1.5,
  borderRadius: 1,
  bgcolor: 'action.hover',
  fontFamily: 'monospace',
  fontSize: 12,
  color: 'text.secondary',
  wordBreak: 'break-all',
} as const;

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
          <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
            <Skeleton variant="rounded" height={40} />
          </ListItem>
        ) : list.length === 0 ? (
          <ListItem>
            <ListItemText primary="No subscriptions yet" secondary="Create one to publish a read-only feed." />
          </ListItem>
        ) : (
          list.map((token) => (
            <ListItem key={token.id} sx={{ display: 'block', px: 2, py: 1.5 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <ListItemIcon sx={{ minWidth: 40 }}>
                  <Box
                    aria-hidden
                    sx={{
                      display: 'grid',
                      placeItems: 'center',
                      width: 32,
                      height: 32,
                      borderRadius: 1,
                      bgcolor: 'action.hover',
                      color: 'primary.main',
                    }}
                  >
                    <LinkIcon fontSize="small" />
                  </Box>
                </ListItemIcon>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                  <Typography variant="body1" noWrap>
                    {token.name || 'Calendar feed'}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    {[token.includeTasks ? 'tasks' : null, token.includeEvents ? 'events' : null].filter(Boolean).join(' and ') ||
                      'tasks'}
                    {token.lastUsedAtMs ? ' · used recently' : ' · never used yet'}
                  </Typography>
                </Box>
                <Button
                  size="small"
                  variant="text"
                  color="error"
                  startIcon={<DeleteIcon aria-hidden />}
                  aria-label={`Revoke ${token.name || 'calendar feed'}`}
                  onClick={() => setRevokeTarget(token)}
                >
                  Revoke
                </Button>
              </Box>

              {token.url ? (
                <Box sx={{ pt: 1.5, pl: 6.5 }}>
                  <Box sx={URL_BOX}>{token.url}</Box>
                  <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, pt: 1.5 }}>
                    <Button
                      size="small"
                      variant="outlined"
                      startIcon={<ContentCopyIcon aria-hidden />}
                      onClick={() => void copy(token.url!, 'Subscription URL')}
                    >
                      Copy URL
                    </Button>
                    <Button
                      size="small"
                      variant="text"
                      color="inherit"
                      startIcon={<CalendarMonthIcon aria-hidden />}
                      onClick={() => void copy(toWebcal(token.url!), 'webcal:// URL')}
                    >
                      Copy for Apple Calendar
                    </Button>
                  </Stack>
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1.5, pl: 6.5 }}>
                  This subscription was already used, so its link is no longer shown. Create a new one if you need the URL
                  again.
                </Typography>
              )}
            </ListItem>
          ))
        )}
      </SettingsGroup>

      <SettingsGroup
        title="New subscription"
        footer="How to add it — Apple Calendar: File ▸ New Calendar Subscription, or on iOS Settings ▸ Calendar ▸ Accounts ▸ Add Account ▸ Other ▸ Add Subscribed Calendar. Google Calendar: Other calendars ▸ From URL."
      >
        <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
          <Stack spacing={2}>
            <TextField
              fullWidth
              label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Phone calendar"
              autoComplete="off"
              slotProps={{ htmlInput: { maxLength: 120 } }}
            />
            <FormControlLabel
              sx={{ m: 0, display: 'flex', width: '100%', justifyContent: 'space-between' }}
              labelPlacement="start"
              label="Include tasks"
              control={
                <Switch
                  checked={includeTasks}
                  onChange={(_event, next) => setIncludeTasks(next)}
                  slotProps={{ input: { 'aria-label': 'Include tasks' } }}
                />
              }
            />
            <FormControlLabel
              sx={{ m: 0, display: 'flex', width: '100%', justifyContent: 'space-between' }}
              labelPlacement="start"
              label="Include calendar events"
              control={
                <Switch
                  checked={includeEvents}
                  onChange={(_event, next) => setIncludeEvents(next)}
                  slotProps={{ input: { 'aria-label': 'Include calendar events' } }}
                />
              }
            />
            <Button
              fullWidth
              variant="contained"
              startIcon={<AddIcon aria-hidden />}
              loading={create.isPending}
              disabled={!includeTasks && !includeEvents}
              onClick={() => void create.run()}
            >
              Create subscription
            </Button>
            {!includeTasks && !includeEvents ? (
              <Typography variant="caption" color="error.main">
                Choose at least one thing to publish.
              </Typography>
            ) : null}
          </Stack>
        </ListItem>
      </SettingsGroup>

      {freshUrl ? (
        <Paper variant="outlined" sx={{ borderRadius: 3, mx: 2, mt: 2, p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Your new subscription URL
          </Typography>
          <Box sx={{ ...URL_BOX, mt: 0.5 }}>{freshUrl}</Box>
          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1, pt: 1.5 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<ContentCopyIcon aria-hidden />}
              onClick={() => void copy(freshUrl, 'Subscription URL')}
            >
              Copy URL
            </Button>
            <Button
              size="small"
              variant="text"
              color="inherit"
              startIcon={<CalendarMonthIcon aria-hidden />}
              onClick={() => void copy(toWebcal(freshUrl), 'webcal:// URL')}
            >
              Copy for Apple Calendar
            </Button>
          </Stack>
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', pt: 1 }}>
            Copy it now — it is shown in full only once, and anyone holding it can read your feed.
          </Typography>
        </Paper>
      ) : null}

      <Dialog open={revokeTarget !== null} onClose={() => setRevokeTarget(null)}>
        <DialogTitle>Revoke this subscription?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            The URL stops working immediately. Any calendar app that uses it will stop updating.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRevokeTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (revokeTarget) void revoke.run(revokeTarget);
              setRevokeTarget(null);
            }}
          >
            Revoke
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
