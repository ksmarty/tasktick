/**
 * End-to-end coverage of the sync engine against a real temp SQLite database
 * and an in-memory `CalDavClient`. Nothing here touches the network: the fake
 * owns the "server" side, the real transport codec owns the iCalendar text.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { resetEnvCache } from '@/lib/env';
import { CalDavAuthError, CalDavError, serializeEvent, serializeTodo } from '@/server/caldav';
import { calendarEvents, calendars, syncLogs, tasks } from '@/server/db/schema';
import { openSyncDb } from '@/server/sync/engine';
import { discoverAccountCalendars, purgeExpiredTombstones, setCalDavClientFactory, syncAccount } from '@/server/sync';
import {
  ACCOUNT_PASSWORD,
  FakeCalDavClient,
  disposeTempDatabase,
  getAccountRow,
  getCalendarRow,
  getEventRow,
  getTaskRow,
  listConflicts,
  listLogs,
  seedAccount,
  seedCalendar,
  seedLocalEvent,
  seedLocalTask,
  useTempDatabase,
} from './sync-helpers';

const HOME = 'https://caldav.example.test/c/calendars/home/';
const EVENT_HREF = `${HOME}standup.ics`;
const TASK_HREF = `${HOME}milk.ics`;

const STANDUP = serializeEvent({
  uid: 'ev-standup',
  summary: 'Standup',
  description: 'daily sync',
  startMs: Date.parse('2024-03-05T10:00:00Z'),
  endMs: Date.parse('2024-03-05T10:30:00Z'),
  timezone: 'UTC',
  status: 'confirmed',
  transparency: 'opaque',
  rrule: 'FREQ=WEEKLY;BYDAY=MO',
});

const MILK = serializeTodo({
  externalUid: 'todo-milk',
  title: 'Buy milk',
  status: 'todo',
  priority: 'medium',
  dueAtMs: Date.parse('2024-03-06T09:00:00Z'),
  timezone: 'UTC',
});

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  setCalDavClientFactory(null);
  await disposeTempDatabase(databaseFile);
});

/** A fake server with one collection holding the two fixtures. */
function fakeServer(): FakeCalDavClient {
  const client = new FakeCalDavClient();
  client.addCollection({ href: HOME, displayName: 'Home', supportedComponents: ['VEVENT', 'VTODO'] });
  client.seedObject(EVENT_HREF, STANDUP);
  client.seedObject(TASK_HREF, MILK);
  return client;
}

