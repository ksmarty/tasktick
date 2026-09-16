/**
 * Shared harness for the sync suites: a real SQLite file in the OS temp dir
 * (migrated with the project's own migrations) plus an in-memory fake of the
 * `CalDavClient` interface.
 *
 * The tests exercise the *policy* layer against the real transport codec
 * (`parseIcsObject` / `serializeEvent` / `serializeTodo`) but never touch the
 * network: the fake implements the whole `CalDavClient` contract in memory.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { resetEnvCache } from '@/lib/env';
import type { Priority, SyncState, TaskStatus } from '@/lib/types';
import { CalDavNotFoundError, CalDavPreconditionFailedError } from '@/server/caldav';
import type {
  CalDavClient,
  PrincipalInfo,
  PutOptions,
  PutResult,
  RemoteCalendar,
  RemoteObject,
  SyncCollectionDelta,
} from '@/server/caldav';
import { encryptField, newId } from '@/server/crypto';
import { closeDb } from '@/server/db';
import { resetDialectCache } from '@/server/db/dialect';
import { caldavAccounts, calendarEvents, calendars, syncConflicts, syncLogs, tasks, user } from '@/server/db/schema';
import type { CalendarEventRow, TaskRow } from '@/server/db/schema';
import { openSyncDb } from '@/server/sync/engine';
import { resetSyncLocks } from '@/server/sync/locks';

export const ACCOUNT_PASSWORD = 'app-specific-password';

/** Points `DATABASE_URL` at a fresh temp file, migrates it, resets module caches. */
export async function useTempDatabase(): Promise<string> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-sync-'));
  const file = path.join(dir, 'sync.db');

  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0001';
  process.env.SYNC_ENABLED = 'true';
  process.env.SYNC_TICK_SECONDS = '5';
  process.env.SYNC_MAX_ITEMS_PER_RUN = '2000';

  resetEnvCache();
  resetDialectCache();
  resetSyncLocks();
  await closeDb();

  const handle = new Database(file);
  try {
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    migrate(drizzle(handle), { migrationsFolder: path.join(process.cwd(), 'drizzle', 'sqlite') });
  } finally {
    handle.close();
  }

  return file;
}

export async function disposeTempDatabase(file: string): Promise<void> {
  await closeDb();
  resetSyncLocks();
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
}

/* -------------------------------------------------------------------------- */
/* seeding                                                                    */
/* -------------------------------------------------------------------------- */

export interface SeededAccount {
  accountId: string;
  userId: string;
}

export async function seedAccount(
  overrides: Partial<{ direction: string; intervalMinutes: number; enabled: boolean; username: string }> = {},
): Promise<SeededAccount> {
  const db = await openSyncDb();
  const userId = newId();
  const accountId = newId();

  await db.insert(user).values({
    id: userId,
    name: 'Sync Tester',
    email: `${userId}@example.test`,
    emailVerified: true,
    timezone: 'UTC',
  });
  await db.insert(caldavAccounts).values({
    id: accountId,
    userId,
    name: 'iCloud',
    serverUrl: 'https://caldav.example.test',
    username: overrides.username ?? 'tester@example.test',
    passwordEncrypted: encryptField(ACCOUNT_PASSWORD),
    enabled: overrides.enabled ?? true,
    syncIntervalMinutes: overrides.intervalMinutes ?? 15,
    direction: overrides.direction ?? 'auto',
  });

  return { accountId, userId };
}

export async function seedCalendar(
  account: SeededAccount,
  overrides: Partial<{
    id: string;
    name: string;
    remoteHref: string;
    remoteSyncToken: string | null;
    supportsVtodo: boolean;
    readOnly: boolean;
    timezone: string;
  }> = {},
): Promise<string> {
  const db = await openSyncDb();
  const id = overrides.id ?? newId();
  await db.insert(calendars).values({
    id,
    userId: account.userId,
    name: overrides.name ?? 'Home',
    provider: 'caldav',
    caldavAccountId: account.accountId,
    remoteHref: overrides.remoteHref ?? 'https://caldav.example.test/calendars/home/',
    remoteSyncToken: overrides.remoteSyncToken ?? null,
    supportsVtodo: overrides.supportsVtodo ?? true,
    readOnly: overrides.readOnly ?? false,
    timezone: overrides.timezone ?? 'UTC',
  });
  return id;
}

