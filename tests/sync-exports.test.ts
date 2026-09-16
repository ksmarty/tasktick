/**
 * The export surface of `src/server/sync` is a contract: routes, the
 * instrumentation hook and the CalDAV transport all compile against it. This
 * suite pins the six required signatures at compile time and makes sure the
 * barrel really re-exports live functions (not types or re-export aliases).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncResult } from '@/lib/types';
import {
  discoverAccountCalendars,
  purgeExpiredTombstones,
  startSyncScheduler,
  stopSyncScheduler,
  syncAccount,
  syncAllDueAccounts,
} from '@/server/sync';
import { disposeTempDatabase, useTempDatabase } from './sync-helpers';

/** The frozen public surface, spelled exactly as the contract documents it. */
interface SyncEngineSurface {
  syncAccount(
    accountId: string,
    opts?: { kind?: 'full' | 'incremental' | 'push'; calendarId?: string; trigger?: 'manual' | 'scheduled' | 'initial' },
  ): Promise<SyncResult>;
  syncAllDueAccounts(now?: number): Promise<SyncResult[]>;
  discoverAccountCalendars(accountId: string): Promise<SyncResult>;
  startSyncScheduler(): void;
  stopSyncScheduler(): void;
  purgeExpiredTombstones(olderThanMs?: number): Promise<number>;
}

const surface: SyncEngineSurface = {
  syncAccount,
  syncAllDueAccounts,
  discoverAccountCalendars,
  startSyncScheduler,
  stopSyncScheduler,
  purgeExpiredTombstones,
};

describe('public export surface', () => {
  let databaseFile = '';

  beforeEach(async () => {
    databaseFile = await useTempDatabase();
  });

  afterEach(async () => {
    stopSyncScheduler();
    await disposeTempDatabase(databaseFile);
  });

  it('exports the six documented functions', () => {
    for (const [name, value] of Object.entries(surface)) {
      expect(typeof value, `${name} must be a function`).toBe('function');
    }
  });

  it('reports skipped for an account that does not exist instead of throwing', async () => {
    const result = await surface.syncAccount('does-not-exist');
    expect(result.status).toBe('skipped');
    expect(result.kind).toBe('incremental');
    expect(result.error).toBeTruthy();

    const discovery = await surface.discoverAccountCalendars('does-not-exist');
    expect(discovery).toMatchObject({ kind: 'discover', status: 'skipped' });
  });

  it('stops the scheduler even when it was never started', () => {
    stopSyncScheduler();
    stopSyncScheduler();
    expect(true).toBe(true);
  });
});