describe('pull', () => {
  it('creates local rows for a full enumeration, mapping VEVENT and VTODO', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    const result = await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });

    expect(result).toMatchObject({ kind: 'full', status: 'success', pulled: 2, pushed: 0, conflicts: 0 });

    const event = await getEventRow(await findEventId(calendarId, 'ev-standup'));
    expect(event.summary).toBe('Standup');
    expect(event.externalHref).toBe(EVENT_HREF);
    expect(event.externalEtag).toBe(client.objectEtag(EVENT_HREF));
    expect(event.syncState).toBe('synced');
    expect(event.syncProvider).toBe('caldav');
    // An RRULE stays one master row — expansion happens at read time.
    expect(event.rrule).toBe('FREQ=WEEKLY;BYDAY=MO');

    const task = await getTaskRow(await findTaskId(account.userId, 'todo-milk'));
    expect(task.title).toBe('Buy milk');
    expect(task.externalUid).toBe('todo-milk');
    expect(task.externalHref).toBe(TASK_HREF);
    expect(task.priority).toBe('medium');
    expect(task.calendarId).toBe(calendarId);

    const logs = await listLogs(account.accountId);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ kind: 'full', status: 'success', pulled: 2, pushed: 0, conflicts: 0 });
    expect(logs[0].finishedAtMs).toBeGreaterThan(0);

    const accountRow = await getAccountRow(account.accountId);
    expect(accountRow.lastSyncStatus).toBe('success');
    expect(accountRow.consecutiveFailures).toBe(0);
    expect(accountRow.lastSyncAtMs).toBeGreaterThan(0);
  });

  it('applies an incremental delta: creates, updates and deletes', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    await syncAccount(account.accountId, { kind: 'full' });
    const eventIdBefore = await findEventId(calendarId, 'ev-standup');
    const taskIdBefore = await findTaskId(account.userId, 'todo-milk');
    const token = client.syncToken(HOME);

    // The server side changes: one object is edited, one is deleted, one added.
    client.seedObject(
      EVENT_HREF,
      serializeEvent({
        uid: 'ev-standup',
        summary: 'Standup (moved)',
        description: 'daily sync',
        startMs: Date.parse('2024-03-05T11:00:00Z'),
        endMs: Date.parse('2024-03-05T11:30:00Z'),
        timezone: 'UTC',
        status: 'confirmed',
        transparency: 'opaque',
      }),
    );
    client.removeObject(TASK_HREF);
    client.seedObject(
      `${HOME}review.ics`,
      serializeTodo({ externalUid: 'todo-review', title: 'Review PR', status: 'todo', priority: 'high', timezone: 'UTC' }),
    );

    const calendarRow = await getCalendarRow(calendarId);
    const db = await openSyncDb();
            await db.update(calendars).set({ remoteSyncToken: token }).where(eq(calendars.id, calendarRow.id));

    const result = await syncAccount(account.accountId, { kind: 'incremental' });

    expect(result).toMatchObject({ status: 'success', pulled: 2, deletedLocal: 1 });
    expect(client.syncCalls.at(-1)).toEqual({ href: HOME, token });

    // The update landed on the *same* row: (calendarId, uid, recurrenceId) is the key.
    const event = await getEventRow(eventIdBefore);
    expect(event.summary).toBe('Standup (moved)');
    expect(await eventIds(calendarId, 'ev-standup')).toHaveLength(1);

    // The deleted object tombstoned the local row instead of removing it.
    const task = await getTaskRow(taskIdBefore);
    expect(task.deletedAtMs).toBeGreaterThan(0);
    expect(task.syncState).toBe('synced');

    // The new object was created.
    const review = await getTaskRow(await findTaskId(account.userId, 'todo-review'));
    expect(review.title).toBe('Review PR');

    // The advanced token is persisted for the next run.
    const updatedCalendar = await getCalendarRow(calendarId);
    expect(updatedCalendar.remoteSyncToken).toBe(client.syncToken(HOME));
  });

  it('keeps a recurring series as a master row plus its override, keyed by recurrenceId', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = new FakeCalDavClient();
    client.addCollection({ href: HOME, displayName: 'Home', supportedComponents: ['VEVENT'] });
    const seriesStart = Date.parse('2024-03-05T10:00:00Z');
    client.seedObject(
      `${HOME}series.ics`,
      mergeComponents(
        serializeEvent({
          uid: 'ev-series',
          summary: 'Series',
          startMs: seriesStart,
          endMs: seriesStart + 1_800_000,
          timezone: 'UTC',
          rrule: 'FREQ=WEEKLY;BYDAY=TU',
        }),
        serializeEvent({
          uid: 'ev-series',
          recurrenceId: '20240312T100000Z',
          summary: 'Series (moved)',
          startMs: Date.parse('2024-03-12T12:00:00Z'),
          endMs: Date.parse('2024-03-12T12:30:00Z'),
          timezone: 'UTC',
        }),
      ),
    );
    setCalDavClientFactory(() => client);

    const first = await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });
    expect(first.pulled).toBe(2);

    const db = await openSyncDb();
            const rows = await db
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.calendarId, calendarId), eq(calendarEvents.uid, 'ev-series')));

    expect(rows).toHaveLength(2);
    const master = rows.find((row) => row.recurrenceId === null);
    const override = rows.find((row) => row.recurrenceId !== null);
    expect(master?.rrule).toBe('FREQ=WEEKLY;BYDAY=TU');
    expect(override?.recurrenceId).toBe('20240312T100000Z');
    expect(override?.summary).toBe('Series (moved)');

    // Re-syncing must update those two rows, never insert a third.
    const second = await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });
    expect(second.pulled).toBe(0);
    const after = await db
      .select()
      .from(calendarEvents)
      .where(and(eq(calendarEvents.calendarId, calendarId), eq(calendarEvents.uid, 'ev-series')));
    expect(after).toHaveLength(2);
  });

  it('matches an existing row by UID even when the remote href moved', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    const eventId = await seedLocalEvent(account, calendarId, {
      uid: 'ev-standup',
      summary: 'Standup',
      externalHref: `${HOME}old-name.ics`,
      externalEtag: '"etag-old"',
    });

    const result = await syncAccount(account.accountId, { kind: 'full' });

    expect(result.pulled).toBe(2); // ev-standup updated in place, todo-milk created
    expect(await eventIds(calendarId, 'ev-standup')).toEqual([eventId]);
    const event = await getEventRow(eventId);
    expect(event.externalHref).toBe(EVENT_HREF);
  });

  it('scopes a run to a single collection when asked', async () => {
    const account = await seedAccount();
    const homeCalendar = await seedCalendar(account, { remoteHref: HOME });
    const workHref = 'https://caldav.example.test/c/calendars/work/';
    const workCalendar = await seedCalendar(account, { name: 'Work', remoteHref: workHref });
    const client = fakeServer();
    client.addCollection({ href: workHref, displayName: 'Work' });
    setCalDavClientFactory(() => client);

    const workTask = await seedLocalTask(account, workCalendar, { title: 'Only work', syncState: 'dirty' });

    const homeOnly = await syncAccount(account.accountId, { kind: 'full', calendarId: homeCalendar });
    expect(homeOnly.pulled).toBe(2);
    expect(homeOnly.pushed).toBe(0);
    expect((await getTaskRow(workTask)).syncState).toBe('dirty');

    const workOnly = await syncAccount(account.accountId, { kind: 'full', calendarId: workCalendar });
    expect(workOnly.pulled).toBe(0);
    expect(workOnly.pushed).toBe(1);
  });

  it('discovers the collections of an account that has none mirrored yet', async () => {
    const account = await seedAccount();
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    const result = await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });

    expect(result).toMatchObject({ status: 'success', pulled: 2 });
    expect(client.calls).toContain('listCalendars');
    const db = await openSyncDb();
            const [mirrored] = await db.select().from(calendars).where(eq(calendars.remoteHref, HOME));
    expect(mirrored).toMatchObject({ provider: 'caldav', supportsVtodo: true });
    expect(await findEventId(mirrored.id, 'ev-standup')).toBeTruthy();
  });

  it('diffs by ETag in memory when the collection has no sync token', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    await syncAccount(account.accountId, { kind: 'full' });
    const before = await getEventRow(await findEventId(calendarId, 'ev-standup'));

    // Nothing changed remotely: no update may be written.
    const second = await syncAccount(account.accountId, { kind: 'full' });
    expect(second.pulled).toBe(0);
    const after = await getEventRow(before.id);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect(client.syncCalls).toHaveLength(0); // no token => listObjects, never REPORT

    // A remote-only change is applied.
    client.seedObject(EVENT_HREF, serializeEvent({ uid: 'ev-standup', summary: 'Standup v2', startMs: before.startMs ?? 0, endMs: before.endMs ?? 0, timezone: 'UTC' }));
    const third = await syncAccount(account.accountId, { kind: 'full' });
    expect(third.pulled).toBe(1);
    expect((await getEventRow(before.id)).summary).toBe('Standup v2');
  });

  it('falls back to a full enumeration when the delta comes back truncated', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    const db = await openSyncDb();
            await db.update(calendars).set({ remoteSyncToken: 'token-0' }).where(eq(calendars.id, calendarId));
    client.truncatedNextSync = true;
    setCalDavClientFactory(() => client);

    const result = await syncAccount(account.accountId, { kind: 'incremental' });

    expect(result.status).toBe('success');
    expect(result.pulled).toBe(2); // both objects enumerated, not the empty delta
  });

  it('stops at SYNC_MAX_ITEMS_PER_RUN and keeps the token so nothing is lost', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    const db = await openSyncDb();
            await db.update(calendars).set({ remoteSyncToken: 'token-0' }).where(eq(calendars.id, calendarId));
    setCalDavClientFactory(() => client);

    process.env.SYNC_MAX_ITEMS_PER_RUN = '1';
    resetEnvCache();
    const result = await syncAccount(account.accountId, { kind: 'incremental' });

    expect(result.pulled).toBe(1);
    expect((await getCalendarRow(calendarId)).remoteSyncToken).toBe('token-0');
    expect(await listLogs(account.accountId)).toHaveLength(1);

    process.env.SYNC_MAX_ITEMS_PER_RUN = '2000';
    resetEnvCache();
  });

  it('tombstones a local row when the remote object disappeared (404)', async () => {
    const account = await seedAccount();
    await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    await syncAccount(account.accountId, { kind: 'full' });
    const taskId = await findTaskId(account.userId, 'todo-milk');
    client.removeObject(TASK_HREF);

    const result = await syncAccount(account.accountId, { kind: 'full', trigger: 'initial' });

    expect(result.deletedLocal).toBe(1);
    const task = await getTaskRow(taskId);
    expect(task.deletedAtMs).toBeGreaterThan(0);
    expect(task.syncState).toBe('synced');
  });
});

