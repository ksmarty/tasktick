/**
 * Per-account CalDAV synchronisation.
 *
 * Responsibilities, in the order a run executes them:
 *
 *  1. load the account and build a client (the stored password is decrypted
 *     here and nowhere else — it never reaches a `SyncResult`, a `sync_logs`
 *     row or an error message);
 *  2. discover collections when the account has none mirrored yet;
 *  3. for every enabled collection: **pull** (delta token when we have one,
 *     otherwise a full enumeration diffed by ETag in memory), then **push** the
 *     rows the user changed;
 *  4. resolve two-sided conflicts deterministically, recording every decision in
 *     `sync_conflicts`, and propagate deletions as tombstones;
 *  5. write one `sync_logs` row per run and update the account's sync status.
 *
 * Failure policy: an expected failure (auth, network, precondition, one broken
 * collection) never throws out of this module — it becomes a `SyncResult` and a
 * log row with status `error`. Throwing is reserved for programming errors.
 */
import { and, eq, inArray, isNotNull, isNull, lt, or } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { getEnv } from '@/lib/env';
import type { SyncDirection, SyncProvider, SyncState, SyncResult } from '@/lib/types';
import { CalDavNotFoundError, CalDavPreconditionFailedError, createCalDavClient } from '@/server/caldav';
import type {
  CalDavClient,
  CalDavClientOptions,
  CalDavCredentials,
  ParsedEvent,
  ParsedTodo,
  PutOptions,
  RemoteCalendar,
  RemoteObject,
} from '@/server/caldav';
import { decryptField, newId } from '@/server/crypto';
import { getDb } from '@/server/db';
import { caldavAccounts, calendarEvents, calendars, syncConflicts, syncLogs, tasks } from '@/server/db/schema';
import type { CalendarEventRow, CalendarRow, CaldavAccountRow, Schema, TaskRow } from '@/server/db/schema';
import { runSyncExclusive } from './locks';
import {
  EVENT_LOCALLY_PREFERRED_FIELDS,
  TASK_LOCALLY_PREFERRED_FIELDS,
  buildEventIcs,
  buildTaskIcs,
  deriveObjectHref,
  eventAuditSnapshot,
  eventInsertValues,
  eventMergeView,
  eventValuesFromParsed,
  formatRemoteLastModified,
  parseRemoteObject,
  taskAuditSnapshot,
  taskInsertValues,
  taskMergeView,
  taskValuesFromParsed,
} from './mapper';
import {
  isDirtyState,
  pickDefined,
  pickRemoteModifiedAt,
  remoteChangedSince,
  resolveConflict,
  resolvePendingDeleteConflict,
  resolveRemoteDeletion,
} from './merge';
import type { ConflictOutcome, ConflictResolution } from './merge';

type EventValues = Partial<typeof calendarEvents.$inferInsert>;
type TaskValues = Partial<typeof tasks.$inferInsert>;
type SqlDb = BetterSQLite3Database<Schema>;

/**
 * The casts in this module — see the comment on {@link openSyncDb}. Drizzle's
 * builder types are dialect-specific, so the plain objects the mappers produce
 * are narrowed at this one boundary.
 */
function asEventValues(values: Record<string, unknown>): EventValues {
  return values as EventValues;
}
function asTaskValues(values: Record<string, unknown>): TaskValues {
  return values as TaskValues;
}
function asEventInsert(values: Record<string, unknown>): typeof calendarEvents.$inferInsert {
  return values as typeof calendarEvents.$inferInsert;
}
function asTaskInsert(values: Record<string, unknown>): typeof tasks.$inferInsert {
  return values as typeof tasks.$inferInsert;
}

/**
 * Drizzle's SQLite and Postgres handles share the same builder *shape* but not
 * the same generic signature, so calling `db.select()` on the `Db` union does
 * not typecheck. `src/server/db/schema.ts` guarantees both dialects are
 * structurally identical, so casting once here keeps every statement below
 * dialect-neutral.
 */
export async function openSyncDb(): Promise<SqlDb> {
  return (await getDb()) as unknown as SqlDb;
}

export interface SyncRunOptions {
  kind?: 'full' | 'incremental' | 'push';
  /** Restrict the run to a single collection ("sync this calendar now"). */
  calendarId?: string;
  trigger?: 'manual' | 'scheduled' | 'initial';
}

export interface Counters {
  pulled: number;
  pushed: number;
  deletedRemote: number;
  deletedLocal: number;
  conflicts: number;
}

export function zeroCounters(): Counters {
  return { pulled: 0, pushed: 0, deletedRemote: 0, deletedLocal: 0, conflicts: 0 };
}

export type CalDavClientFactory = (
  credentials: CalDavCredentials,
  options?: CalDavClientOptions,
) => CalDavClient | Promise<CalDavClient>;

let clientFactory: CalDavClientFactory = createCalDavClient;

/** Test seam: the suites inject an in-memory fake, the app talks real HTTP. */
export function setCalDavClientFactory(factory: CalDavClientFactory | null): void {
  clientFactory = factory ?? createCalDavClient;
}

/**
 * A short, secret-free message. The decrypted CalDAV password is passed in as a
 * redaction target so a transport that echoes its request can never leak it
 * into a log row, a `SyncResult` or the UI.
 */
export function describeError(error: unknown, secrets: readonly string[] = []): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  let message = raw;
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join('***');
  }
  return message.length > 400 ? `${message.slice(0, 400)}…` : message;
}

/**
 * The transport may signal failures with a dedicated error class or with a
 * `status` on the thrown value; both spellings are accepted so the policy layer
 * stays independent of how the codec models its errors.
 */
function hasHttpStatus(error: unknown, status: number): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { status?: unknown; statusCode?: unknown; response?: { status?: unknown } };
  return candidate.status === status || candidate.statusCode === status || candidate.response?.status === status;
}

function isPreconditionFailed(error: unknown): boolean {
  return error instanceof CalDavPreconditionFailedError || hasHttpStatus(error, 412);
}

function isNotFound(error: unknown): boolean {
  return error instanceof CalDavNotFoundError || hasHttpStatus(error, 404);
}

