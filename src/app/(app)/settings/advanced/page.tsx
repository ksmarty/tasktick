'use client';

/**
 * Focus defaults, data export, and what this instance can do.
 *
 * The capability list is not decoration: it is how a self-hoster finds out
 * whether push and OIDC are wired up without reading the boot log.
 */
import Link from 'next/link';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { PageHeader } from '@/components/app/PageHeader';
import { useResource } from '@/lib/store';
import { DataExportCard } from '@/components/settings/DataExportCard';
import { FocusSettings } from '@/components/settings/FocusSettings';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import type { BootstrapPayload } from '@/lib/view-types';

export default function AdvancedSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Advanced"
        leading={
          <IconButton component={Link} href="/settings" aria-label="Back to Settings" edge="start">
            <ArrowBackIcon />
          </IconButton>
        }
      />

      {!bootstrap.data ? (
        <Stack spacing={2} sx={{ px: 2, pt: 1 }}>
          <Skeleton variant="rounded" height={160} />
          <Skeleton variant="rounded" height={96} />
        </Stack>
      ) : (
        <>
          <FocusSettings settings={bootstrap.data.settings} />
          <DataExportCard />

          <SettingsGroup title="This instance" footer="Read-only facts about the server you are connected to.">
            <CapabilityRow
              title="Push notifications"
              subtitle={bootstrap.data.capabilities.push ? 'Configured (VAPID keys present)' : 'Not configured'}
              on={bootstrap.data.capabilities.push}
            />
            <CapabilityRow
              title="Single sign-on"
              subtitle={bootstrap.data.capabilities.oidc ? 'OIDC provider configured' : 'Email and password only'}
              on={bootstrap.data.capabilities.oidc}
            />
            <ListItem>
              <ListItemText primary="Time zone" secondary={bootstrap.data.settings.timezone} />
            </ListItem>
            <ListItem>
              <ListItemText
                primary="Week starts on"
                secondary={bootstrap.data.settings.weekStartsOn === 0 ? 'Sunday' : 'Monday'}
              />
            </ListItem>
          </SettingsGroup>
        </>
      )}
    </Box>
  );
}

/** A read-only fact with an on/off dot: green when configured, grey when not. */
function CapabilityRow({ title, subtitle, on }: { title: string; subtitle: string; on: boolean }) {
  return (
    <ListItem>
      <ListItemText primary={title} secondary={subtitle} />
      <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexShrink: 0 }}>
        <Box
          aria-hidden
          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: on ? 'success.main' : 'action.disabled' }}
        />
        <Typography variant="caption" color="text.secondary">
          {on ? 'On' : 'Off'}
        </Typography>
      </Stack>
    </ListItem>
  );
}