describe('push', () => {
  it('uploads a dirty row with If-Match on its stored ETag', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);
    await syncAccount(account.accountId, { kind: 'full' });

    const eventId = await findEventId(calendarId, 'ev-standup');
    const before = await getEventRow(eventId);
    const db = await openSyncDb();
            await db
      .update(calendarEvents)
      .set({ summary: 'Standup (local edit)', syncState: 'dirty', updatedAt: Date.now() })
      .where(eq(calendarEvents.id, eventId));

    const result = await syncAccount(account.accountId, { kind: 'incremental' });

    expect(result.pushed).toBe(1);
    const put = client.putCalls.at(-1);
    expect(put?.options).toEqual({ etag: before.externalEtag });
    expect(put?.ics).toContain('SUMMARY:Standup (local edit)');
    expect(put?.ics).toContain('SEQUENCE:1');

    const after = await getEventRow(eventId);
    expect(after.syncState).toBe('synced');
    expect(after.externalEtag).toBe(client.objectEtag(EVENT_HREF));
    expect(after.externalEtag).not.toBe(before.externalEtag);
    expect(client.objectData(EVENT_HREF)).toContain('Standup (local edit)');
  });

  it('creates a new remote resource with If-None-Match for a never-pushed row', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    const taskId = await seedLocalTask(account, calendarId, {
      title: 'Call the plumber',
      status: 'todo',
      priority: 'high',
      dueAtMs: Date.parse('2024-04-01T08:00:00Z'),
      syncState: 'dirty',
      externalUid: 'todo-plumber',
    });

    await syncAccount(account.accountId, { kind: 'incremental' });

    const put = client.putCalls.at(-1);
    expect(put?.href).toBe(`${HOME}todo-plumber.ics`);
    expect(put?.options).toEqual({ ifNoneMatch: true });
    expect(put?.ics).toContain('SUMMARY:Call the plumber');

    const task = await getTaskRow(taskId);
    expect(task.syncState).toBe('synced');
    expect(task.externalHref).toBe(`${HOME}todo-plumber.ics`);
    expect(task.externalEtag).toBe(client.objectEtag(`${HOME}todo-plumber.ics`));
    expect(client.objectData(`${HOME}todo-plumber.ics`)).toContain('UID:todo-plumber');
  });

  it('propagates a local delete as a remote DELETE with the stored ETag', async () => {
    const account = await seedAccount();
    await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);
    await syncAccount(account.accountId, { kind: 'full' });

    const taskId = await findTaskId(account.userId, 'todo-milk');
    const before = await getTaskRow(taskId);
    const db = await openSyncDb();
            await db
      .update(tasks)
      .set({ deletedAtMs: Date.now(), syncState: 'pending_delete' })
      .where(eq(tasks.id, taskId));

    const result = await syncAccount(account.accountId, { kind: 'incremental' });

    expect(result.deletedRemote).toBe(1);
    expect(client.deleteCalls).toEqual([{ href: TASK_HREF, etag: before.externalEtag }]);
    expect(client.objectData(TASK_HREF)).toBeUndefined();

    // The tombstone survives so `purgeExpiredTombstones` can reclaim it later.
    const after = await getTaskRow(taskId);
    expect(after.deletedAtMs).toBeGreaterThan(0);
    expect(after.syncState).toBe('synced');
  });

  it('treats a 404 on DELETE as success', async () => {
    const account = await seedAccount();
    await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);
    await syncAccount(account.accountId, { kind: 'full' });

    const taskId = await findTaskId(account.userId, 'todo-milk');
    client.removeObject(TASK_HREF); // someone else deleted it first
    const db = await openSyncDb();
            await db.update(tasks).set({ deletedAtMs: Date.now(), syncState: 'pending_delete' }).where(eq(tasks.id, taskId));

    const result = await syncAccount(account.accountId, { kind: 'push' });

    expect(result).toMatchObject({ status: 'success', deletedRemote: 1 });
    expect((await getTaskRow(taskId)).syncState).toBe('synced');
  });

  it('never pulls when the account direction is push and never pushes when it is pull', async () => {
    const pushOnly = await seedAccount({ direction: 'push' });
    const pushCalendar = await seedCalendar(pushOnly, { remoteHref: HOME });
    const pushClient = fakeServer();
    setCalDavClientFactory(() => pushClient);
    await seedLocalEvent(pushOnly, pushCalendar, { uid: 'ev-push', summary: 'Pushed only', syncState: 'dirty' });

    const pushed = await syncAccount(pushOnly.accountId, { kind: 'incremental' });
    expect(pushed.pulled).toBe(0);
    expect(pushed.pushed).toBe(1);
    expect(pushClient.putCalls).toHaveLength(1);

    const pullOnly = await seedAccount({ direction: 'pull' });
    const pullCalendar = await seedCalendar(pullOnly, { remoteHref: HOME });
    const pullClient = fakeServer();
    setCalDavClientFactory(() => pullClient);
    await seedLocalEvent(pullOnly, pullCalendar, { uid: 'ev-pull', summary: 'Stays local', syncState: 'dirty' });

    const pulled = await syncAccount(pullOnly.accountId, { kind: 'incremental' });
    expect(pulled.pulled).toBe(2);
    expect(pulled.pushed).toBe(0);
    expect(pullClient.putCalls).toHaveLength(0);
    expect((await getEventRow(await findEventId(pullCalendar, 'ev-pull'))).syncState).toBe('dirty');
  });
});

