'use client';

/**
 * The period interface's segment.
 *
 * Its one job is the deep-link guard: a `/period/*` URL is only meaningful while
 * the account has period tracking on, so a stale bookmark — or a back button after
 * turning the mode off — must land on the task list rather than on an interface the
 * user believes they closed.
 *
 * ## The guard only acts on a *confirmed* answer
 *
 * The client store serves a cached value immediately and revalidates behind it, and
 * a cached `enabled: false` can be a second out of date — it is exactly what the
 * store holds between flipping the switch and the refetch landing. Redirecting on
 * that value evicted the user from the screen they had just turned on, which is the
 * worst version of this bug: the switch appeared to do nothing.
 *
 * So the redirect waits for `confirmed` — a request observed in flight since this
 * segment mounted (see `usePeriodMode`) — and it is skipped entirely when the read
 * failed. A network failure must leave the user where they are, with the exit
 * control in the app bar, rather than bouncing them to `/tasks` and pretending the
 * mode is off.
 *
 * The shell does not read the switch at all: it derives its navigation from the
 * route, so this segment is the *only* place the account's preference decides
 * anything about navigation.
 *
 * No header is published here. Each screen publishes its own title, and the shell
 * renders the one app bar plus the exit control on all of them.
 */
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { usePeriodMode } from '@/components/period/usePeriodMode';

export default function PeriodLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { enabled, loaded, confirmed, error } = usePeriodMode();

  /* The one state that may redirect: a settled, successful read that says "off". */
  const [denied, setDenied] = useState(false);

  useEffect(() => {
    if (denied) return;
    if (!confirmed || !loaded) return;
    // A failed read leaves the old value in the store; acting on it would turn a
    // network problem into a closed interface.
    if (error !== null) return;
    if (enabled) return;
    setDenied(true);
    router.replace('/tasks');
  }, [confirmed, loaded, enabled, error, denied, router]);

  if (denied) return null;

  return <>{children}</>;
}
