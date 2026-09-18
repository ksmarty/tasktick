'use client';

import { useCallback, useEffect, useState } from 'react';
import { MobileIcon } from '@svg-animated-icons/react/mobile';
import { X } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { IosInstallHint } from './IosInstallHint';
import { INSTALL_DISMISS_STORAGE_KEY, isIosSafari, isStandalone } from './platform';
import { cn } from '@/lib/utils';

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
 * The detection, dismissal and prompt logic below is byte-identical to the
 * Material version; only the surface changed. It keeps Material's stacking
 * intent — below the offline and update prompts, which are more urgent — with
 * the layout scale's `z-appbar` under their `z-toast`.
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
    <div
      role="complementary"
      aria-label="Install TaskTick"
      className={cn(
        'fixed inset-x-3 z-appbar flex',
        // Below the offline and update prompts, which are more urgent.
        'bottom-[calc(env(safe-area-inset-bottom,0px)_+_var(--spacing-tabbar)_+_1.5rem)]',
        'lg:bottom-[calc(env(safe-area-inset-bottom,0px)_+_1.5rem)]',
      )}
    >
      <Alert className="flex w-full items-start gap-3 shadow-lg">
        {iosSafari ? (
          <IosInstallHint className="min-w-0 flex-1" />
        ) : (
          <>
            <span aria-hidden className="inline-flex shrink-0 text-lg text-muted-foreground">
              <MobileIcon />
            </span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-semibold">Install TaskTick</span>
              <span className="text-sm text-muted-foreground">
                Add it to your home screen for full-screen use and offline access.
              </span>
            </span>
          </>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {!iosSafari ? (
            <Button variant="ghost" size="sm" onClick={() => void install()}>
              Install
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Dismiss install prompt"
            onClick={dismiss}
          >
            <X aria-hidden />
          </Button>
        </span>
      </Alert>
    </div>
  );
}
