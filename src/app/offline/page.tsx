import NextLink from 'next/link';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import RefreshIcon from '@mui/icons-material/Refresh';

export const metadata = { title: 'Offline' };
export const dynamic = 'force-static';

/**
 * The service worker's last-resort navigation fallback.
 *
 * Reached only when a navigation fails and neither the network nor the cached
 * app shell could answer. It is intentionally a static route with no data
 * dependencies so that it can be precached and always render — a fallback page
 * that itself needs the network is not a fallback. The service worker precaches
 * this document together with the assets it references, which is what keeps the
 * Material components below renderable with no connection.
 */
export default function OfflinePage() {
  return (
    <Box
      component="main"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2.5,
        minHeight: '100dvh',
        textAlign: 'center',
        bgcolor: 'background.default',
        pl: 'calc(env(safe-area-inset-left, 0px) + 2rem)',
        pr: 'calc(env(safe-area-inset-right, 0px) + 2rem)',
        pt: 'calc(env(safe-area-inset-top, 0px) + 3rem)',
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 3rem)',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 64,
          height: 64,
          borderRadius: 4,
          bgcolor: 'action.hover',
          color: 'text.secondary',
        }}
      >
        <CloudOffIcon sx={{ fontSize: 32 }} aria-hidden />
      </Box>

      <Stack spacing={1}>
        <Typography variant="h5" component="h1" sx={{ fontWeight: 600 }}>
          You are offline
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
          TaskTick could not reach the server. Anything you already loaded is still available, and your changes
          will sync once you are back online.
        </Typography>
      </Stack>

      {/*
        A plain anchor, not next/link: a client-side navigation would be handled by
        the router and could fail the same way this page was reached. A MUI
        `Button` with `href` renders an `<a>` and does exactly that.
      */}
      <Button
        href="/today"
        variant="contained"
        size="large"
        startIcon={<RefreshIcon aria-hidden />}
        sx={{ textTransform: 'none' }}
      >
        Try again
      </Button>

      <Link component={NextLink} href="/settings" variant="body2" color="text.secondary" underline="always">
        Go to settings
      </Link>
    </Box>
  );
}