describe('conflicts', () => {
  it('resolves a 412 by taking the newer remote side and records the audit trail', async () => {
    const account = await seedAccount({ direction: 'push' });
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    const remoteEditedAt = Date.parse('2024-05-01T12:00:00Z');
    client.seedObject(
      EVENT_HREF,
      serializeEvent(
        { uid: 'ev-standup', summary: 'Edited remotely', startMs: Date.parse('2024-03-05T10:00:00Z'), endMs: Date.parse('2024-03-05T10:30:00Z'), timezone: 'UTC' },
        { dtstamp: new Date(remoteEditedAt) },
      ),
    );
    const staleEtag = '"etag-stale"';
    const eventId = await seedLocalEvent(account, calendarId, {
      uid: 'ev-standup',
      summary: 'Edited locally',
      syncState: 'dirty',
      externalHref: EVENT_HREF,
      externalEtag: staleEtag,
      updatedAt: remoteEditedAt - 60_000, // older than the remote edit
    });

    const result = await syncAccount(account.accountId, { kind: 'push' });

    expect(result.conflicts).toBe(1);
    expect(client.putCalls[0]?.options).toEqual({ etag: staleEtag }); // the 412 attempt
    // The remote side is newer, so the local row adopts it and nothing is re-PUT.
    expect(client.putCalls).toHaveLength(1);

    const event = await getEventRow(eventId);
    expect(event.summary).toBe('Edited remotely');
    expect(event.syncState).toBe('synced');
    expect(event.externalEtag).toBe(client.objectEtag(EVENT_HREF));

    const conflicts = await listConflicts(account.userId);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].resolution).toBe('remote-wins');
    expect(conflicts[0].entityType).toBe('event');
    expect(conflicts[0].entityId).toBe(eventId);
    expect(conflicts[0].entityTitle).toBe('Edited locally');
    expect(conflicts[0].localSnapshot).toMatchObject({ summary: 'Edited locally', syncState: 'dirty' });
    expect(conflicts[0].remoteSnapshot).toMatchObject({ summary: 'Edited remotely' });
    expect(conflicts[0].resolvedAtMs).toBeGreaterThan(0);
  });

  it('re-PUTs the local winner of a 412 with the freshly read ETag', async () => {
    const account = await seedAccount({ direction: 'push' });
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    const remoteEditedAt = Date.parse('2024-05-01T12:00:00Z');
    client.seedObject(
      EVENT_HREF,
      serializeEvent(
        { uid: 'ev-standup', summary: 'Edited remotely', startMs: Date.parse('2024-03-05T10:00:00Z'), endMs: Date.parse('2024-03-05T10:30:00Z'), timezone: 'UTC' },
        { dtstamp: new Date(remoteEditedAt) },
      ),
    );
    const eventId = await seedLocalEvent(account, calendarId, {
      uid: 'ev-standup',
      summary: 'Newer local edit',
      syncState: 'dirty',
      externalHref: EVENT_HREF,
      externalEtag: '"etag-stale"',
      updatedAt: remoteEditedAt + 60_000, // newer than the remote edit
    });
    const freshEtag = client.objectEtag(EVENT_HREF);

    const result = await syncAccount(account.accountId, { kind: 'push' });

    expect(result).toMatchObject({ conflicts: 1, pushed: 1 });
    expect(client.putCalls).toHaveLength(2);
    expect(client.putCalls[1]?.options).toEqual({ etag: freshEtag });
    expect(client.putCalls[1]?.ics).toContain('SUMMARY:Newer local edit');
    expect(client.objectData(EVENT_HREF)).toContain('Newer local edit');

    const event = await getEventRow(eventId);
    expect(event.summary).toBe('Newer local edit');
    expect(event.syncState).toBe('synced');
    expect((await listConflicts(account.userId))[0].resolution).toBe('local-wins');
  });

  it('merges a concurrent edit field-wise and audits it as merged', async () => {
    const account = await seedAccount({ direction: 'push' });
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    const remoteEditedAt = Date.parse('2024-05-01T12:00:00Z');
    client.seedObject(
      TASK_HREF,
      serializeTodo(
        {
          externalUid: 'todo-milk',
          title: 'Remote title',
          status: 'todo',
          priority: 'low',
          timezone: 'UTC',
          notes: 'remote notes',
        },
        { dtstamp: new Date(remoteEditedAt) },
      ),
    );
    // The local edit happened in the same second as the remote one.
    const taskId = await seedLocalTask(account, calendarId, {
      title: 'Local title',
      status: 'todo',
      priority: 'high',
      syncState: 'dirty',
      externalUid: 'todo-milk',
      externalHref: TASK_HREF,
      externalEtag: '"etag-stale"',
      updatedAt: remoteEditedAt + 500,
    });

    const result = await syncAccount(account.accountId, { kind: 'push' });

    expect(result).toMatchObject({ conflicts: 1, pushed: 1 });
    const task = await getTaskRow(taskId);
    expect(task.title).toBe('Local title'); // locally touched fields win
    expect(task.priority).toBe('high');
    expect(task.notes).toBe('remote notes'); // local left it null => remote value
    expect(task.syncState).toBe('synced');
    expect((await listConflicts(account.userId))[0].resolution).toBe('merged');
    expect(client.objectData(TASK_HREF)).toContain('SUMMARY:Local title');
  });

  it('resolves a pull-side conflict and keeps the winner dirty for the push half', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);
    await syncAccount(account.accountId, { kind: 'full' });

    const eventId = await findEventId(calendarId, 'ev-standup');
    const stored = await getEventRow(eventId);
    const remoteEditedAt = Date.parse('2024-05-01T12:00:00Z');
    client.seedObject(
      EVENT_HREF,
      serializeEvent(
        { uid: 'ev-standup', summary: 'Remote rewrite', startMs: Date.parse('2024-03-05T10:00:00Z'), timezone: 'UTC' },
        { dtstamp: new Date(remoteEditedAt) },
      ),
    );
    const db = await openSyncDb();
            await db
      .update(calendarEvents)
      .set({ summary: 'Local rewrite', syncState: 'dirty', updatedAt: remoteEditedAt + 30_000 })
      .where(eq(calendarEvents.id, eventId));

    const result = await syncAccount(account.accountId, { kind: 'incremental' });

    expect(result).toMatchObject({ conflicts: 1, pushed: 1 });
    const event = await getEventRow(eventId);
    expect(event.summary).toBe('Local rewrite');
    expect(event.syncState).toBe('synced');
    expect(event.externalEtag).not.toBe(stored.externalEtag);
    expect(client.objectData(EVENT_HREF)).toContain('Local rewrite');
    expect((await listConflicts(account.userId))[0].resolution).toBe('local-wins');
  });

  it('audits a remote deletion that collides with a local edit', async () => {
    const account = await seedAccount();
    await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    setCalDavClientFactory(() => client);
    await syncAccount(account.accountId, { kind: 'full' });

    const taskId = await findTaskId(account.userId, 'todo-milk');
    client.removeObject(TASK_HREF);
    const db = await openSyncDb();
            await db.update(tasks).set({ title: 'Edited locally', syncState: 'dirty' }).where(eq(tasks.id, taskId));

    await syncAccount(account.accountId, { kind: 'full' });

    const task = await getTaskRow(taskId);
    expect(task.deletedAtMs).toBeGreaterThan(0);
    expect(task.syncState).toBe('synced');
    const conflicts = await listConflicts(account.userId);
    expect(conflicts.map((row) => row.resolution)).toContain('remote-wins');
  });
});