/* -------------------------------------------------------------------------- */
/* run context                                                                */
/* -------------------------------------------------------------------------- */

interface RunContext {
  db: SqlDb;
  client: CalDavClient;
  account: CaldavAccountRow;
  kind: 'full' | 'incremental' | 'push';
  maxItems: number;
  secrets: readonly string[];
  counters: Counters;
  now(): number;
}

/** Columns every pulled/pointed remote object writes back onto its row. */
interface MirrorBookkeeping {
  externalHref: string;
  externalEtag: string | null;
  syncProvider: SyncProvider;
  remoteSequence: number | null;
  remoteLastModified: string | null;
  lastSyncedAtMs: number;
}

function mirrorBookkeeping(
  now: number,
  remote: RemoteObject,
  from: { sequence: number | null; lastModified: string | null },
): MirrorBookkeeping {
  return {
    externalHref: remote.href,
    externalEtag: remote.etag,
    syncProvider: 'caldav',
    remoteSequence: from.sequence,
    remoteLastModified: from.lastModified,
    lastSyncedAtMs: now,
  };
}

/* -------------------------------------------------------------------------- */
/* public entry points                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Syncs one account. Concurrent calls for the same account share a single run
 * (see `runSyncExclusive`); runs for different accounts are serialised
 * process-wide so two of them can never fight over the same provider session.
 */
export async function syncAccount(accountId: string, opts: SyncRunOptions = {}): Promise<SyncResult> {
  const kind: SyncResult['kind'] = opts.kind ?? 'incremental';
  return runSyncExclusive(accountId, async () => {
    try {
      return await performSync(accountId, opts);
    } catch (error) {
      // `performSync` already turns every expected failure into a result; this
      // guards the unexpected (a database that will not open, a bug in a helper)
      // so nothing ever throws out of the engine into a route or the scheduler.
      return { kind, status: 'error', ...zeroCounters(), error: describeError(error) };
    }
  });
}

/**
 * Discovers the account's collections and mirrors their metadata into
 * `calendars`. A collection the server stopped advertising is *marked*, never
 * deleted: a discovery run must not destroy user data.
 */
export async function discoverAccountCalendars(accountId: string): Promise<SyncResult> {
  try {
    return await performDiscovery(accountId);
  } catch (error) {
    // Last-resort guard, mirroring `syncAccount`.
    return { kind: 'discover', status: 'error', ...zeroCounters(), error: describeError(error) };
  }
}

async function performDiscovery(accountId: string): Promise<SyncResult> {
  const startedAtMs = Date.now();
  const db = await openSyncDb();
  const secrets: string[] = [];
  let account: CaldavAccountRow | undefined;
  let logId: string | null = null;

  try {
    [account] = await db.select().from(caldavAccounts).where(eq(caldavAccounts.id, accountId)).limit(1);
    if (!account) return skipped('discover', 'CalDAV account not found');
    if (account.deletedAtMs !== null) return skipped('discover', 'CalDAV account was deleted');
    if (!account.enabled) return skipped('discover', 'CalDAV account is disabled');

    logId = newId();
    await db.insert(syncLogs).values({
      id: logId,
      userId: account.userId,
      accountId: account.id,
      kind: 'discover',
      status: 'running',
      startedAtMs,
    });

    const client = await buildClient(account, secrets);
    const remote = await client.listCalendars();
    const discovered = await upsertCalendars(db, account, remote);
    const counters = zeroCounters();
    counters.pulled = remote.length;

    const finishedAtMs = Date.now();
    await db
      .update(syncLogs)
      .set({ status: 'success', finishedAtMs, pulled: counters.pulled })
      .where(eq(syncLogs.id, logId));
    await db
      .update(caldavAccounts)
      .set({
        lastSyncAtMs: finishedAtMs,
        lastSyncStatus: 'success',
        lastError: null,
        consecutiveFailures: 0,
        updatedAt: finishedAtMs,
      })
      .where(eq(caldavAccounts.id, account.id));

    return { kind: 'discover', status: 'success', ...counters, calendars: discovered };
  } catch (error) {
    const message = describeError(error, secrets);
    const failedAt = Date.now();
    const current = account;
    if (logId) {
      const id = logId;
      await safeWrite(() =>
        db.update(syncLogs).set({ status: 'error', finishedAtMs: failedAt, error: message }).where(eq(syncLogs.id, id)),
      );
    }
    if (current) {
      await safeWrite(() =>
        db
          .update(caldavAccounts)
          .set({
            lastSyncAtMs: failedAt,
            lastSyncStatus: 'error',
            lastError: message,
            consecutiveFailures: current.consecutiveFailures + 1,
            updatedAt: failedAt,
          })
          .where(eq(caldavAccounts.id, current.id)),
      );
    }
    return { kind: 'discover', status: 'error', ...zeroCounters(), error: message };
  }
}

/**
 * Hard-deletes tombstones whose delete has already propagated, plus expired
 * `sync_logs`. Tombstones are what let a delete travel between replicas, but
 * they must not accumulate forever.
 *
 * Removed: mirrored tasks/events whose `deletedAtMs` is older than
 * `olderThanMs` (default 30 days) and that need no further propagation — either
 * already pushed (`syncState = 'synced'`) or never mirrored at all (no href, so
 * there is nothing to propagate). Returns the number of rows removed; expired
 * `sync_logs` (older than 90 days) are cleaned in the same pass and are not
 * counted.
 */
export async function purgeExpiredTombstones(olderThanMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
  const db = await openSyncDb();
  const cutoff = Date.now() - Math.max(0, olderThanMs);

  const purgedEvents = await db
    .delete(calendarEvents)
    .where(
      and(
        isNotNull(calendarEvents.deletedAtMs),
        lt(calendarEvents.deletedAtMs, cutoff),
        or(
          eq(calendarEvents.syncState, 'synced'),
          and(eq(calendarEvents.syncState, 'pending_delete'), isNull(calendarEvents.externalHref)),
        ),
      ),
    )
    .returning({ id: calendarEvents.id });

  const purgedTasks = await db
    .delete(tasks)
    .where(
      and(
        isNotNull(tasks.deletedAtMs),
        lt(tasks.deletedAtMs, cutoff),
        or(eq(tasks.syncState, 'synced'), and(eq(tasks.syncState, 'pending_delete'), isNull(tasks.externalHref))),
      ),
    )
    .returning({ id: tasks.id });

  await db.delete(syncLogs).where(lt(syncLogs.startedAtMs, Date.now() - 90 * 24 * 60 * 60 * 1000));

  return purgedEvents.length + purgedTasks.length;
}

