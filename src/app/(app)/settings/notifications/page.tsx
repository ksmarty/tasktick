'use client';

/**
 * Notification settings.
 */
import Link from 'next/link';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { PageHeader } from '@/components/app/PageHeader';
import { useResource } from '@/lib/store';
import { NotificationSettings } from '@/components/settings/NotificationSettings';
import { SettingsGroup } from '@/components/settings/SettingsGroup';
import type { SettingsPayload } from '@/lib/view-types';

export default function NotificationSettingsPage() {
  const settings = useResource<SettingsPayload>('/api/settings');

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Notifications"
        leading={
          <IconButton component={Link} href="/settings" aria-label="Back to Settings" edge="start">
            <ArrowBackIcon aria-hidden />
          </IconButton>
        }
      />

      {!settings.data ? (
        <Stack spacing={2} sx={{ px: 2, pt: 1 }}>
          <Skeleton variant="rounded" height={160} />
          <Skeleton variant="rounded" height={96} />
        </Stack>
      ) : (
        <>
          <NotificationSettings payload={settings.data} onChanged={() => void settings.refresh()} />
          <SettingsGroup
            title="What gets sent"
            footer="Reminders are scheduled from each task's own due date and time. Notifications never include your task notes."
          >
            <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
              <ListItemText
                disableTypography
                primary={<Box sx={{ typography: 'body1' }}>Task reminders</Box>}
                secondary={
                  <Box sx={{ typography: 'caption', color: 'text.secondary', pt: 0.5 }}>
                    {settings.data.settings.notificationsEnabled
                      ? 'On: due tasks and reminders are pushed to your registered devices.'
                      : 'Off: nothing is pushed, but reminders still appear in the app.'}
                  </Box>
                }
              />
            </ListItem>
          </SettingsGroup>
        </>
      )}
    </Box>
  );
}
