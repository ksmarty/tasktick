/**
 * Refresh every remote calendar a user has, in one call.
 *
 * This is the "I just changed something on my phone" button, one level up from
 * the per-account and per-subscription escape hatches: it sweeps all of them so
 * a user with three sources does not have to find three separate controls.
 *
 * ## What it deliberately does *not* touch
 *
 * A paused CalDAV account and a **hidden** iCal feed are skipped, exactly as the
 * scheduler skips them (`syncDueIcalSubscriptions` treats hiding as disabling).
 * Honouring that here matters: a refresh that quietly hit a feed the user hid to
 * stop it phoning home would make hiding a lie, and the user has no way to see
 * that it happened.
 *
 * A skipped source is not reported at all — the result holds only the sources
 * that were contacted, so an empty result means "nothing remote is connected"
 * rather than "nothing changed".
 *
 * ## Failure isolation
 *
 * Every source is synced inside its own promise, and neither engine throws:
 * `syncAccount` returns `{status:'error', error}` instead, and
 * `syncIcalCalendar` returns `error` on the result. So one dead provider still
 * lets the other sources refresh, and the partial failure comes back naming the
 * source that failed rather than as one opaque error for the whole sweep.
 *
 * The two groups run concurrently; CalDAV runs serialise themselves inside the
 * engine (`runSyncExclusive` in `./sync/locks`), so firing them together cannot
 * make two runs fight over the same provider session.
 *
 * Importing `@/server/sync` pulls in the whole CalDAV transport (~7 MB), which
 * is why the scheduler reaches it lazily. This module is only ever imported by
 * the refresh route, so that cost is paid by the one request that is itself
 * asking for a sync.
 */
import { listAccounts } from '../repos/calendars';
import { syncAccount } from '@/server/sync';
import { listIcalSubscriptions, syncIcalCalendar } from './ical-subscription';
import type {
  CalendarRefreshAccount,
  CalendarRefreshResult,
  CalendarRefreshSubscription,
} from '@/lib/view-types';

/** `fetchImpl` is the test seam, forwarded to the iCal fetcher. */
export interface RefreshDeps {
  fetchImpl?: typeof fetch;
}

export async function refreshAllCalendars(
  userId: string,
  deps: RefreshDeps = {},
): Promise<CalendarRefreshResult> {
  const [accounts, subscriptions] = await Promise.all([
    listAccounts(userId),
    listIcalSubscriptions(userId),
  ]);

  const [accountRuns, subscriptionRuns] = await Promise.all([
    Promise.all(
      accounts
        .filter((account) => account.enabled)
        .map(async (account): Promise<CalendarRefreshAccount> => {
          const result = await syncAccount(account.id, {
            kind: 'incremental',
            trigger: 'manual',
          });
          return {
            id: account.id,
            name: account.name,
            status: result.status,
            pulled: result.pulled,
            pushed: result.pushed,
            deletedLocal: result.deletedLocal,
            deletedRemote: result.deletedRemote,
            conflicts: result.conflicts,
            error: result.error ?? null,
          };
        }),
    ),
    Promise.all(
      subscriptions
        .filter((calendar) => calendar.isVisible)
        .map(async (calendar): Promise<CalendarRefreshSubscription> => {
          const result = await syncIcalCalendar(userId, calendar.id, deps);
          return {
            id: calendar.id,
            name: calendar.name,
            created: result.created,
            updated: result.updated,
            deleted: result.deleted,
            error: result.error,
          };
        }),
    ),
  ]);

  return { accounts: accountRuns, subscriptions: subscriptionRuns };
}