describe('discovery', () => {
  it('upserts collection metadata and never deletes a calendar the server stopped advertising', async () => {
    const account = await seedAccount();
    const goneCalendarId = await seedCalendar(account, {
      name: 'Old',
      remoteHref: 'https://caldav.example.test/c/calendars/old/',
    });
    const client = new FakeCalDavClient();
    client.addCollection({
      href: HOME,
      displayName: 'Home',
      supportedComponents: ['VEVENT', 'VTODO'],
      color: '#FF0000',
      readOnly: true,
      timezone: 'Europe/Berlin',
      ctag: 'ctag-1',
      syncToken: 'token-1',
    });
    setCalDavClientFactory(() => client);

    const result = await discoverAccountCalendars(account.accountId);

    expect(result.kind).toBe('discover');
    expect(result.status).toBe('success');
    expect(result.calendars).toEqual([
      { href: HOME, displayName: 'Home', color: '#FF0000', supportsVtodo: true, readOnly: true },
    ]);

    const db = await openSyncDb();
            const [created] = await db.select().from(calendars).where(eq(calendars.remoteHref, HOME));
    expect(created).toMatchObject({
      provider: 'caldav',
      remoteCtag: 'ctag-1',
      remoteSyncToken: 'token-1',
      supportsVtodo: true,
      readOnly: true,
      colorOverride: '#FF0000',
      timezone: 'Europe/Berlin',
    });

    const gone = await getCalendarRow(goneCalendarId);
    expect(gone.deletedAtMs).toBeNull(); // user data is never destroyed by discovery
    expect(gone.lastSyncError).toContain('no longer advertised');
  });
});