/* -------------------------------------------------------------------------- */
/* the run                                                                    */
/* -------------------------------------------------------------------------- */

function skipped(kind: SyncResult['kind'], error: string): SyncResult {
  return { kind, status: 'skipped', ...zeroCounters(), error };
}

async function safeWrite(write: () => Promise<unknown>): Promise<void> {
  try {
    await write();
  } catch {
    /* the run already failed; a bookkeeping write must not escalate it */
  }
}

/**
 * Decrypts the stored password and hands it to the transport. The plaintext is
 * scoped to this call and pushed onto `secrets` so that error messages can
 * redact it.
 */
async function buildClient(account: CaldavAccountRow, secrets: string[]): Promise<CalDavClient> {
  const env = getEnv();
  const password = decryptField(account.passwordEncrypted);
  secrets.push(password);
  return await clientFactory(
    { serverUrl: account.serverUrl, username: account.username, password },
    { allowInsecureTls: env.CALDAV_ALLOW_INSECURE_TLS },
  );
}

async function performSync(accountId: string, opts: SyncRunOptions): Promise<SyncResult> {
  const db = await openSyncDb();
  const secrets: string[] = [];
  const startedAtMs = Date.now();
  let kind: 'full' | 'incremental' | 'push' = opts.kind ?? 'incremental';
  let account: CaldavAccountRow | undefined;
  let logId: string | null = null;

  try {
    [account] = await db.select().from(caldavAccounts).where(eq(caldavAccounts.id, accountId)).limit(1);
    if (!account) return skipped(kind, 'CalDAV account not found');
    if (account.deletedAtMs !== null) return skipped(kind, 'CalDAV account was deleted');
    if (!account.enabled) return skipped(kind, 'CalDAV account is disabled');

    // The first run (and an explicit "initial" trigger) must enumerate the whole
    // collection; later runs can rely on the stored delta token.
    if (!opts.kind && (opts.trigger === 'initial' || account.lastSyncAtMs === null)) kind = 'full';

    logId = newId();
    await db.insert(syncLogs).values({
      id: logId,
      userId: account.userId,
      accountId: account.id,
      calendarId: opts.calendarId ?? null,
      kind,
      status: 'running',
      startedAtMs,
    });
    await db
      .update(caldavAccounts)
      .set({ lastSyncStatus: 'running', updatedAt: startedAtMs })
      .where(eq(caldavAccounts.id, account.id));

    const client = await buildClient(account, secrets);
    const ctx: RunContext = {
      db,
      client,
      account,
      kind,
      maxItems: Math.max(1, getEnv().SYNC_MAX_ITEMS_PER_RUN),
      secrets,
      counters: zeroCounters(),
      now: () => Date.now(),
    };

    let collections = await loadCollections(db, account.id, opts.calendarId ?? null);
    if (collections.length === 0 && !opts.calendarId) {
      // Nothing mirrored yet: an undiscovered account has no collection to sync
      // into, so mirror the metadata first.
      await upsertCalendars(db, account, await client.listCalendars());
      collections = await loadCollections(db, account.id, null);
    }

    const direction = (account.direction as SyncDirection) ?? 'auto';
    const doPull = kind !== 'push' && direction !== 'push';
    const doPush = direction !== 'pull';

    let attempted = 0;
    let failed = 0;
    let firstError: string | null = null;

    for (const calendar of collections) {
      const href = calendar.remoteHref;
      if (!href) continue;
      attempted += 1;
      try {
        if (doPull) await pullCalendar(ctx, calendar, href);
        if (doPush) await pushCalendar(ctx, calendar, href);
        await db
          .update(calendars)
          .set({ lastSyncedAtMs: ctx.now(), lastSyncError: null, updatedAt: ctx.now() })
          .where(eq(calendars.id, calendar.id));
      } catch (error) {
        failed += 1;
        const message = describeError(error, secrets);
        firstError ??= message;
        await safeWrite(() =>
          db.update(calendars).set({ lastSyncError: message, updatedAt: Date.now() }).where(eq(calendars.id, calendar.id)),
        );
      }
    }

    // Only a wholesale failure is an account failure: one broken collection must
    // not push the whole account into backoff, but it stays visible in the log.
    const accountFailed = attempted > 0 && failed === attempted;
    const status: SyncResult['status'] = accountFailed ? 'error' : 'success';
    const finishedAtMs = Date.now();
    const counters = ctx.counters;

    await db
      .update(syncLogs)
      .set({ status, finishedAtMs, ...counters, error: firstError })
      .where(eq(syncLogs.id, logId));
    await db
      .update(caldavAccounts)
      .set({
        lastSyncAtMs: finishedAtMs,
        lastSyncStatus: status,
        lastError: accountFailed ? firstError : null,
        consecutiveFailures: accountFailed ? account.consecutiveFailures + 1 : 0,
        updatedAt: finishedAtMs,
      })
      .where(eq(caldavAccounts.id, account.id));

    return { kind, status, ...counters, ...(firstError ? { error: firstError } : {}) };
  } catch (error) {
    const message = describeError(error, secrets);
    const failedAt = Date.now();
    const current = account;
    if (logId) {
      const id = logId;
      await safeWrite(() =>
        db.update(syncLogs).set({ status: 'error', finishedAtMs: failedAt, error: message }).where(eq(syncLogs.id, id)),
      );
    }
    if (current) {
      await safeWrite(() =>
        db
          .update(caldavAccounts)
          .set({
            lastSyncAtMs: failedAt,
            lastSyncStatus: 'error',
            lastError: message,
            consecutiveFailures: current.consecutiveFailures + 1,
            updatedAt: failedAt,
          })
          .where(eq(caldavAccounts.id, current.id)),
      );
    }
    return { kind, status: 'error', ...zeroCounters(), error: message };
  }
}

