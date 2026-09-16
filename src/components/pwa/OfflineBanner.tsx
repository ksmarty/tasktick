'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * Persistent offline indicator.
 *
 * TaskTick never queues writes inside the service worker (iOS would evict it
 * and lose them); the client keeps the mutation queue and reconciles when the
 * connection returns. This banner is the user-facing half of that contract: it
 * says the app is offline and that unsent changes are still held, and its
 * "Retry" action actively re-checks the network instead of waiting for the
 * browser's `online` event, which is unreliable on captive portals.
 */

const BANNER_CLASS =
  'fixed inset-x-3 top-[calc(var(--sat)_+_0.5rem)] z-50 flex items-center gap-3 rounded-ios-xl ' +
  'material px-3.5 py-2.5 shadow-ios-lg animate-ios-in';

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
    <div className={BANNER_CLASS} role="status" aria-live="polite">
      <WifiOff aria-hidden className="h-5 w-5 shrink-0 text-warning" />
      <p className="min-w-0 flex-1 text-footnote text-label">
        You&rsquo;re offline. Changes are kept on this device and will sync when you reconnect.
        {probe === 'failed' && <span className="text-secondary"> Still no connection.</span>}
      </p>
      <button
        type="button"
        onClick={() => void retry()}
        disabled={probe === 'checking'}
        className="pressable flex shrink-0 items-center gap-1 rounded-ios bg-fill px-3 py-1.5 text-footnote font-semibold text-label disabled:opacity-60"
      >
        <RefreshCw aria-hidden className={probe === 'checking' ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        Retry
      </button>
    </div>
  );
}
