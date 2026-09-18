import NextLink from 'next/link';
import { CloudOff } from 'lucide-react';
import { ReloadIcon } from '@svg-animated-icons/react/reload';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export const metadata = { title: 'Offline' };
export const dynamic = 'force-static';

/**
 * The service worker's last-resort navigation fallback.
 *
 * Reached only when a navigation fails and neither the network nor the cached
 * app shell could answer. It is intentionally a static route with no data
 * dependencies so that it can be precached and always render — a fallback page
 * that itself needs the network is not a fallback. The service worker precaches
 * this document together with the assets it references, which is what keeps this
 * page renderable with no connection, so it stays deliberately thin: layout
 * utilities, one glyph, and no component that would pull in more script than the
 * document itself.
 *
 * The button is an anchor styled with `buttonVariants()` rather than a shadcn
 * `Button asChild`: `asChild` renders Radix's `Slot`, which uses React hooks and
 * so cannot run in a server component — and this page must stay a server
 * component to remain static.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-background pt-[env(safe-area-inset-top,0px)] pr-[env(safe-area-inset-right,0px)] pb-[env(safe-area-inset-bottom,0px)] pl-[env(safe-area-inset-left,0px)]">
      <div className="flex flex-col items-center gap-5 px-gutter py-12 text-center">
        <div className="flex size-16 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <CloudOff aria-hidden className="size-8" />
        </div>

        <div className="flex flex-col gap-2">
          <h1 className="text-xl font-semibold">You are offline</h1>
          <p className="max-w-xs text-sm text-muted-foreground">
            TaskTick could not reach the server. Anything you already loaded is still available, and
            your changes will sync once you are back online.
          </p>
        </div>

        {/*
          A plain anchor, not next/link: a client-side navigation would be handled by
          the router and could fail the same way this page was reached.
        */}
        <a href="/tasks" className={cn(buttonVariants({ size: 'lg' }), 'h-11')}>
          <span aria-hidden className="inline-flex text-base">
            <ReloadIcon />
          </span>
          Try again
        </a>

        <NextLink
          href="/settings"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Go to settings
        </NextLink>
      </div>
    </main>
  );
}
