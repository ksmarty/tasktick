'use client';

/**
 * The user's today, and the display preferences the period screens need.
 *
 * Taken from `/api/bootstrap` — the same read the shell already makes — so a
 * screen never guesses a timezone. `todayIn(zone)` is recomputed on each render
 * rather than frozen in state, which is what makes the date roll over at midnight
 * without a reload: the next render after the clock passes midnight asks again.
 *
 * The date is a *floating day* in the account's zone, exactly as every date in the
 * period contract is, so no screen ever converts a period date to an instant.
 */
import { todayIn } from '@/lib/dates';
import { useResource } from '@/lib/store';
import type { BootstrapPayload } from '@/lib/view-types';
import type { DateOnly } from '@/lib/types';

export interface PeriodCalendarPrefs {
  /** Today, in the account's zone. */
  today: DateOnly;
  zone: string;
  weekStartsOn: number;
  timeFormat: '12h' | '24h';
}

export function useTodayZone(): PeriodCalendarPrefs {
  const { data } = useResource<BootstrapPayload>('/api/bootstrap');
  const settings = data?.settings;
  const zone = settings?.timezone ?? 'UTC';

  return {
    today: todayIn(zone),
    zone,
    weekStartsOn: settings?.weekStartsOn ?? 1,
    timeFormat: settings?.timeFormat === '12h' ? '12h' : '24h',
  };
}