describe('failure handling', () => {
  it('returns an error result, logs it and counts the failure', async () => {
    const account = await seedAccount();
    await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    client.failWith = new CalDavAuthError('invalid app password', {
      status: 401,
      method: 'PROPFIND',
      url: HOME,
    });
    setCalDavClientFactory(() => client);

    const result = await syncAccount(account.accountId, { kind: 'incremental' });

    expect(result.status).toBe('error');
    expect(result.error).toContain('invalid app password');
    const accountRow = await getAccountRow(account.accountId);
    expect(accountRow.lastSyncStatus).toBe('error');
    expect(accountRow.consecutiveFailures).toBe(1);
    expect(accountRow.lastError).toContain('invalid app password');
    const logs = await listLogs(account.accountId);
    expect(logs[0]).toMatchObject({ status: 'error' });
    expect(logs[0].error).toContain('invalid app password');

    // A second failure increments; a success would reset it.
    await syncAccount(account.accountId, { kind: 'incremental' });
    expect((await getAccountRow(account.accountId)).consecutiveFailures).toBe(2);
  });

  it('never lets the decrypted password reach a result, a log row or the account', async () => {
    const account = await seedAccount();
    await seedCalendar(account, { remoteHref: HOME });
    const client = fakeServer();
    client.failWith = new CalDavError(`basic ${ACCOUNT_PASSWORD} rejected`, {
      status: 401,
      method: 'GET',
      url: HOME,
    });
    setCalDavClientFactory(() => client);

    const result = await syncAccount(account.accountId, { kind: 'incremental' });

    expect(result.error).not.toContain(ACCOUNT_PASSWORD);
    expect(result.error).toContain('***');
    const accountRow = await getAccountRow(account.accountId);
    expect(accountRow.lastError).not.toContain(ACCOUNT_PASSWORD);
    const logs = await listLogs(account.accountId);
    expect(JSON.stringify(logs)).not.toContain(ACCOUNT_PASSWORD);
    expect(JSON.stringify(result)).not.toContain(ACCOUNT_PASSWORD);
  });

  it('isolates one broken collection instead of aborting the account', async () => {
    const account = await seedAccount();
    const goodCalendarId = await seedCalendar(account, { remoteHref: HOME });
    const brokenCalendarId = await seedCalendar(account, {
      name: 'Broken',
      remoteHref: 'https://caldav.example.test/c/calendars/broken/',
    });
    const client = fakeServer();
    setCalDavClientFactory(() => client);

    const result = await syncAccount(account.accountId, { kind: 'full' });

    expect(result.status).toBe('success');
    expect(result.pulled).toBe(2);
    expect(result.error).toContain('unknown collection');
    expect((await getCalendarRow(goodCalendarId)).lastSyncError).toBeNull();
    expect((await getCalendarRow(brokenCalendarId)).lastSyncError).toContain('unknown collection');
    // A sync row is still written, with the partial failure visible.
    expect((await listLogs(account.accountId))[0].error).toContain('unknown collection');
  });
});