async function loadCollections(db: SqlDb, accountId: string, calendarId: string | null): Promise<CalendarRow[]> {
  const where = calendarId
    ? and(eq(calendars.caldavAccountId, accountId), eq(calendars.id, calendarId), isNull(calendars.deletedAtMs))
    : and(eq(calendars.caldavAccountId, accountId), isNull(calendars.deletedAtMs));
  return await db.select().from(calendars).where(where);
}

/**
 * Mirrors remote collection metadata. Collections the server no longer
 * advertises are flagged with `lastSyncError` and otherwise left alone — a
 * discovery run never deletes user data.
 */
async function upsertCalendars(
  db: SqlDb,
  account: CaldavAccountRow,
  remote: RemoteCalendar[],
): Promise<NonNullable<SyncResult['calendars']>> {
  const existing = await db.select().from(calendars).where(eq(calendars.caldavAccountId, account.id));
  const byHref = new Map(existing.filter((row) => row.remoteHref !== null).map((row) => [row.remoteHref as string, row]));
  const seen = new Set<string>();
  const discovered: NonNullable<SyncResult['calendars']> = [];
  const now = Date.now();

  for (const collection of remote) {
    seen.add(collection.href);
    const supportsVtodo = collection.supportedComponents.includes('VTODO');
    const current = byHref.get(collection.href);

    if (current) {
      await db
        .update(calendars)
        .set({
          name: collection.displayName || current.name,
          description: collection.description ?? current.description,
          // `color` is a palette token, so the remote's raw colour is kept in
          // `colorOverride`, which the UI prefers when present.
          colorOverride: collection.color ?? current.colorOverride,
          timezone: collection.timezone ?? current.timezone,
          remoteCtag: collection.ctag ?? current.remoteCtag,
          remoteSyncToken: collection.syncToken ?? current.remoteSyncToken,
          supportsVtodo,
          readOnly: collection.readOnly,
          lastSyncError: null,
          updatedAt: now,
        })
        .where(eq(calendars.id, current.id));
    } else {
      await db.insert(calendars).values({
        id: newId(),
        userId: account.userId,
        name: collection.displayName || 'Calendar',
        description: collection.description,
        color: 'blue',
        colorOverride: collection.color,
        timezone: collection.timezone ?? 'UTC',
        provider: 'caldav',
        caldavAccountId: account.id,
        remoteHref: collection.href,
        remoteCtag: collection.ctag,
        remoteSyncToken: collection.syncToken,
        supportsVtodo,
        readOnly: collection.readOnly,
        sortOrder: 'a0',
      });
    }

    discovered.push({
      href: collection.href,
      displayName: collection.displayName,
      color: collection.color,
      supportsVtodo,
      readOnly: collection.readOnly,
    });
  }

  for (const row of existing) {
    if (row.remoteHref === null || seen.has(row.remoteHref) || row.deletedAtMs !== null) continue;
    await db
      .update(calendars)
      .set({ lastSyncError: 'collection is no longer advertised by the server', updatedAt: now })
      .where(eq(calendars.id, row.id));
  }

  return discovered;
}

/* -------------------------------------------------------------------------- */
/* pull                                                                       */
/* -------------------------------------------------------------------------- */

async function pullCalendar(ctx: RunContext, calendar: CalendarRow, href: string): Promise<void> {
  const { db, client } = ctx;
  let changed: RemoteObject[] = [];
  let deletedHrefs: readonly string[] = [];
  let nextSyncToken = calendar.remoteSyncToken;
  let authoritative = false;

  if (ctx.kind !== 'full' && calendar.remoteSyncToken) {
    const delta = await client.syncCollection(href, calendar.remoteSyncToken);
    if (delta.truncated) {
      // The server signalled an incomplete result set: enumerate instead.
      changed = await client.listObjects(href);
      authoritative = true;
    } else {
      changed = delta.changed;
      deletedHrefs = delta.deleted;
      nextSyncToken = delta.syncToken ?? calendar.remoteSyncToken;
    }
  } else {
    changed = await client.listObjects(href);
    authoritative = true;
  }

  const capped = changed.length > ctx.maxItems;
  const batch = capped ? changed.slice(0, ctx.maxItems) : changed;
  if (capped) {
    // Stay polite to the provider: the remainder of the delta is re-fetched next
    // run, which is why the token must not advance and no deletion may be
    // inferred from what we did not read.
    nextSyncToken = calendar.remoteSyncToken;
    authoritative = false;
    console.warn(
      `[sync] ${calendar.name}: ${changed.length} remote objects exceed SYNC_MAX_ITEMS_PER_RUN=${ctx.maxItems}; continuing next run`,
    );
  }

  for (const remote of batch) {
    try {
      await applyRemoteObject(ctx, calendar, remote);
    } catch (error) {
      // One malformed payload must not abort the collection.
      console.warn(`[sync] ${calendar.name}: skipped ${remote.href}: ${describeError(error, ctx.secrets)}`);
    }
  }

  await applyRemoteDeletions(ctx, calendar, deletedHrefs, authoritative ? new Set(changed.map((o) => o.href)) : null);

  const ctag = await client.getCtag(href).catch(() => null);
  await db
    .update(calendars)
    .set({ remoteSyncToken: nextSyncToken, remoteCtag: ctag ?? calendar.remoteCtag })
    .where(eq(calendars.id, calendar.id));
}

async function applyRemoteObject(ctx: RunContext, calendar: CalendarRow, remote: RemoteObject): Promise<void> {
  for (const parsed of parseRemoteObject(remote)) {
    if (parsed.kind === 'event') {
      await applyRemoteEvent(ctx, calendar, remote, parsed);
    } else {
      await applyRemoteTask(ctx, calendar, remote, parsed);
    }
  }
}

