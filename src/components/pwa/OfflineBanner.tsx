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

  /*
   * A small mark in the corner, not a banner across the top.
   *
   * A persistent alert is the loudest thing on the screen and it reports a
   * condition the user can do nothing about — and now that the offline layer
   * works, most of what it said ("anything you change will be kept") is simply
   * what the app does. It also sat over the content it was describing.
   *
   * So: a dot. Glanceable, out of the way, and it still carries the whole message
   * for anyone who looks or listens — `role="status"` and an `aria-label` announce
   * it without a single pixel of layout.
   *
   * The glow is the one bit of decoration: a small grey dot meaning "your changes
   * are being held" should not look like a small grey dot meaning nothing.
   */
  return (
    <div
      className={cn(
        'fixed right-3 z-toast',
        // Clear of the tab bar, which is where a thumb rests and where the action
        // button lives.
        'bottom-[calc(env(safe-area-inset-bottom,0px)_+_5.5rem)]',
      )}
    >
      <button
        type="button"
        role="status"
        aria-live="polite"
        aria-label={message}
        title={message}
        onClick={() => void retry()}
        className={cn(
          'relative inline-flex size-8 items-center justify-center rounded-full border border-border bg-background/80 text-muted-foreground shadow-sm backdrop-blur-md outline-none transition focus-visible:ring-2 focus-visible:ring-ring',
          online && 'opacity-0',
          failures > 0 && 'text-destructive',
        )}
      >
        {online ? (
          <ReloadIcon className={syncing === '1' ? 'animate-spin' : undefined} />
        ) : (
          <WifiOff aria-hidden className="size-4 shrink-0" />
        )}
        {(!online || failures > 0) && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 -z-10 rounded-full bg-destructive/25 blur-md"
          />
        )}
        {failures > 0 && (
          <span
            aria-hidden
            className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </button>
    </div>
  );
}

/** The banner's sentence, kept out of the JSX so it can be read in one place. */
/*
 * The state in words.
 *
 * A plain string, not JSX: the indicator is a single icon now, so there is no
 * markup to build — and these strings are what its `aria-label` says. They used to
 * be fragments, which a `String()` coercion turned into "[object Object]" the
 * moment the visible text went away. One rendering, read by sighted and assistive
 * users alike, cannot drift.
 */
function describe(state: {
  online: boolean;
  waiting: number;
  syncing: boolean;
  authPaused: boolean;
  failures: number;
  failureMessage: string;
  probeFailed: boolean;
}): string {
  const changes = `${state.waiting} change${state.waiting === 1 ? '' : 's'}`;

  if (state.failures > 0) {
    const lead = state.failures === 1 ? 'One change could not be saved' : `${state.failures} changes could not be saved`;
    return state.failureMessage ? `${lead} — ${state.failureMessage}` : lead;
  }

  if (state.authPaused) {
    return `Your session expired, so ${changes} ${state.waiting === 1 ? 'is' : 'are'} waiting on this device. Sign in again to send ${state.waiting === 1 ? 'it' : 'them'}.`;
  }

  if (!state.online) {
    const held = state.waiting > 0 ? ` and ${changes} ${state.waiting === 1 ? 'is' : 'are'} kept on this device` : '';
    const next = state.waiting > 0 ? 'It will sync when you reconnect.' : 'Anything you change will be kept until you reconnect.';
    return `You're offline${held}. ${next}${state.probeFailed ? ' Still no connection.' : ''}`;
  }

  return `Back online — sending ${changes}.`;
}