describe('tombstones', () => {
  it('purges propagated tombstones and expired logs, keeping pending ones', async () => {
    const account = await seedAccount();
    const calendarId = await seedCalendar(account, { remoteHref: HOME });
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;

    const propagated = await seedLocalTask(account, calendarId, {
      title: 'Propagated delete',
      syncState: 'synced',
      externalUid: 'todo-propagated',
      externalHref: TASK_HREF,
      deletedAtMs: old,
    });
    const pending = await seedLocalTask(account, calendarId, {
      title: 'Still to push',
      syncState: 'pending_delete',
      externalUid: 'todo-pending',
      externalHref: `${HOME}pending.ics`,
      deletedAtMs: old,
    });
    const neverMirrored = await seedLocalTask(account, null, {
      title: 'Local-only delete',
      syncState: 'pending_delete',
      deletedAtMs: old,
    });
    const fresh = await seedLocalTask(account, calendarId, {
      title: 'Fresh delete',
      syncState: 'synced',
      externalUid: 'todo-fresh',
      externalHref: `${HOME}fresh.ics`,
      deletedAtMs: Date.now() - 1000,
    });

    const db = await openSyncDb();
        await db.insert(syncLogs).values({
      id: 'fresh-log',
      userId: account.userId,
      accountId: account.accountId,
      kind: 'full',
      status: 'success',
      startedAtMs: Date.now(),
    });
    await db.insert(syncLogs).values({
      id: 'old-log',
      userId: account.userId,
      accountId: account.accountId,
      kind: 'full',
      status: 'success',
      startedAtMs: Date.now() - 100 * 24 * 60 * 60 * 1000,
    });

    const purged = await purgeExpiredTombstones();

    expect(purged).toBe(2);
    await expect(getTaskRow(propagated)).rejects.toThrow();
    await expect(getTaskRow(neverMirrored)).rejects.toThrow();
    expect((await getTaskRow(pending)).title).toBe('Still to push');
    expect((await getTaskRow(fresh)).title).toBe('Fresh delete');
    const remainingLogs = await listLogs(account.accountId);
    expect(remainingLogs.map((row) => row.id)).toEqual(['fresh-log']);
  });
});