/** Events are keyed by `(calendarId, uid, recurrenceId)`; null == the master. */
async function applyRemoteEvent(
  ctx: RunContext,
  calendar: CalendarRow,
  remote: RemoteObject,
  parsed: ParsedEvent,
): Promise<void> {
  const { db } = ctx;
  const recurrenceId = parsed.event.recurrenceId ?? null;
  const [existing] = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.calendarId, calendar.id),
        eq(calendarEvents.uid, parsed.uid),
        recurrenceId === null ? isNull(calendarEvents.recurrenceId) : eq(calendarEvents.recurrenceId, recurrenceId),
      ),
    )
    .limit(1);

  const rawIcs = remote.data;
  const values = eventValuesFromParsed(parsed, {
    userId: ctx.account.userId,
    calendarId: calendar.id,
    timezone: calendar.timezone,
    rawIcs,
  });
  const mirror = mirrorBookkeeping(ctx.now(), remote, {
    sequence: parsed.sequence,
    lastModified: formatRemoteLastModified(parsed.lastModifiedMs),
  });

  if (!existing) {
    const insert = eventInsertValues(parsed, {
      userId: ctx.account.userId,
      calendarId: calendar.id,
      timezone: calendar.timezone,
      rawIcs,
    });
    await db.insert(calendarEvents).values(
      asEventInsert({ ...insert, ...mirror, id: newId(), createdAt: ctx.now(), updatedAt: ctx.now() }),
    );
    ctx.counters.pulled += 1;
    return;
  }

  const remoteChanged = remoteChangedSince(existing.externalEtag, remote.etag);
  const dirty = isDirtyState(existing.syncState);

  if (dirty && remoteChanged) {
    // Genuine two-sided conflict: see `merge.ts`.
    await resolveEventConflict(ctx, existing, values, pickRemoteModifiedAt(parsed.lastModifiedMs, parsed.dtstampMs), mirror);
    return;
  }
  if (dirty) return; // local intent pending; the push half carries it
  if (!remoteChanged && existing.deletedAtMs === null) return; // nothing to do

  // Remote-only change — or the object reappeared after a propagated delete.
  await db
    .update(calendarEvents)
    .set(asEventValues({ ...pickDefined(values), ...mirror, syncState: 'synced', deletedAtMs: null, updatedAt: ctx.now() }))
    .where(eq(calendarEvents.id, existing.id));
  ctx.counters.pulled += 1;
}

/** Tasks are keyed by `(userId, externalUid)` — one row per VTODO, ever. */
async function applyRemoteTask(
  ctx: RunContext,
  calendar: CalendarRow,
  remote: RemoteObject,
  parsed: ParsedTodo,
): Promise<void> {
  const { db } = ctx;
  const [existing] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, ctx.account.userId), eq(tasks.externalUid, parsed.uid)))
    .limit(1);

  const rawIcs = remote.data;
  const values = taskValuesFromParsed(parsed, {
    userId: ctx.account.userId,
    calendarId: calendar.id,
    timezone: calendar.timezone,
    rawIcs,
  });
  const mirror = mirrorBookkeeping(ctx.now(), remote, {
    sequence: parsed.sequence,
    lastModified: formatRemoteLastModified(parsed.lastModifiedMs),
  });

  if (!existing) {
    const insert = taskInsertValues(parsed, {
      userId: ctx.account.userId,
      calendarId: calendar.id,
      timezone: calendar.timezone,
      rawIcs,
    });
    await db.insert(tasks).values(
      asTaskInsert({ ...insert, ...mirror, id: newId(), createdAt: ctx.now(), updatedAt: ctx.now() }),
    );
    ctx.counters.pulled += 1;
    return;
  }

  const remoteChanged = remoteChangedSince(existing.externalEtag, remote.etag);
  const dirty = isDirtyState(existing.syncState);

  if (dirty && remoteChanged) {
    await resolveTaskConflict(ctx, existing, values, pickRemoteModifiedAt(parsed.lastModifiedMs, parsed.dtstampMs), mirror);
    return;
  }
  if (dirty) return;
  if (!remoteChanged && existing.deletedAtMs === null) return;

  await db
    .update(tasks)
    .set(
      asTaskValues({
        ...pickDefined(values),
        // A task mirrored in a collection leaves the Inbox for good.
        calendarId: existing.calendarId ?? calendar.id,
        ...mirror,
        syncState: 'synced',
        deletedAtMs: null,
        updatedAt: ctx.now(),
      }),
    )
    .where(eq(tasks.id, existing.id));
  ctx.counters.pulled += 1;
}

/**
 * Remote deletions. `seenHrefs` is the complete href set of a full enumeration;
 * `null` means only the explicitly reported hrefs count (a delta run must never
 * infer a deletion from absence).
 */
async function applyRemoteDeletions(
  ctx: RunContext,
  calendar: CalendarRow,
  deletedHrefs: readonly string[],
  seenHrefs: Set<string> | null,
): Promise<void> {
  if (deletedHrefs.length === 0 && seenHrefs === null) return;
  const { db } = ctx;
  const reported = new Set(deletedHrefs);
  const now = ctx.now();
  const gone = (href: string | null): boolean => {
    if (href === null) return false;
    return seenHrefs ? !seenHrefs.has(href) : reported.has(href);
  };

  const eventRows = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.calendarId, calendar.id), isNotNull(calendarEvents.externalHref)));
  for (const row of eventRows) {
    if (!gone(row.externalHref)) continue;
    await tombstone(ctx, {
      entityType: 'event',
      entityId: row.id,
      entityTitle: row.summary,
      href: row.externalHref,
      alreadyDeleted: row.deletedAtMs !== null,
      syncState: row.syncState,
      snapshot: eventAuditSnapshot(row),
      apply: async () => {
        await db
          .update(calendarEvents)
          .set({ deletedAtMs: row.deletedAtMs ?? now, syncState: 'synced', lastSyncedAtMs: now, updatedAt: now })
          .where(eq(calendarEvents.id, row.id));
      },
    });
  }

  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.calendarId, calendar.id), isNotNull(tasks.externalHref)));
  for (const row of taskRows) {
    if (!gone(row.externalHref)) continue;
    await tombstone(ctx, {
      entityType: 'task',
      entityId: row.id,
      entityTitle: row.title,
      href: row.externalHref,
      alreadyDeleted: row.deletedAtMs !== null,
      syncState: row.syncState,
      snapshot: taskAuditSnapshot(row),
      apply: async () => {
        await db
          .update(tasks)
          .set({ deletedAtMs: row.deletedAtMs ?? now, syncState: 'synced', lastSyncedAtMs: now, updatedAt: now })
          .where(eq(tasks.id, row.id));
      },
    });
  }
}