/* -------------------------------------------------------------------------- */
/* local rows (the "already mirrored" half of the world)                      */
/* -------------------------------------------------------------------------- */

export interface LocalTaskSeed {
  title?: string;
  notes?: string | null;
  status?: TaskStatus;
  priority?: Priority;
  dueAtMs?: number | null;
  syncState?: SyncState;
  externalUid?: string | null;
  externalHref?: string | null;
  externalEtag?: string | null;
  remoteSequence?: number | null;
  updatedAt?: number;
  deletedAtMs?: number | null;
}

export async function seedLocalTask(
  account: SeededAccount,
  calendarId: string | null,
  seed: LocalTaskSeed = {},
): Promise<string> {
  const db = await openSyncDb();
  const id = newId();
  await db.insert(tasks).values({
    id,
    userId: account.userId,
    calendarId,
    title: seed.title ?? 'Local task',
    notes: seed.notes ?? null,
    status: seed.status ?? 'todo',
    priority: seed.priority ?? 'none',
    dueAtMs: seed.dueAtMs ?? null,
    isAllDay: false,
    timezone: 'UTC',
    syncProvider: seed.externalUid ? 'caldav' : 'local',
    syncState: seed.syncState ?? 'synced',
    externalUid: seed.externalUid ?? null,
    externalHref: seed.externalHref ?? null,
    externalEtag: seed.externalEtag ?? null,
    remoteSequence: seed.remoteSequence ?? null,
    updatedAt: seed.updatedAt ?? Date.now(),
    deletedAtMs: seed.deletedAtMs ?? null,
  } as typeof tasks.$inferInsert);
  return id;
}

export interface LocalEventSeed {
  uid?: string;
  recurrenceId?: string | null;
  summary?: string;
  description?: string | null;
  startMs?: number | null;
  endMs?: number | null;
  syncState?: SyncState;
  externalHref?: string | null;
  externalEtag?: string | null;
  remoteSequence?: number | null;
  updatedAt?: number;
  deletedAtMs?: number | null;
}

export async function seedLocalEvent(
  account: SeededAccount,
  calendarId: string,
  seed: LocalEventSeed = {},
): Promise<string> {
  const db = await openSyncDb();
  const id = newId();
  await db.insert(calendarEvents).values({
    id,
    userId: account.userId,
    calendarId,
    uid: seed.uid ?? `uid-${id}`,
    recurrenceId: seed.recurrenceId ?? null,
    summary: seed.summary ?? 'Local event',
    description: seed.description ?? null,
    startMs: seed.startMs ?? Date.parse('2024-03-05T10:00:00Z'),
    endMs: seed.endMs ?? Date.parse('2024-03-05T10:30:00Z'),
    isAllDay: false,
    timezone: 'UTC',
    status: 'confirmed',
    transparency: 'opaque',
    syncProvider: 'caldav',
    syncState: seed.syncState ?? 'synced',
    externalHref: seed.externalHref ?? null,
    externalEtag: seed.externalEtag ?? null,
    remoteSequence: seed.remoteSequence ?? null,
    updatedAt: seed.updatedAt ?? Date.now(),
    deletedAtMs: seed.deletedAtMs ?? null,
  } as typeof calendarEvents.$inferInsert);
  return id;
}

export async function getTaskRow(id: string): Promise<TaskRow> {
  const db = await openSyncDb();
  const [row] = await db.select().from(tasks).where(eq(tasks.id, id));
  if (!row) throw new Error(`task ${id} not found`);
  return row;
}

export async function getEventRow(id: string): Promise<CalendarEventRow> {
  const db = await openSyncDb();
  const [row] = await db.select().from(calendarEvents).where(eq(calendarEvents.id, id));
  if (!row) throw new Error(`event ${id} not found`);
  return row;
}

export async function getCalendarRow(id: string) {
  const db = await openSyncDb();
  const [row] = await db.select().from(calendars).where(eq(calendars.id, id));
  if (!row) throw new Error(`calendar ${id} not found`);
  return row;
}

export async function getAccountRow(id: string) {
  const db = await openSyncDb();
  const [row] = await db.select().from(caldavAccounts).where(eq(caldavAccounts.id, id));
  if (!row) throw new Error(`account ${id} not found`);
  return row;
}

export async function listConflicts(userId: string) {
  const db = await openSyncDb();
  return await db.select().from(syncConflicts).where(eq(syncConflicts.userId, userId));
}

