'use client';

/**
 * The mode as the client sees it.
 *
 * `GET /api/period/settings` is the source of truth, and it is the account's own
 * preference — so toggling the switch on the settings screen changes this value
 * for every reader at once (the switch writes through optimistically; see
 * `PeriodModeCard`).
 *
 * The switch is also mirrored into the display cookie here (see `./mode`), which
 * is the only reason the entry route can redirect a cold start into the period
 * interface without a client round trip.
 *
 * ## Why `confirmed` exists
 *
 * `loaded` means "the store has a value". That is not the same as "the value is
 * current": an entry hydrated from the last session is served immediately and
 * revalidated in the background, and acting on the hydrated value is how a screen
 * evicts a user over a setting they changed ten seconds ago. `confirmed` is the
 * stronger statement — *a request was observed in flight during this mount* — and
 * it is what `app/(app)/period/layout.tsx` gates its redirect on.
 *
 * The pure read lives in `./mode` (no directive), because the server needs the
 * cookie helpers too.
 */
import { useEffect, useState } from 'react';
import { useResource } from '@/lib/store';
import type { PeriodSettings } from '@/lib/period-types';
import { PERIOD_MODE_COOKIE, periodModeCookie } from './mode';

export interface PeriodModeState {
  /** The account's preference; false until the settings have answered. */
  enabled: boolean;
  /** True once the store holds a value, current or not. */
  loaded: boolean;
  /** True only after a read has been seen in flight since this hooked in. */
  confirmed: boolean;
  /** The read's error, if it failed; a failure must never evict a user. */
  error: string | null;
}

export function usePeriodMode(): PeriodModeState {
  const settings = useResource<PeriodSettings>('/api/period/settings');
  const data = settings.data;

  const [sawRequest, setSawRequest] = useState(false);

  useEffect(() => {
    if (settings.isLoading) setSawRequest(true);
  }, [settings.isLoading]);

  useEffect(() => {
    if (!data) return;
    // A display preference, not a secret: readable by the server on the very
    // next request, which is the whole point.
    document.cookie = `${PERIOD_MODE_COOKIE}=${periodModeCookie(data.enabled)}; path=/; max-age=31536000; SameSite=Lax`;
  }, [data]);

  return {
    enabled: data?.enabled === true,
    loaded: data !== undefined,
    confirmed: sawRequest,
    error: settings.error,
  };
}