async function tombstone(
  ctx: RunContext,
  entry: {
    entityType: 'event' | 'task';
    entityId: string;
    entityTitle: string | null;
    href: string | null;
    alreadyDeleted: boolean;
    syncState: SyncState;
    snapshot: Record<string, unknown>;
    apply(): Promise<void>;
  },
): Promise<void> {
  if (entry.alreadyDeleted) return;
  if (isDirtyState(entry.syncState)) {
    // A local edit collided with a remote delete. CalDAV gives a deletion no
    // timestamp, so the remote side is authoritative — but the decision is
    // audited like any other conflict.
    const { resolution, reason } = resolveRemoteDeletion();
    await recordConflict(ctx, {
      entityType: entry.entityType,
      entityId: entry.entityId,
      entityTitle: entry.entityTitle,
      resolution,
      localSnapshot: entry.snapshot,
      remoteSnapshot: { href: entry.href, note: reason },
    });
  }
  // `pending_delete` already agrees with the remote side; both end up 'synced'
  // so `purgeExpiredTombstones` may eventually reclaim the row.
  await entry.apply();
  ctx.counters.deletedLocal += 1;
}

/* -------------------------------------------------------------------------- */
/* conflict resolution                                                        */
/* -------------------------------------------------------------------------- */

async function recordConflict(
  ctx: RunContext,
  entry: {
    entityType: 'event' | 'task';
    entityId: string;
    entityTitle: string | null;
    resolution: ConflictResolution;
    localSnapshot: unknown;
    remoteSnapshot: unknown;
  },
): Promise<void> {
  await ctx.db.insert(syncConflicts).values({
    id: newId(),
    userId: ctx.account.userId,
    accountId: ctx.account.id,
    entityType: entry.entityType,
    entityId: entry.entityId,
    entityTitle: entry.entityTitle,
    resolution: entry.resolution,
    localSnapshot: entry.localSnapshot,
    remoteSnapshot: entry.remoteSnapshot,
    resolvedAtMs: ctx.now(),
  });
  ctx.counters.conflicts += 1;
}

function conflictFor(
  existing: { syncState: SyncState; updatedAt: number; deletedAtMs: number | null },
  local: Record<string, unknown>,
  remoteValues: Record<string, unknown>,
  remoteModifiedAtMs: number | null,
  preferred: readonly string[],
): ConflictOutcome {
  if (existing.syncState === 'pending_delete') {
    // A tombstone cannot be merged field-wise: one intent wins wholesale.
    return resolvePendingDeleteConflict({
      localDeletedAtMs: existing.deletedAtMs ?? existing.updatedAt,
      remoteModifiedAtMs,
      remoteValues: pickDefined(remoteValues),
    });
  }
  return resolveConflict({
    local,
    localUpdatedAtMs: existing.updatedAt,
    remote: remoteValues,
    remoteModifiedAtMs,
    locallyPreferred: preferred,
  });
}

/** Pull-side conflict: the local row is dirty and the remote object changed. */
async function resolveEventConflict(
  ctx: RunContext,
  existing: CalendarEventRow,
  remoteValues: Record<string, unknown>,
  remoteModifiedAtMs: number | null,
  mirror: MirrorBookkeeping,
): Promise<void> {
  const outcome = conflictFor(existing, eventMergeView(existing), remoteValues, remoteModifiedAtMs, EVENT_LOCALLY_PREFERRED_FIELDS);
  await recordConflict(ctx, {
    entityType: 'event',
    entityId: existing.id,
    entityTitle: existing.summary,
    resolution: outcome.resolution,
    localSnapshot: eventAuditSnapshot(existing),
    remoteSnapshot: pickDefined(remoteValues),
  });

  if (outcome.resolution === 'remote-wins') {
    await ctx.db
      .update(calendarEvents)
      .set(
        asEventValues({ ...pickDefined(remoteValues), ...mirror, syncState: 'synced', deletedAtMs: null, updatedAt: ctx.now() }),
      )
      .where(eq(calendarEvents.id, existing.id));
    ctx.counters.pulled += 1;
    return;
  }

  if (existing.syncState === 'pending_delete') {
    // The local delete survives: keep the tombstone so the push deletes it.
    await ctx.db
      .update(calendarEvents)
      .set({ externalHref: mirror.externalHref, externalEtag: mirror.externalEtag })
      .where(eq(calendarEvents.id, existing.id));
    return;
  }

  // The local edit (or the merged result) survives and must be pushed, so the
  // row stays dirty — with the *fresh* remote ETag, or the PUT would 412 again.
  await ctx.db
    .update(calendarEvents)
    .set(asEventValues({ ...pickDefined(outcome.values), ...mirror, syncState: 'dirty', updatedAt: ctx.now() }))
    .where(eq(calendarEvents.id, existing.id));
}

async function resolveTaskConflict(
  ctx: RunContext,
  existing: TaskRow,
  remoteValues: Record<string, unknown>,
  remoteModifiedAtMs: number | null,
  mirror: MirrorBookkeeping,
): Promise<void> {
  const outcome = conflictFor(existing, taskMergeView(existing), remoteValues, remoteModifiedAtMs, TASK_LOCALLY_PREFERRED_FIELDS);
  await recordConflict(ctx, {
    entityType: 'task',
    entityId: existing.id,
    entityTitle: existing.title,
    resolution: outcome.resolution,
    localSnapshot: taskAuditSnapshot(existing),
    remoteSnapshot: pickDefined(remoteValues),
  });

  if (outcome.resolution === 'remote-wins') {
    await ctx.db
      .update(tasks)
      .set(
        asTaskValues({ ...pickDefined(remoteValues), ...mirror, syncState: 'synced', deletedAtMs: null, updatedAt: ctx.now() }),
      )
      .where(eq(tasks.id, existing.id));
    ctx.counters.pulled += 1;
    return;
  }

  if (existing.syncState === 'pending_delete') {
    await ctx.db
      .update(tasks)
      .set({ externalHref: mirror.externalHref, externalEtag: mirror.externalEtag })
      .where(eq(tasks.id, existing.id));
    return;
  }

  await ctx.db
    .update(tasks)
    .set(asTaskValues({ ...pickDefined(outcome.values), ...mirror, syncState: 'dirty', updatedAt: ctx.now() }))
    .where(eq(tasks.id, existing.id));
}

