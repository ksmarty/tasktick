'use client';

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import InstallMobileIcon from '@mui/icons-material/InstallMobile';
import { IosInstallHint } from './IosInstallHint';
import { INSTALL_DISMISS_STORAGE_KEY, isIosSafari, isStandalone } from './platform';

/**
 * The install affordance, in two shapes.
 *
 * Android/desktop: Chrome fires `beforeinstallprompt`; we keep the event and
 * call `prompt()` from the tap handler, which is the only moment the browser
 * allows the native install sheet to be opened.
 *
 * iOS Safari: that event never exists, so we show `IosInstallHint` instead.
 *
 * Dismissal is permanent and stored under a versioned key — an install banner
 * that comes back after being closed is the fastest way to make an app feel
 * like spam.
 *
 * The surface is a Material `Alert` in the floating slot the hand-rolled banner
 * used; the detection, dismissal and prompt logic is unchanged.
 */

/** `beforeinstallprompt` is still not in the DOM lib types. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [iosSafari, setIosSafari] = useState(false);
  const [installed, setInstalled] = useState(false);
  // Starts dismissed so the first paint (and hydration) never flashes a banner
  // that `useEffect` is about to remove.
  const [dismissed, setDismissed] = useState(true);

  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const displayStandalone = window.matchMedia('(display-mode: standalone)').matches;
    setIosSafari(isIosSafari(nav.userAgent, nav.maxTouchPoints));
    setInstalled(isStandalone(nav.standalone === true, displayStandalone));

    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(INSTALL_DISMISS_STORAGE_KEY);
    } catch {
      // Storage blocked (private mode / hardened settings): treat as dismissed
      // rather than nagging on every single page load.
      setDismissed(true);
    }
    setDismissed(stored === '1');

    const onBeforeInstallPrompt = (event: Event) => {
      // Suppressing the mini-infobar is what lets us show our own banner and
      // decide *when* to call prompt().
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(INSTALL_DISMISS_STORAGE_KEY, '1');
    } catch {
      /* nothing to persist to; the in-memory dismissal still applies */
    }
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    // The event is single-use; whether they accepted or not, it is spent.
    setDeferredPrompt(null);
    if (outcome === 'accepted') setInstalled(true);
  }, [deferredPrompt]);

  if (installed || dismissed) return null;
  if (!iosSafari && !deferredPrompt) return null;

  return (
    <Box
      role="complementary"
      aria-label="Install TaskTick"
      sx={{
        position: 'fixed',
        left: 12,
        right: 12,
        bottom: {
          xs: 'calc(env(safe-area-inset-bottom, 0px) + 5.25rem)',
          lg: 'calc(env(safe-area-inset-bottom, 0px) + 1.5rem)',
        },
        // Below the offline and update prompts, which are more urgent.
        zIndex: 'appBar',
        display: 'flex',
      }}
    >
      <Alert
        severity="info"
        icon={iosSafari ? false : <InstallMobileIcon aria-hidden />}
        action={
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            {!iosSafari ? (
              <Button
                color="inherit"
                size="small"
                onClick={() => void install()}
                sx={{ textTransform: 'none', fontWeight: 600 }}
              >
                Install
              </Button>
            ) : null}
            <IconButton
              aria-label="Dismiss install prompt"
              size="small"
              color="inherit"
              onClick={dismiss}
            >
              <CloseIcon fontSize="small" aria-hidden />
            </IconButton>
          </Stack>
        }
        sx={{ width: '100%', alignItems: 'flex-start', boxShadow: 4 }}
      >
        {iosSafari ? (
          <IosInstallHint sx={{ minWidth: 0 }} />
        ) : (
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Install TaskTick
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Add it to your home screen for full-screen use and offline access.
            </Typography>
          </Box>
        )}
      </Alert>
    </Box>
  );
}