export async function listLogs(accountId: string) {
  const db = await openSyncDb();
  return await db.select().from(syncLogs).where(eq(syncLogs.accountId, accountId));
}

/* -------------------------------------------------------------------------- */
/* in-memory CalDAV server                                                    */
/* -------------------------------------------------------------------------- */

interface FakeStoredObject {
  data: string;
  etag: string;
  lastModifiedMs: number;
}

interface FakeCollection {
  meta: RemoteCalendar;
  objects: Map<string, FakeStoredObject>;
  /** Monotonic revision, used to synthesise RFC 6578 deltas. */
  version: number;
  /** `version -> touched href`; a href is reported only at its last touch. */
  log: { version: number; href: string }[];
}

/** Tracks how many requests are in flight, for the "never concurrent" test. */
export interface ConcurrencyProbe {
  active: number;
  max: number;
}

export interface FakeClientOptions {
  /** Artificial latency per request, in ms. */
  delayMs?: number;
  concurrency?: ConcurrencyProbe;
}

export class FakeCalDavClient implements CalDavClient {
  readonly collections = new Map<string, FakeCollection>();
  readonly putCalls: { href: string; options: PutOptions | undefined; ics: string }[] = [];
  readonly deleteCalls: { href: string; etag: string | null | undefined }[] = [];
  readonly syncCalls: { href: string; token: string | null }[] = [];

  /** Every method invoked, in order — lets a test assert how often a run talks. */
  readonly calls: string[] = [];
  /** Makes the next `syncCollection` answer with `truncated: true`. */
  truncatedNextSync = false;
  /** Thrown by every request when set — simulates auth/network failure. */
  failWith: Error | null = null;

  private etagSeed = 0;
  private readonly options: FakeClientOptions;

  constructor(options: FakeClientOptions = {}) {
    this.options = options;
  }

  /* ---- test-side helpers ---- */

  addCollection(meta: Partial<RemoteCalendar> & { href: string }): void {
    this.collections.set(meta.href, {
      meta: {
        displayName: meta.displayName ?? 'Calendar',
        color: meta.color ?? null,
        description: meta.description ?? null,
        supportedComponents: meta.supportedComponents ?? ['VEVENT', 'VTODO'],
        readOnly: meta.readOnly ?? false,
        timezone: meta.timezone ?? 'UTC',
        ctag: meta.ctag ?? null,
        syncToken: meta.syncToken ?? null,
        href: meta.href,
      },
      objects: new Map(),
      version: 0,
      log: [],
    });
  }

  private collection(href: string): FakeCollection {
    const collection = this.collections.get(href);
    if (!collection) throw new CalDavNotFoundError(`unknown collection ${href}`, { status: 404, method: 'GET', url: href });
    return collection;
  }

  /** Stores/overwrites an object as if another client had written it. */
  seedObject(href: string, data: string, etag?: string): string {
    const collection = this.collectionForResource(href);
    const nextEtag = etag ?? this.nextEtag();
    this.touch(collection, href, { data, etag: nextEtag, lastModifiedMs: Date.now() });
    return nextEtag;
  }

  removeObject(href: string): void {
    const collection = this.collectionForResource(href);
    collection.objects.delete(href);
    this.touch(collection, href, null);
  }

  objectData(href: string): string | undefined {
    for (const collection of this.collections.values()) {
      const object = collection.objects.get(href);
      if (object) return object.data;
    }
    return undefined;
  }

  objectEtag(href: string): string | undefined {
    for (const collection of this.collections.values()) {
      const object = collection.objects.get(href);
      if (object) return object.etag;
    }
    return undefined;
  }

  /** Current sync token, i.e. what the engine should have persisted. */
  syncToken(href: string): string {
    return `token-${this.collection(href).version}`;
  }

  collectionObjects(href: string): Map<string, FakeStoredObject> {
    return this.collection(href).objects;
  }

  private nextEtag(): string {
    this.etagSeed += 1;
    return `"etag-${this.etagSeed}"`;
  }

  private touch(collection: FakeCollection, href: string, object: FakeStoredObject | null): void {
    collection.version += 1;
    if (object) collection.objects.set(href, object);
    else collection.objects.delete(href);
    collection.log.push({ version: collection.version, href });
    collection.meta.ctag = `ctag-${collection.version}`;
  }

