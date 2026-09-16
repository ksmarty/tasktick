/**
 * Scheduler behaviour: which accounts run, when, and never at the same time.
 *
 * The exclusivity rules matter more than the timer itself — two overlapping runs
 * for one account fight over ETags and duplicate objects, and hitting a provider
 * with several parallel sessions is what gets an iCloud account locked out.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CalDavError, serializeEvent } from '@/server/caldav';
import {
  isSyncSchedulerRunning,
  runSchedulerTick,
  setCalDavClientFactory,
  startSyncScheduler,
  stopSyncScheduler,
  syncAccount,
  syncAllDueAccounts,
} from '@/server/sync';
import { isAccountInFlight } from '@/server/sync/locks';
import {
  FakeCalDavClient,
  disposeTempDatabase,
  getAccountRow,
  seedAccount,
  seedCalendar,
  seedLocalEvent,
  useTempDatabase,
} from './sync-helpers';

const HOME = 'https://caldav.example.test/c/calendars/home/';

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  stopSyncScheduler();
  setCalDavClientFactory(null);
  vi.restoreAllMocks();
  await disposeTempDatabase(databaseFile);
});

describe('syncAllDueAccounts', () => {
  it('runs every due account and never overlaps two of them', async () => {
    const concurrency = { active: 0, max: 0 };
    const first = await seedAccount({ intervalMinutes: 15, username: 'tester-1' });
    const second = await seedAccount({ intervalMinutes: 15, username: 'tester-2' });
    const firstClient = new FakeCalDavClient({ delayMs: 3, concurrency });
    const secondClient = new FakeCalDavClient({ delayMs: 3, concurrency });
    firstClient.addCollection({ href: HOME, displayName: 'Home' });
    secondClient.addCollection({ href: HOME, displayName: 'Home' });
    await seedCalendar(first, { remoteHref: HOME });
    await seedCalendar(second, { remoteHref: HOME });
    setCalDavClientFactory((credentials) => (credentials.username === 'tester-1' ? firstClient : secondClient));

    const results = await syncAllDueAccounts();

    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === 'success')).toBe(true);
    expect(concurrency.max).toBe(1);
  });

  it('skips accounts that are not due and accounts whose run is still in flight', async () => {
    const account = await seedAccount({ intervalMinutes: 15 });
    await seedCalendar(account, { remoteHref: HOME });
    const client = new FakeCalDavClient({ delayMs: 10 });
    client.addCollection({ href: HOME, displayName: 'Home' });
    setCalDavClientFactory(() => client);

    // The first run marks the account as synced just now.
    await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });
    expect(await syncAllDueAccounts()).toHaveLength(0); // interval not elapsed

    // An in-flight run is skipped too, even when the interval says otherwise.
    const inFlight = syncAccount(account.accountId, { kind: 'full' });
    expect(isAccountInFlight(account.accountId)).toBe(true);
    expect(await syncAllDueAccounts(Date.now() + 60 * 60_000)).toHaveLength(0);
    await inFlight;

    // Once the interval elapsed and nothing is running, the account is picked up.
    const later = await syncAllDueAccounts(Date.now() + 60 * 60_000);
    expect(later).toHaveLength(1);
    expect(isAccountInFlight(account.accountId)).toBe(false);
  });

  it('isolates a failing account and still runs the healthy one', async () => {
    const broken = await seedAccount({ intervalMinutes: 15, username: 'tester-1' });
    const healthy = await seedAccount({ intervalMinutes: 15, username: 'tester-2' });
    const brokenClient = new FakeCalDavClient();
    brokenClient.addCollection({ href: HOME, displayName: 'Home' });
    brokenClient.failWith = new CalDavError('server exploded', {
      status: 500,
      method: 'PROPFIND',
      url: HOME,
      retryable: true,
    });
    const healthyClient = new FakeCalDavClient();
    healthyClient.addCollection({ href: HOME, displayName: 'Home' });
    await seedCalendar(broken, { remoteHref: HOME });
    await seedCalendar(healthy, { remoteHref: HOME });
    setCalDavClientFactory((credentials) => (credentials.username === 'tester-1' ? brokenClient : healthyClient));

    const results = await syncAllDueAccounts();

    expect(results).toHaveLength(2);
    expect(results.find((result) => result.status === 'error')?.error).toContain('server exploded');
    expect(results.some((result) => result.status === 'success')).toBe(true);
    expect((await getAccountRow(broken.accountId)).consecutiveFailures).toBe(1);
    expect((await getAccountRow(healthy.accountId)).consecutiveFailures).toBe(0);
  });

  it('backs a repeatedly failing account off instead of retrying every sweep', async () => {
    const account = await seedAccount({ intervalMinutes: 15 });
    await seedCalendar(account, { remoteHref: HOME });
    const client = new FakeCalDavClient();
    client.addCollection({ href: HOME, displayName: 'Home' });
    client.failWith = new CalDavError('locked out', { status: 403, method: 'PROPFIND', url: HOME });
    setCalDavClientFactory(() => client);

    await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });
    await syncAccount(account.accountId, { kind: 'full' });
    await syncAccount(account.accountId, { kind: 'full' });
    expect((await getAccountRow(account.accountId)).consecutiveFailures).toBe(3);

    // The effective interval is now 30 minutes for a 15-minute account, so a
    // sweep 20 minutes later must leave it alone.
    const results = await syncAllDueAccounts(Date.now() + 20 * 60_000);
    expect(results).toHaveLength(0);
  });

  it('shares one run between concurrent calls for the same account', async () => {
    const account = await seedAccount();
    await seedCalendar(account, { remoteHref: HOME });
    const client = new FakeCalDavClient({ delayMs: 5 });
    client.addCollection({ href: HOME, displayName: 'Home' });
    client.seedObject(
      `${HOME}ev.ics`,
      serializeEvent({
        uid: 'ev-1',
        summary: 'Weekly review',
        startMs: Date.parse('2024-03-05T10:00:00Z'),
        timezone: 'UTC',
      }),
    );
    setCalDavClientFactory(() => client);

    const [first, second] = await Promise.all([
      syncAccount(account.accountId, { kind: 'full' }),
      syncAccount(account.accountId, { kind: 'full' }),
    ]);

    expect(first).toBe(second); // the very same run, not a second one
    expect(client.calls.filter((call) => call === 'listObjects')).toHaveLength(1);
    expect(client.calls.filter((call) => call === 'listCalendars')).toHaveLength(0);
  });

  it('refuses to stack scheduler ticks that overrun their interval', async () => {
    const account = await seedAccount();
    await seedCalendar(account, { remoteHref: HOME });
    const client = new FakeCalDavClient({ delayMs: 10 });
    client.addCollection({ href: HOME, displayName: 'Home' });
    setCalDavClientFactory(() => client);

    const first = runSchedulerTick();
    const overlapping = await runSchedulerTick(); // must not stack
    expect(overlapping).toEqual([]);
    await first;
  });

  it('keeps a queued run in flight so the sweep cannot start it twice', async () => {
    const first = await seedAccount({ username: 'tester-1' });
    const second = await seedAccount({ username: 'tester-2' });
    const firstCalendar = await seedCalendar(first, { remoteHref: HOME });
    await seedCalendar(second, { remoteHref: HOME });
    await seedLocalEvent(first, firstCalendar, { uid: 'ev-local', summary: 'Local', syncState: 'dirty' });

    const client = new FakeCalDavClient({ delayMs: 8 });
    client.addCollection({ href: HOME, displayName: 'Home' });
    setCalDavClientFactory(() => client);

    const firstRun = syncAccount(first.accountId, { kind: 'full' });
    const secondRun = syncAccount(second.accountId, { kind: 'full' }); // queued, still "in flight"
    expect(isAccountInFlight(first.accountId)).toBe(true);
    expect(isAccountInFlight(second.accountId)).toBe(true);

    await Promise.all([firstRun, secondRun]);

    expect(isAccountInFlight(first.accountId)).toBe(false);
    expect(isAccountInFlight(second.accountId)).toBe(false);
    expect(client.putCalls).toHaveLength(1); // the dirty local event was pushed exactly once
  });
});

describe('scheduler lifecycle', () => {
  it('installs exactly one unref\u2019d interval and stops idempotently', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    startSyncScheduler();
    startSyncScheduler();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(isSyncSchedulerRunning()).toBe(true);
    // The timer must never hold the process open.
    const handle = setIntervalSpy.mock.results[0]?.value as { hasRef?: () => boolean } | undefined;
    expect(handle?.hasRef?.()).toBe(false);

    stopSyncScheduler();
    stopSyncScheduler();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(isSyncSchedulerRunning()).toBe(false);
  });

  it('does not start when sync is disabled', async () => {
    const { resetEnvCache } = await import('@/lib/env');
    process.env.SYNC_ENABLED = 'false';
    resetEnvCache();
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

    startSyncScheduler();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(isSyncSchedulerRunning()).toBe(false);

    process.env.SYNC_ENABLED = 'true';
    resetEnvCache();
  });
});
