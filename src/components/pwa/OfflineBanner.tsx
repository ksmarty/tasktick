'use client';

import { useCallback, useEffect, useState } from 'react';
import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import RefreshIcon from '@mui/icons-material/Refresh';
import WifiOffIcon from '@mui/icons-material/WifiOff';

/**
 * Persistent offline indicator.
 *
 * TaskTick never queues writes inside the service worker (iOS would evict it
 * and lose them); the client keeps the mutation queue and reconciles when the
 * connection returns. This banner is the user-facing half of that contract: it
 * says the app is offline and that unsent changes are still held, and its
 * "Retry" action actively re-checks the network instead of waiting for the
 * browser's `online` event, which is unreliable on captive portals.
 *
 * Material `Alert` for the surface — it already carries the right severity
 * colour, icon slot and action slot, so the hand-rolled banner is gone. The
 * detection and retry logic below is unchanged.
 */

type Probe = 'idle' | 'checking' | 'failed';

export function OfflineBanner() {
  // Assume online for the first paint; the effect corrects it on the client so
  // the server-rendered markup never disagrees with the hydrated one.
  const [offline, setOffline] = useState(false);
  const [probe, setProbe] = useState<Probe>('idle');

  useEffect(() => {
    const sync = () => {
      setOffline(!navigator.onLine);
      if (navigator.onLine) setProbe('idle');
    };
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const retry = useCallback(async () => {
    setProbe('checking');
    try {
      // A HEAD to the shell is the cheapest proof that the origin is reachable
      // again; the service worker passes non-GET requests straight through.
      const response = await fetch('/', { method: 'HEAD', cache: 'no-store' });
      if (!response.ok) throw new Error(`probe failed: ${response.status}`);
      // Reboot the shell so the client's mutation queue reconciles against a
      // live network, exactly as a fresh launch would.
      window.location.reload();
    } catch {
      setProbe('failed');
    }
  }, []);

  if (!offline) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        left: 12,
        right: 12,
        top: 'calc(env(safe-area-inset-top, 0px) + 0.5rem)',
        zIndex: 'snackbar',
        display: 'flex',
      }}
    >
      <Alert
        severity="warning"
        role="status"
        aria-live="polite"
        icon={<WifiOffIcon aria-hidden />}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => void retry()}
            disabled={probe === 'checking'}
            startIcon={
              probe === 'checking' ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <RefreshIcon aria-hidden />
              )
            }
            sx={{ textTransform: 'none' }}
          >
            Retry
          </Button>
        }
        sx={{ width: '100%', alignItems: 'center', boxShadow: 4 }}
      >
        You&rsquo;re offline. Changes are kept on this device and will sync when you reconnect.
        {probe === 'failed' && (
          <Box component="span" sx={{ color: 'text.secondary' }}>
            {' '}
            Still no connection.
          </Box>
        )}
      </Alert>
    </Box>
  );
}
