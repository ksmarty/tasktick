'use client';

/**
 * Instance administration.
 *
 * Gated on the bootstrap user's `isAdmin`. A non-administrator does not get a
 * broken screen: they get told, and the admin-only endpoints would refuse them
 * anyway.
 */
import Link from 'next/link';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ShieldIcon from '@mui/icons-material/Shield';
import { PageHeader } from '@/components/app/PageHeader';
import { useResource } from '@/lib/store';
import { AdminUserTable } from '@/components/settings/AdminUserTable';
import { InviteManager } from '@/components/settings/InviteManager';
import type { BootstrapPayload } from '@/lib/view-types';

export default function AdminSettingsPage() {
  const bootstrap = useResource<BootstrapPayload>('/api/bootstrap');
  const user = bootstrap.data?.user;

  return (
    <Box sx={{ pb: 4 }}>
      <PageHeader
        title="Admin"
        leading={
          <IconButton component={Link} href="/settings" aria-label="Back to Settings" edge="start">
            <ArrowBackIcon />
          </IconButton>
        }
      />

      {!user ? (
        <Stack spacing={2} sx={{ px: 2, pt: 1 }}>
          <Skeleton variant="rounded" height={160} />
          <Skeleton variant="rounded" height={160} />
        </Stack>
      ) : !user.isAdmin ? (
        <Stack spacing={1} sx={{ alignItems: 'center', px: 3, py: 6, textAlign: 'center' }}>
          <Box
            aria-hidden
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 56,
              height: 56,
              mb: 1,
              borderRadius: '50%',
              bgcolor: 'action.hover',
              color: 'text.disabled',
            }}
          >
            <ShieldIcon />
          </Box>
          <Typography variant="h6" component="h2">
            Administrators only
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
            This account cannot manage the instance. Ask the person who set up TaskTick to promote you.
          </Typography>
        </Stack>
      ) : (
        <>
          <InviteManager />
          <AdminUserTable currentUserId={user.id} />
        </>
      )}
    </Box>
  );
}
