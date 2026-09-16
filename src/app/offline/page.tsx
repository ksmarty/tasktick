import Link from 'next/link';
import { CloudOff, RefreshCw } from 'lucide-react';

export const metadata = { title: 'Offline' };
export const dynamic = 'force-static';

/**
 * The service worker's last-resort navigation fallback.
 *
 * Reached only when a navigation fails and neither the network nor the cached
 * app shell could answer. It is intentionally a static route with no data
 * dependencies so that it can be precached and always render — a fallback page
 * that itself needs the network is not a fallback.
 */
export default function OfflinePage() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-5 px-8 text-center">
      <div className="flex size-16 items-center justify-center rounded-ios-2xl bg-fill-secondary text-secondary">
        <CloudOff className="size-8" aria-hidden />
      </div>

      <div className="space-y-2">
        <h1 className="text-title-2 font-semibold">You are offline</h1>
        <p className="max-w-xs text-subhead text-secondary">
          TaskTick could not reach the server. Anything you already loaded is still available, and your changes
          will sync once you are back online.
        </p>
      </div>

      {/*
        A plain anchor, not next/link: a client-side navigation would be handled by
        the router and could fail the same way this page was reached.
      */}
      <a
        href="/today"
        className="inline-flex min-h-11 items-center gap-2 rounded-ios bg-tint px-5 text-body font-medium text-tint-contrast pressable"
      >
        <RefreshCw className="size-4" aria-hidden />
        Try again
      </a>

      <Link href="/settings" className="text-footnote text-secondary underline underline-offset-2">
        Go to settings
      </Link>
    </main>
  );
}
