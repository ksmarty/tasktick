'use client';

import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';
import ShareIcon from '@mui/icons-material/Share';
import { isIosSafari, isStandalone } from './platform';

/**
 * The iOS install story, spelled out.
 *
 * iOS Safari never fires `beforeinstallprompt` — there is no install API at all
 * — so the only thing a page can do is point at Safari's own Share sheet. This
 * renders `null` everywhere except a non-installed iOS Safari, which is also
 * exactly the case where Web Push is unavailable on iOS.
 *
 * `className` is still forwarded for the settings screen that composes it with
 * its own layout; new callers should pass `sx` instead.
 */
export function IosInstallHint({ className, sx }: { className?: string; sx?: SxProps<Theme> }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const displayStandalone = window.matchMedia('(display-mode: standalone)').matches;
    setVisible(
      isIosSafari(nav.userAgent, nav.maxTouchPoints) &&
        !isStandalone(nav.standalone === true, displayStandalone),
    );
  }, []);

  if (!visible) return null;

  return (
    <Stack
      className={className}
      direction="row"
      spacing={1.5}
      sx={[{ alignItems: 'flex-start' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <Box
        sx={{
          display: 'grid',
          placeItems: 'center',
          width: 36,
          height: 36,
          flexShrink: 0,
          mt: 0.25,
          borderRadius: 2,
          bgcolor: 'action.hover',
          color: 'primary.main',
        }}
      >
        <ShareIcon aria-hidden />
      </Box>
      <Stack spacing={0.5} sx={{ minWidth: 0 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Install TaskTick
        </Typography>
        <Typography variant="body2" component="p" color="text.secondary">
          Tap the{' '}
          <ShareIcon aria-hidden sx={{ fontSize: 16, verticalAlign: 'text-bottom' }} /> Share button in
          Safari&rsquo;s toolbar, then choose{' '}
          <Box component="span" sx={{ fontWeight: 600, color: 'text.primary' }}>
            Add to Home Screen
          </Box>
          .
        </Typography>
        <Typography variant="caption" color="text.disabled">
          Notifications on iPhone and iPad only work after TaskTick is on your Home Screen (iOS 16.4 or later).
        </Typography>
      </Stack>
    </Stack>
  );
}
