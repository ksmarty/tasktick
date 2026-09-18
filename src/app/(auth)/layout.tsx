import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import Paper from '@mui/material/Paper';

/**
 * Chrome-less layout for the signed-out screens.
 *
 * Centres a narrow card and insets for the Dynamic Island and home indicator, so
 * the sign-in form is usable on an iPhone in landscape as well as portrait.
 *
 * These screens render *before* the app shell exists, so this layout owns its own
 * full-height frame. The safe-area insets are read straight from
 * `env(safe-area-inset-*)`, which resolve to `0px` off-device.
 *
 * Deliberately no entrance animation: a transforming wrapper would become the
 * containing block for the app-global fixed PWA banners, and a client-only
 * animation library import here would break the server render of the route.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        pl: 'calc(env(safe-area-inset-left, 0px) + 1.25rem)',
        pr: 'calc(env(safe-area-inset-right, 0px) + 1.25rem)',
        pt: 'calc(env(safe-area-inset-top, 0px) + 2.5rem)',
        pb: 'calc(env(safe-area-inset-bottom, 0px) + 2.5rem)',
      }}
    >
      <Container maxWidth="xs" disableGutters sx={{ maxWidth: 400 }}>
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 3 }}>
          {children}
        </Paper>
      </Container>
    </Box>
  );
}
