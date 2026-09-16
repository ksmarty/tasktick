'use client';

import { Share } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { isIosSafari, isStandalone } from './platform';

/**
 * The iOS install story, spelled out.
 *
 * iOS Safari never fires `beforeinstallprompt` — there is no install API at all
 * — so the only thing a page can do is point at Safari's own Share sheet. This
 * renders `null` everywhere except a non-installed iOS Safari, which is also
 * exactly the case where Web Push is unavailable on iOS.
 */
export function IosInstallHint({ className }: { className?: string }) {
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
    <div className={cn('flex items-start gap-3', className)}>
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-ios bg-tint-soft text-tint">
        <Share aria-hidden className="h-5 w-5" />
      </span>
      <div className="min-w-0 space-y-1">
        <p className="text-subhead font-semibold text-label">Install TaskTick</p>
        <p className="text-footnote text-secondary">
          Tap the{' '}
          <Share aria-hidden className="inline-block h-4 w-4 -translate-y-px align-middle" />{' '}
          Share button in Safari&rsquo;s toolbar, then choose{' '}
          <span className="font-semibold text-label">Add to Home Screen</span>.
        </p>
        <p className="text-caption-1 text-tertiary">
          Notifications on iPhone and iPad only work after TaskTick is on your Home Screen (iOS 16.4 or later).
        </p>
      </div>
    </div>
  );
}
