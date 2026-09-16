'use client';

import { Plus, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
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
 */

/** `beforeinstallprompt` is still not in the DOM lib types. */
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: readonly string[];
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
  prompt(): Promise<void>;
}

const BANNER_CLASS =
  'fixed inset-x-3 bottom-[calc(var(--tabbar-total)_+_0.75rem)] z-40 flex items-start gap-3 ' +
  'rounded-ios-xl material p-3 shadow-ios-lg animate-ios-in';

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
    <div className={BANNER_CLASS} role="complementary" aria-label="Install TaskTick">
      {iosSafari ? (
        <IosInstallHint className="min-w-0 flex-1" />
      ) : (
        <>
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-ios bg-tint-soft text-tint">
            <Plus aria-hidden className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-subhead font-semibold text-label">Install TaskTick</p>
            <p className="text-footnote text-secondary">
              Add it to your home screen for full-screen use and offline access.
            </p>
            <button
              type="button"
              onClick={() => void install()}
              className="pressable mt-1.5 rounded-ios bg-tint px-3.5 py-1.5 text-subhead font-semibold text-tint-contrast"
            >
              Install
            </button>
          </div>
        </>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss install prompt"
        className="pressable -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full text-tertiary"
      >
        <X aria-hidden className="h-4.5 w-4.5" />
      </button>
    </div>
  );
}
