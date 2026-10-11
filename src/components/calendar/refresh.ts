/**
 * How a refresh-all is reported back to the user.
 *
 * Counters rather than "done", the same as a single account's sync: what a user
 * wants to know after pressing refresh is whether the event they just added on
 * their phone actually arrived. Zeroes are skipped so a quiet sweep reads short
 * instead of as a wall of nothing.
 *
 * Kept as a pure function, separate from the button that shows it, for one
 * reason: the interesting cases are the ones a click cannot easily produce — no
 * sources connected, one source of three failing, a sweep where everything was
 * already up to date — and those are exactly what a test can pin.
 */
import type { CalendarRefreshResult } from '@/lib/view-types';

export interface CalendarRefreshReport {
  title: string;
  description: string;
  variant: 'success' | 'error' | 'info';
}

function total<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((sum, item) => sum + pick(item), 0);
}

/** Every source the sweep actually contacted. */
export function calendarRefreshSourceCount(result: CalendarRefreshResult): number {
  return result.accounts.length + result.subscriptions.length;
}

/** The sources that came back with an error, in the order the server reported them. */
export function calendarRefreshFailures(
  result: CalendarRefreshResult,
): { name: string; error: string | null }[] {
  const failed: { name: string; error: string | null }[] = [];
  for (const account of result.accounts) {
    if (account.status === 'error' || account.error) failed.push({ name: account.name, error: account.error });
  }
  for (const subscription of result.subscriptions) {
    if (subscription.error) failed.push({ name: subscription.name, error: subscription.error });
  }
  return failed;
}

/** `5 pulled · 1 pushed · 2 removed`, with the zeroes left out. Empty when nothing moved. */
export function calendarRefreshCounters(result: CalendarRefreshResult): string[] {
  const parts: string[] = [];
  // A feed reports what it created and updated separately; both are "arrived
  // from upstream", which is the only distinction the user is making here.
  const pulled =
    total(result.accounts, (account) => account.pulled) +
    total(result.subscriptions, (feed) => feed.created + feed.updated);
  const pushed = total(result.accounts, (account) => account.pushed);
  const removed =
    total(result.accounts, (account) => account.deletedLocal + account.deletedRemote) +
    total(result.subscriptions, (feed) => feed.deleted);
  const conflicts = total(result.accounts, (account) => account.conflicts);

  if (pulled) parts.push(`${pulled} pulled`);
  if (pushed) parts.push(`${pushed} pushed`);
  if (removed) parts.push(`${removed} removed`);
  if (conflicts) parts.push(`${conflicts} conflicts`);
  return parts;
}

/** `2 sources · 5 pulled · 1 pushed` — or just the source count when nothing moved. */
export function calendarRefreshSummary(result: CalendarRefreshResult): string {
  const sources = calendarRefreshSourceCount(result);
  if (sources === 0) return 'No remote calendars are connected.';
  const label = `${sources} ${sources === 1 ? 'source' : 'sources'}`;
  return [label, ...calendarRefreshCounters(result)].join(' · ');
}

/**
 * The toast for a finished sweep.
 *
 * A partial failure is an `error`, not a success with a footnote: some of what
 * the user asked for did not happen, and naming the source that failed is the
 * only actionable part of the message — "1 of 3 failed" without a name sends
 * them to the settings screen to guess.
 */
export function calendarRefreshReport(result: CalendarRefreshResult): CalendarRefreshReport {
  const sources = calendarRefreshSourceCount(result);
  if (sources === 0) {
    return {
      title: 'No remote calendars',
      description: 'Connect a calendar account or subscribe to a feed to sync one.',
      variant: 'info',
    };
  }

  const failures = calendarRefreshFailures(result);
  if (failures.length > 0) {
    const [first] = failures;
    return {
      title:
        failures.length === sources
          ? 'Calendar refresh failed'
          : `${failures.length} of ${sources} sources failed`,
      description: `${first.name}: ${first.error ?? 'Unknown error'}`,
      variant: 'error',
    };
  }

  const counters = calendarRefreshCounters(result);
  return {
    title: 'Calendars refreshed',
    description: counters.length > 0 ? calendarRefreshSummary(result) : 'Everything was already up to date.',
    variant: 'success',
  };
}
