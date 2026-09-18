'use client';

/**
 * Invitations.
 *
 * Registration is invite-gated, so this is how anyone else gets in. The link is
 * returned in full exactly once — when the invite is created — which is why the
 * create response is rendered as its own card with a copy button and a plain
 * warning that it will not be shown again. Listing existing invites shows only
 * whether each one is still usable.
 *
 * The expiry choices were a row of buttons changing weight on selection; they are
 * a genuine either/or, so they are a `ToggleButtonGroup` now.
 */
import { useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import MailIcon from '@mui/icons-material/Mail';
import PersonAddIcon from '@mui/icons-material/PersonAdd';
import { useToast } from '@/components/app/Toast';
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
        <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
          <Stack spacing={3}>
            <TextField
              fullWidth
              label="Email address"
              type="email"
              autoComplete="email"
              placeholder="friend@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              slotProps={{
                htmlInput: { inputMode: 'email', maxLength: 320 },
                input: {
                  startAdornment: <MailIcon fontSize="small" aria-hidden sx={{ mr: 1, color: 'text.secondary' }} />,
                },
              }}
            />

            <FormControlLabel
              sx={{ m: 0, display: 'flex', width: '100%', justifyContent: 'space-between' }}
              labelPlacement="start"
              label="Make them an administrator"
              control={
                <Switch
                  checked={isAdmin}
                  onChange={(_event, checked) => setIsAdmin(checked)}
                  slotProps={{ input: { 'aria-label': 'Make them an administrator' } }}
                />
              }
            />

            <Box>
              <Typography variant="caption" color="text.secondary" id="invite-expiry-label" sx={{ display: 'block', px: 1, pb: 0.5 }}>
                Link expires in
              </Typography>
              <ToggleButtonGroup
                exclusive
                size="small"
                value={expiresInDays}
                onChange={(_event, value: string | null) => {
                  if (value) setExpiresInDays(value);
                }}
                aria-labelledby="invite-expiry-label"
              >
                {EXPIRY_OPTIONS.map((option) => (
                  <ToggleButton key={option.value} value={option.value}>
                    {option.label}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            <Button
              fullWidth
              variant="contained"
              startIcon={<PersonAddIcon aria-hidden />}
              loading={create.isPending}
              disabled={!email.trim()}
              onClick={() => void create.run()}
            >
              Create invitation
            </Button>
          </Stack>
        </ListItem>
      </SettingsGroup>

      {freshUrl ? (
        <Paper variant="outlined" sx={{ borderRadius: 3, mx: 2, mt: 2, p: 2 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
            Invitation link
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ pt: 0.5, fontFamily: 'monospace', wordBreak: 'break-all' }}
          >
            {freshUrl}
          </Typography>
          <Box sx={{ pt: 1.5 }}>
            <Button size="small" variant="contained" startIcon={<ContentCopyIcon aria-hidden />} onClick={() => void copy(freshUrl)}>
              Copy link
            </Button>
          </Box>
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', pt: 1 }}>
            Send this to them yourself — this server has no mail delivery, and the link is shown in full only once.
          </Typography>
        </Paper>
      ) : null}

      <SettingsGroup title="Invitations" footer="Accepted invitations are spent and cannot be reused.">
        {invites.isInitialLoading ? (
          <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
            <Skeleton variant="rounded" height={40} />
          </ListItem>
        ) : list.length === 0 ? (
          <ListItem>
            <ListItemText primary="No invitations yet" secondary="Invite someone above to get a link." />
          </ListItem>
        ) : (
          list.map((invite) => {
            const expired = invite.expiresAtMs < Date.now();
            const status = invite.acceptedAtMs
              ? 'accepted'
              : expired
                ? `expired ${relativeTimeAgo(invite.expiresAtMs)}`
                : `expires in ${Math.max(1, Math.round((invite.expiresAtMs - Date.now()) / 86_400_000))} days`;
            return (
              <ListItem
                key={invite.id}
                secondaryAction={
                  invite.url && !expired && !invite.acceptedAtMs ? (
                    <Button size="small" variant="text" startIcon={<ContentCopyIcon aria-hidden />} onClick={() => void copy(invite.url!)}>
                      Copy
                    </Button>
                  ) : undefined
                }
              >
                <ListItemText
                  primary={invite.email}
                  secondary={`${invite.isAdmin ? 'Administrator · ' : ''}${status}`}
                  slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                />
              </ListItem>
            );
          })
        )}
      </SettingsGroup>
    </>
  );
}