  private async request<T>(method: string, work: () => T): Promise<T> {
    this.calls.push(method);
    const probe = this.options.concurrency;
    if (probe) probe.active += 1;
    if (probe && probe.active > probe.max) probe.max = probe.active;
    try {
      if (this.options.delayMs) await new Promise((resolve) => setTimeout(resolve, this.options.delayMs));
      if (this.failWith) throw this.failWith;
      return work();
    } finally {
      if (probe) probe.active -= 1;
    }
  }

  /* ---- CalDavClient ---- */

  async testConnection(): Promise<PrincipalInfo> {
    return this.request('testConnection', () => ({
      principalUrl: 'https://caldav.example.test/principal/',
      calendarHomeUrl: 'https://caldav.example.test/calendars/',
      displayName: 'Sync Tester',
    }));
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    return this.request('listCalendars', () => [...this.collections.values()].map((collection) => ({ ...collection.meta })));
  }

  async syncCollection(href: string, syncToken: string | null): Promise<SyncCollectionDelta> {
    return this.request('syncCollection', () => {
      this.syncCalls.push({ href, token: syncToken });
      const collection = this.collection(href);
      if (this.truncatedNextSync) {
        this.truncatedNextSync = false;
        return { syncToken: null, changed: [], deleted: [], truncated: true };
      }
      const fromVersion = syncToken ? Number.parseInt(syncToken.replace('token-', ''), 10) || 0 : 0;
      const touched = new Set<string>();
      for (const entry of collection.log) {
        if (entry.version > fromVersion) touched.add(entry.href);
      }
      const changed: RemoteObject[] = [];
      const deleted: string[] = [];
      for (const touchedHref of touched) {
        const object = collection.objects.get(touchedHref);
        if (object) changed.push({ href: touchedHref, etag: object.etag, data: object.data });
        else deleted.push(touchedHref);
      }
      return { syncToken: this.syncToken(href), changed, deleted, truncated: false };
    });
  }

  async listObjects(href: string): Promise<RemoteObject[]> {
    return this.request('listObjects', () => {
      const collection = this.collection(href);
      return [...collection.objects.entries()].map(([objectHref, object]) => ({
        href: objectHref,
        etag: object.etag,
        data: object.data,
      }));
    });
  }

  async getObject(href: string): Promise<RemoteObject | null> {
    return this.request('getObject', () => {
      for (const collection of this.collections.values()) {
        const object = collection.objects.get(href);
        if (object) return { href, etag: object.etag, data: object.data };
      }
      return null;
    });
  }

  async queryObjects(href: string): Promise<RemoteObject[]> {
    return this.listObjects(href);
  }

  async getCtag(href: string): Promise<string | null> {
    return this.request('getCtag', () => this.collection(href).meta.ctag);
  }

  async putObject(href: string, ics: string, options?: PutOptions): Promise<PutResult> {
    return this.request('putObject', () => {
      this.putCalls.push({ href, options, ics });
      const collection = this.collectionForResource(href);
      const existing = collection.objects.get(href);
      if (options?.ifNoneMatch && existing) {
        throw new CalDavPreconditionFailedError('object already exists', { status: 412, method: 'PUT', url: href });
      }
      if (options?.etag && existing && existing.etag !== options.etag) {
        throw new CalDavPreconditionFailedError('etag mismatch', { status: 412, method: 'PUT', url: href });
      }
      if (options?.etag && !existing) {
        throw new CalDavPreconditionFailedError('resource is gone', { status: 412, method: 'PUT', url: href });
      }
      const etag = this.nextEtag();
      this.touch(collection, href, { data: ics, etag, lastModifiedMs: Date.now() });
      return { href, etag };
    });
  }

  async deleteObject(href: string, etag?: string | null): Promise<void> {
    await this.request('deleteObject', () => {
      this.deleteCalls.push({ href, etag });
      const collection = this.collectionForResource(href);
      const existing = collection.objects.get(href);
      if (!existing) throw new CalDavNotFoundError('resource is gone', { status: 404, method: 'DELETE', url: href });
      if (etag && existing.etag !== etag) {
        throw new CalDavPreconditionFailedError('etag mismatch', { status: 412, method: 'DELETE', url: href });
      }
      this.touch(collection, href, null);
    });
  }

  async createCalendar(href: string, displayName: string): Promise<void> {
    this.addCollection({ href, displayName });
  }

  private collectionForResource(href: string): FakeCollection {
    const collectionHref = href.slice(0, href.lastIndexOf('/') + 1);
    return this.collection(collectionHref);
  }
}
