'use client';

import { useCallback, useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
 * The detection and retry logic below is byte-identical to the Material version.
 * What changed is the surface, and one deliberate omission: Material's
 * `warning` severity carried an amber accent, and Celestial Sapphire is a
 * monochrome palette — so severity is stated with the weight of the leading rail
 * (`border-l-foreground`) and the `WifiOff` glyph rather than with a hue that
 * does not exist here.
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
    <div
      className={cn(
        'fixed inset-x-3 z-toast flex',
        // The safe-area inset is a dynamic value, so it is the one thing that
        // cannot come from a class on its own; `0.5rem` is still the scale's.
        'top-[calc(env(safe-area-inset-top,0px)_+_0.5rem)]',
      )}
    >
      <Alert
        role="status"
        aria-live="polite"
        className="flex w-full items-center gap-3 border-l-4 border-l-foreground shadow-lg"
      >
        <WifiOff aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          You&rsquo;re offline. Changes are kept on this device and will sync when you reconnect.
          {probe === 'failed' && (
            <span className="text-muted-foreground"> Still no connection.</span>
          )}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => void retry()}
          disabled={probe === 'checking'}
        >
          <span aria-hidden className="inline-flex text-base">
            <ReloadIcon className={probe === 'checking' ? 'animate-spin' : undefined} />
          </span>
          Retry
        </Button>
      </Alert>
    </div>
  );
}