/* -------------------------------------------------------------------------- */
/* small lookups that keep the assertions readable                            */
/* -------------------------------------------------------------------------- */

/** Puts several components from separately serialised payloads into one VCALENDAR. */
function mergeComponents(...payloads: string[]): string {
  const bodies = payloads.map((payload) => {
    const start = payload.indexOf('BEGIN:VEVENT');
    const end = payload.lastIndexOf('END:VEVENT') + 'END:VEVENT'.length;
    return payload.slice(start, end);
  });
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//TaskTick test//EN\r\n${bodies.join('\r\n')}\r\nEND:VCALENDAR\r\n`;
}

async function eventIds(calendarId: string, uid: string): Promise<string[]> {
  const db = await openSyncDb();
      const rows = await db
    .select({ id: calendarEvents.id })
    .from(calendarEvents)
    .where(and(eq(calendarEvents.calendarId, calendarId), eq(calendarEvents.uid, uid)));
  return rows.map((row) => row.id);
}

async function findEventId(calendarId: string, uid: string): Promise<string> {
  const ids = await eventIds(calendarId, uid);
  if (ids.length !== 1) throw new Error(`expected exactly one row for ${uid}, got ${ids.length}`);
  return ids[0];
}

async function findTaskId(userId: string, externalUid: string): Promise<string> {
  const db = await openSyncDb();
      const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.externalUid, externalUid)));
  if (!row) throw new Error(`no task for ${externalUid}`);
  return row.id;
}
