'use client';

import { useCallback, useState, useSyncExternalStore } from 'react';
import { WifiOff } from 'lucide-react';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useNetworkOnline } from '@/lib/store';
import { dismissFailures, subscribeQueue, queueSnapshot } from '@/lib/offline-queue';

/**
 * The single place the app tells the user where its writes currently are.
 *
 * It reports three different situations, because they mean different things:
 *
 *   - **Offline.** The connection is gone. Anything typed, ticked or checked is
 *     held on this device (`IndexedDB`) and will be sent when it returns. The
 *     count of held changes is shown, because "you are offline" without "and your
 *     work is safe" is the sentence that makes people stop trusting an app.
 *   - **Syncing.** Back online with changes still to send. It says so rather than
 *     going quiet, so the moment the queue drains is visible.
 *   - **Rejected.** A replayed write came back as a 4xx. Those are never retried
 *     — repeating a request the server has already refused would only hide the
 *     rejection — so this is the one case where a change is genuinely lost, and
 *     it must be said out loud instead of disappearing.
 *
 * The Retry action is kept from the previous version and still actively re-probes
 * the origin instead of waiting for the browser's `online` event, which is
 * unreliable on captive portals. Reloading is safe with a full queue: it is on
 * disk, and the reload is exactly what re-establishes the service worker's control
 * of the page.
 *
 * Connectivity is read from `useNetworkOnline` — the *true* signal. `useOnline`
 * deliberately answers a different question ("can a write be accepted right now")
 * and is always true when the queue is durable, so it can never drive this
 * banner.
 */

type Probe = 'idle' | 'checking' | 'failed';

/** A primitive snapshot, so `useSyncExternalStore` can compare cheaply. */
function snapshotKey(): string {
  const snapshot = queueSnapshot();
  return [
    snapshot.entries.length,
    snapshot.authPaused ? 1 : 0,
    snapshot.syncing ? 1 : 0,
    snapshot.failures.length,
    snapshot.failures[0]?.message ?? '',
  ].join('|');
}

export function OfflineBanner() {
  const online = useNetworkOnline();
  const [probe, setProbe] = useState<Probe>('idle');

  const key = useSyncExternalStore(subscribeQueue, snapshotKey, () => '0|0|0|0|');
  const [pending, authPaused, syncing, failureCount, failureMessage] = key.split('|');
  const waiting = Number(pending);
  const failures = Number(failureCount);

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

  if (online && waiting === 0 && failures === 0) return null;

  const message = describe({
    online,
    waiting,
    syncing: syncing === '1',
    authPaused: authPaused === '1',
    failures,
    failureMessage,
    probeFailed: probe === 'failed',
  });

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
        {online ? (
          <span aria-hidden className="inline-flex shrink-0 text-base text-muted-foreground">
            <ReloadIcon className={syncing === '1' ? 'animate-spin' : undefined} />
          </span>
        ) : (
          <WifiOff aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0">{message}</span>
        {failures > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto shrink-0" onClick={() => dismissFailures()}>
            Dismiss
          </Button>
        )}
        {!online && (
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
        )}
      </Alert>
    </div>
  );
}

/** The banner's sentence, kept out of the JSX so it can be read in one place. */
function describe(state: {
  online: boolean;
  waiting: number;
  syncing: boolean;
  authPaused: boolean;
  failures: number;
  failureMessage: string;
  probeFailed: boolean;
}): React.ReactNode {
  const changes = `${state.waiting} change${state.waiting === 1 ? '' : 's'}`;

  if (state.failures > 0) {
    return (
      <>
        {state.failures === 1 ? 'One change could not be saved' : `${state.failures} changes could not be saved`}
        {state.failureMessage ? <span className="text-muted-foreground"> — {state.failureMessage}</span> : null}
      </>
    );
  }

  if (state.authPaused) {
    return (
      <>
        Your session expired, so {changes} {state.waiting === 1 ? 'is' : 'are'} waiting on this device.{' '}
        <span className="text-muted-foreground">Sign in again to send {state.waiting === 1 ? 'it' : 'them'}.</span>
      </>
    );
  }

  if (!state.online) {
    return (
      <>
        You&rsquo;re offline
        {state.waiting > 0 ? ` and ${changes} ${state.waiting === 1 ? 'is' : 'are'} kept on this device` : ''}.{' '}
        {state.waiting > 0 ? 'It will sync when you reconnect.' : 'Anything you change will be kept until you reconnect.'}
        {state.probeFailed && <span className="text-muted-foreground"> Still no connection.</span>}
      </>
    );
  }

  return <>Back online — sending {changes}.</>;
}