/* -------------------------------------------------------------------------- */
/* push                                                                       */
/* -------------------------------------------------------------------------- */

async function pushCalendar(ctx: RunContext, calendar: CalendarRow, href: string): Promise<void> {
  const { db } = ctx;
  const eventRows = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.calendarId, calendar.id), inArray(calendarEvents.syncState, ['dirty', 'pending_delete'])));
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.calendarId, calendar.id), inArray(tasks.syncState, ['dirty', 'pending_delete'])));

  let firstError: string | null = null;
  for (const row of eventRows) {
    try {
      await pushEventRow(ctx, href, row);
    } catch (error) {
      // One rejected object must not stop the rest of the collection.
      firstError ??= describeError(error, ctx.secrets);
    }
  }
  for (const row of taskRows) {
    try {
      await pushTaskRow(ctx, href, row);
    } catch (error) {
      firstError ??= describeError(error, ctx.secrets);
    }
  }
  if (firstError) throw new Error(firstError);
}

async function pushEventRow(ctx: RunContext, collectionHref: string, row: CalendarEventRow): Promise<void> {
  const { db, client } = ctx;

  if (row.syncState === 'pending_delete') {
    if (row.externalHref) {
      try {
        await client.deleteObject(row.externalHref, row.externalEtag);
      } catch (error) {
        if (!isNotFound(error)) throw error; // 404 == already gone == success
      }
      ctx.counters.deletedRemote += 1;
    } else {
      // Never mirrored remotely: nothing to propagate.
      ctx.counters.deletedLocal += 1;
    }
    await db
      .update(calendarEvents)
      .set({ syncState: 'synced', lastSyncedAtMs: ctx.now(), updatedAt: ctx.now() })
      .where(eq(calendarEvents.id, row.id));
    return;
  }

  const sequence = (row.remoteSequence ?? 0) + 1;
  const resourceHref = row.externalHref ?? deriveObjectHref(collectionHref, row.uid, row.recurrenceId);
  const ics = buildEventIcs(row, { sequence, nowMs: ctx.now() });
  const options: PutOptions = row.externalHref
    ? row.externalEtag
      ? { etag: row.externalEtag }
      : {}
    : { ifNoneMatch: true };

  try {
    const result = await client.putObject(resourceHref, ics, options);
    await settleEventPush(ctx, row, result.href || resourceHref, result.etag, sequence);
    ctx.counters.pushed += 1;
  } catch (error) {
    if (!isPreconditionFailed(error) && !isNotFound(error)) throw error;
    await pushEventConflict(ctx, row, resourceHref, ics, sequence);
  }
}

