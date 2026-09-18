'use client';

import { useEffect, useState } from 'react';
import { SquareArrowUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import { isIosSafari, isStandalone } from './platform';

/**
 * The iOS install story, spelled out.
 *
 * iOS Safari never fires `beforeinstallprompt` — there is no install API at all
 * — so the only thing a page can do is point at Safari's own Share sheet. This
 * renders `null` everywhere except a non-installed iOS Safari, which is also
 * exactly the case where Web Push is unavailable on iOS.
 *
 * The detection below is byte-identical to the Material version. The one API
 * change: `sx` is gone with Material, so callers compose layout through
 * `className` — which the settings screen, the only other caller, never needed.
 * `SquareArrowUp` is the glyph iOS itself draws for Share; the animated set has
 * no share icon.
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
      <span
        aria-hidden
        className="mt-1 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-primary"
      >
        <SquareArrowUp className="size-4" />
      </span>
      <div className="flex min-w-0 flex-col gap-1">
        <p className="text-sm font-semibold">Install TaskTick</p>
        <p className="text-sm text-muted-foreground">
          Tap the <SquareArrowUp aria-hidden className="inline size-4 align-text-bottom" /> Share
          button in Safari&rsquo;s toolbar, then choose{' '}
          <span className="font-semibold text-foreground">Add to Home Screen</span>.
        </p>
        <p className="text-xs text-muted-foreground">
          Notifications on iPhone and iPad only work after TaskTick is on your Home Screen (iOS 16.4
          or later).
        </p>
      </div>
    </div>
  );
}
