'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Registers `/sw.js` and surfaces the "a new build is waiting" prompt.
 *
 * Production only: a service worker in front of `next dev` caches HMR chunks
 * and makes every dev reload confusing. The worker itself is written to be
 * updated explicitly rather than implicitly — it calls `skipWaiting()` on
 * install so it is always *waiting*, never *controlling*, until this prompt
 * asks it to take over, which keeps a mid-session reload from mixing the old
 * page with new chunks.
 *
 * Update checks are piggy-backed on `visibilitychange`, throttled, so a device
 * that sleeps for a week still notices a deploy within a minute of being opened
 * without polling the network in the background.
 *
 * The registration and update logic below is byte-identical to the Material
 * version; only the prompt's surface changed, and the floating slot is now
 * expressed against the layout scale — the tab-bar height token plus a
 * Tailwind-scale gap — instead of a hand-tuned `5.25rem`.
 */

/** Don't re-check the worker more often than this when returning to the tab. */
const UPDATE_CHECK_INTERVAL_MS = 60_000;

export function ServiceWorkerRegistrar() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;

    const container = navigator.serviceWorker;
    let registration: ServiceWorkerRegistration | undefined;
    let cancelled = false;
    let lastCheckedAt = Date.now();

    const onControllerChange = () => {
      // A reload is already in flight; a second one would throw away the load.
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    };

    const watchForUpdates = (reg: ServiceWorkerRegistration) => {
      // Already waiting from a previous session.
      if (reg.waiting && container.controller) setWaitingWorker(reg.waiting);

      reg.addEventListener('updatefound', () => {
        const installing = reg.installing;
        if (!installing) return;
        installing.addEventListener('statechange', () => {
          // No controller means this is the very first install: nothing to
          // reload, the page is already running the current build.
          if (installing.state === 'installed' && container.controller) setWaitingWorker(installing);
        });
      });
    };

    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !registration) return;
      if (Date.now() - lastCheckedAt < UPDATE_CHECK_INTERVAL_MS) return;
      lastCheckedAt = Date.now();
      registration.update().catch(() => {
        /* offline or the server is down — the next visibility change retries */
      });
    };

    container.addEventListener('controllerchange', onControllerChange);
    document.addEventListener('visibilitychange', onVisibilityChange);

    container
      .register('/sw.js', { scope: '/' })
      .then((reg) => {
        if (cancelled) return;
        registration = reg;
        watchForUpdates(reg);
      })
      .catch((error) => {
        // An unregisterable worker must never break the app.
        console.error('[pwa] service worker registration failed', error);
      });

    return () => {
      cancelled = true;
      container.removeEventListener('controllerchange', onControllerChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, []);

  const applyUpdate = useCallback(() => {
    // The worker completes the swap; `controllerchange` performs the reload.
    waitingWorker?.postMessage({ type: 'SKIP_WAITING' });
  }, [waitingWorker]);

  if (!waitingWorker) return null;

  return (
    <div
      className={cn(
        'fixed inset-x-3 z-toast flex',
        // Clear of the shell's floating bottom band on a phone, and of the home
        // indicator when running installed.
        'bottom-[calc(env(safe-area-inset-bottom,0px)_+_var(--spacing-tabbar)_+_1.5rem)]',
        'lg:bottom-[calc(env(safe-area-inset-bottom,0px)_+_1.5rem)]',
      )}
    >
      <Alert
        role="status"
        aria-live="polite"
        className="flex w-full items-center gap-3 border-l-4 border-l-foreground shadow-lg"
      >
        <span aria-hidden className="inline-flex shrink-0 text-base text-muted-foreground">
          <ReloadIcon />
        </span>
        <span className="min-w-0">A new version of TaskTick is ready.</span>
        <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={applyUpdate}>
          Reload
        </Button>
      </Alert>
    </div>
  );
}