async function pushTaskRow(ctx: RunContext, collectionHref: string, row: TaskRow): Promise<void> {
  const { db, client } = ctx;

  if (row.syncState === 'pending_delete') {
    if (row.externalHref) {
      try {
        await client.deleteObject(row.externalHref, row.externalEtag);
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
      ctx.counters.deletedRemote += 1;
    } else {
      ctx.counters.deletedLocal += 1;
    }
    await db
      .update(tasks)
      .set({ syncState: 'synced', lastSyncedAtMs: ctx.now(), updatedAt: ctx.now() })
      .where(eq(tasks.id, row.id));
    return;
  }

  const sequence = (row.remoteSequence ?? 0) + 1;
  const uid = row.externalUid ?? row.id;
  const resourceHref = row.externalHref ?? deriveObjectHref(collectionHref, uid);
  const ics = buildTaskIcs(row, { sequence, nowMs: ctx.now() });
  const options: PutOptions = row.externalHref
    ? row.externalEtag
      ? { etag: row.externalEtag }
      : {}
    : { ifNoneMatch: true };

  try {
    const result = await client.putObject(resourceHref, ics, options);
    await settleTaskPush(ctx, row, uid, result.href || resourceHref, result.etag, sequence);
    ctx.counters.pushed += 1;
  } catch (error) {
    if (!isPreconditionFailed(error) && !isNotFound(error)) throw error;
    await pushTaskConflict(ctx, row, uid, resourceHref, ics, sequence);
  }
}

async function settleEventPush(
  ctx: RunContext,
  row: CalendarEventRow,
  href: string,
  etag: string | null,
  sequence: number,
  extra?: Record<string, unknown>,
): Promise<void> {
  const now = ctx.now();
  const changedLocally = extra !== undefined && Object.keys(extra).length > 0;
  await ctx.db
    .update(calendarEvents)
    .set(
      asEventValues({
        ...(extra ?? {}),
        externalHref: href,
        externalEtag: etag ?? row.externalEtag,
        remoteSequence: sequence,
        remoteLastModified: new Date(now).toISOString(),
        syncState: 'synced',
        lastSyncedAtMs: now,
        ...(changedLocally ? { updatedAt: now } : {}),
      }),
    )
    .where(eq(calendarEvents.id, row.id));
}

async function settleTaskPush(
  ctx: RunContext,
  row: TaskRow,
  uid: string,
  href: string,
  etag: string | null,
  sequence: number,
  extra?: Record<string, unknown>,
): Promise<void> {
  const now = ctx.now();
  const changedLocally = extra !== undefined && Object.keys(extra).length > 0;
  await ctx.db
    .update(tasks)
    .set(
      asTaskValues({
        ...(extra ?? {}),
        externalUid: row.externalUid ?? uid,
        externalHref: href,
        externalEtag: etag ?? row.externalEtag,
        remoteSequence: sequence,
        remoteLastModified: new Date(now).toISOString(),
        syncState: 'synced',
        lastSyncedAtMs: now,
        ...(changedLocally ? { updatedAt: now } : {}),
      }),
    )
    .where(eq(tasks.id, row.id));
}

/**
 * A PUT rejected with `412 Precondition Failed` means someone else wrote the
 * object first. Re-read it and run the *same* deterministic resolution the pull
 * path uses, instead of failing the whole run.
 */
async function pushEventConflict(
  ctx: RunContext,
  row: CalendarEventRow,
  href: string,
  ics: string,
  sequence: number,
): Promise<void> {
  const remote = await ctx.client.getObject(href);

  if (!remote) {
    // The object is gone: the local edit is the only surviving intent.
    await recordConflict(ctx, {
      entityType: 'event',
      entityId: row.id,
      entityTitle: row.summary,
      resolution: 'local-wins',
      localSnapshot: eventAuditSnapshot(row),
      remoteSnapshot: { href, missing: true },
    });
    const created = await ctx.client.putObject(href, ics, { ifNoneMatch: true });
    await settleEventPush(ctx, row, created.href || href, created.etag, sequence);
    ctx.counters.pushed += 1;
    return;
  }

  const parsed = pickEventComponent(remote, row.recurrenceId);
  if (!parsed) throw new Error(`remote object ${href} is not a VEVENT`);

  const remoteValues = eventValuesFromParsed(parsed, {
    userId: ctx.account.userId,
    calendarId: row.calendarId,
    timezone: row.timezone,
    rawIcs: remote.data,
  });  const outcome = conflictFor(
    row,
    eventMergeView(row),
    remoteValues,
    pickRemoteModifiedAt(parsed.lastModifiedMs, parsed.dtstampMs),
    EVENT_LOCALLY_PREFERRED_FIELDS,
  );

  await recordConflict(ctx, {
    entityType: 'event',
    entityId: row.id,
    entityTitle: row.summary,
    resolution: outcome.resolution,
    localSnapshot: eventAuditSnapshot(row),
    remoteSnapshot: pickDefined(remoteValues),
  });

  const mirror = mirrorBookkeeping(ctx.now(), remote, {
    sequence: parsed.sequence,
    lastModified: formatRemoteLastModified(parsed.lastModifiedMs),
  });

  if (outcome.resolution === 'remote-wins') {
    await ctx.db
      .update(calendarEvents)
      .set(
        asEventValues({ ...pickDefined(remoteValues), ...mirror, syncState: 'synced', deletedAtMs: null, updatedAt: ctx.now() }),
      )
      .where(eq(calendarEvents.id, row.id));
    ctx.counters.pulled += 1;
    return;
  }

  // The winner is local: re-PUT it with `If-Match` on the ETag we just read, so
  // the retry cannot silently lose another race.
  const winner = { ...row, ...asEventValues({ ...pickDefined(outcome.values), ...mirror }) } as CalendarEventRow;
  const retrySequence = sequence + 1;
  const result = await ctx.client.putObject(
    href,
    buildEventIcs(winner, { sequence: retrySequence, nowMs: ctx.now() }),
    remote.etag ? { etag: remote.etag } : {},
  );
  await settleEventPush(ctx, row, result.href || href, result.etag, retrySequence, pickDefined(outcome.values));
  ctx.counters.pushed += 1;
}

async function pushTaskConflict(
  ctx: RunContext,
  row: TaskRow,
  uid: string,
  href: string,
  ics: string,
  sequence: number,
): Promise<void> {
  const remote = await ctx.client.getObject(href);

  if (!remote) {
    await recordConflict(ctx, {
      entityType: 'task',
      entityId: row.id,
      entityTitle: row.title,
      resolution: 'local-wins',
      localSnapshot: taskAuditSnapshot(row),
      remoteSnapshot: { href, missing: true },
    });
    const created = await ctx.client.putObject(href, ics, { ifNoneMatch: true });
    await settleTaskPush(ctx, row, uid, created.href || href, created.etag, sequence);
    ctx.counters.pushed += 1;
    return;
  }

  const parsed = pickTodoComponent(remote);
  if (!parsed) throw new Error(`remote object ${href} is not a VTODO`);

  const remoteValues = taskValuesFromParsed(parsed, {
    userId: ctx.account.userId,
    calendarId: row.calendarId,
    timezone: row.timezone ?? 'UTC',
    rawIcs: remote.data,
  });
  const outcome = conflictFor(
    row,
    taskMergeView(row),
    remoteValues,
    pickRemoteModifiedAt(parsed.lastModifiedMs, parsed.dtstampMs),
    TASK_LOCALLY_PREFERRED_FIELDS,
  );

  await recordConflict(ctx, {
    entityType: 'task',
    entityId: row.id,
    entityTitle: row.title,
    resolution: outcome.resolution,
    localSnapshot: taskAuditSnapshot(row),
    remoteSnapshot: pickDefined(remoteValues),
  });

  const mirror = mirrorBookkeeping(ctx.now(), remote, {
    sequence: parsed.sequence,
    lastModified: formatRemoteLastModified(parsed.lastModifiedMs),
  });

  if (outcome.resolution === 'remote-wins') {
    await ctx.db
      .update(tasks)
      .set(asTaskValues({ ...pickDefined(remoteValues), ...mirror, syncState: 'synced', deletedAtMs: null, updatedAt: ctx.now() }))
      .where(eq(tasks.id, row.id));
    ctx.counters.pulled += 1;
    return;
  }

  const winner = { ...row, ...asTaskValues({ ...pickDefined(outcome.values), ...mirror }) } as TaskRow;
  const retrySequence = sequence + 1;
  const result = await ctx.client.putObject(
    href,
    buildTaskIcs(winner, { sequence: retrySequence, nowMs: ctx.now() }),
    remote.etag ? { etag: remote.etag } : {},
  );
  await settleTaskPush(ctx, row, uid, result.href || href, result.etag, retrySequence, pickDefined(outcome.values));
  ctx.counters.pushed += 1;
}

/** The VEVENT component of `remote` that belongs to `recurrenceId`. */
function pickEventComponent(remote: RemoteObject, recurrenceId: string | null): ParsedEvent | null {
  const events = parseRemoteObject(remote).filter((component): component is ParsedEvent => component.kind === 'event');
  return events.find((component) => (component.event.recurrenceId ?? null) === recurrenceId) ?? events[0] ?? null;
}

function pickTodoComponent(remote: RemoteObject): ParsedTodo | null {
  return parseRemoteObject(remote).find((component): component is ParsedTodo => component.kind === 'todo') ?? null;
}
