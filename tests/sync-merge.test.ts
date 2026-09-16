/**
 * The conflict policy is pure, so it is tested directly: no database, no client,
 * no clock. These cases pin the three decisions the engine relies on — newer
 * side wins, concurrent edits merge field-wise, and an undated remote loses.
 */
import { describe, expect, it } from 'vitest';
import {
  CONCURRENT_EDIT_WINDOW_MS,
  isConcurrentEdit,
  isDirtyState,
  locallyTouchedFields,
  pickDefined,
  pickRemoteModifiedAt,
  remoteChangedSince,
  resolveConflict,
  resolvePendingDeleteConflict,
  resolveRemoteDeletion,
} from '@/server/sync/merge';
import { effectiveIntervalMs, isAccountDue, FAILURE_BACKOFF_THRESHOLD, MAX_BACKOFF_MS } from '@/server/sync/scheduler';

const PREFERRED = ['title', 'notes', 'priority', 'dueAtMs', 'status'] as const;

const localRow = {
  title: 'Local title',
  notes: null,
  priority: 'high',
  dueAtMs: 1_700_000_000_000,
  status: 'todo',
};

const remoteValues = {
  title: 'Remote title',
  notes: 'remote notes',
  priority: 'low',
  dueAtMs: 1_700_000_100_000,
  status: 'completed',
};

describe('resolveConflict', () => {
  it('lets the strictly newer remote side win', () => {
    const outcome = resolveConflict({
      local: localRow,
      localUpdatedAtMs: 1_000,
      remote: remoteValues,
      remoteModifiedAtMs: 5_000,
      locallyPreferred: PREFERRED,
    });

    expect(outcome.resolution).toBe('remote-wins');
    expect(outcome.values.title).toBe('Remote title');
    expect(outcome.values.status).toBe('completed');
    expect(outcome.sources.title).toBe('remote');
  });

  it('lets the strictly newer local side win', () => {
    const outcome = resolveConflict({
      local: localRow,
      localUpdatedAtMs: 9_000,
      remote: remoteValues,
      remoteModifiedAtMs: 5_000,
      locallyPreferred: PREFERRED,
    });

    expect(outcome.resolution).toBe('local-wins');
    expect(outcome.values.title).toBe('Local title');
    expect(outcome.sources.title).toBe('local');
  });

  it('treats a remote without LAST-MODIFIED and DTSTAMP as the older side', () => {
    expect(pickRemoteModifiedAt(null, null)).toBeNull();
    const outcome = resolveConflict({
      local: localRow,
      localUpdatedAtMs: 1,
      remote: remoteValues,
      remoteModifiedAtMs: null,
      locallyPreferred: PREFERRED,
    });
    expect(outcome.resolution).toBe('local-wins');
  });

  it('falls back to DTSTAMP when LAST-MODIFIED is missing', () => {
    expect(pickRemoteModifiedAt(null, 4_242)).toBe(4_242);
  });

  it('merges field-wise for edits within the concurrency window, preferring locally touched fields', () => {
    const outcome = resolveConflict({
      local: localRow,
      localUpdatedAtMs: 10_000,
      remote: remoteValues,
      remoteModifiedAtMs: 10_000 + CONCURRENT_EDIT_WINDOW_MS,
      locallyPreferred: PREFERRED,
    });

    expect(outcome.resolution).toBe('merged');
    // Locally touched fields survive from the local side ...
    expect(outcome.values.title).toBe('Local title');
    expect(outcome.values.priority).toBe('high');
    expect(outcome.values.status).toBe('todo');
    expect(outcome.sources.title).toBe('local');
    // ... while fields the local side left null take the remote value.
    expect(outcome.values.notes).toBe('remote notes');
    expect(outcome.sources.notes).toBe('remote');
  });

  it('keeps a remote-only field during a merge', () => {
    const outcome = resolveConflict({
      local: { title: 'Local', location: null },
      localUpdatedAtMs: 2_000,
      remote: { title: 'Remote', location: 'Berlin' },
      remoteModifiedAtMs: 2_500,
      locallyPreferred: PREFERRED,
    });
    expect(outcome.resolution).toBe('merged');
    expect(outcome.values.location).toBe('Berlin');
  });

  it('is inclusive at the window boundary and strict beyond it', () => {
    const atBoundary = resolveConflict({
      local: { title: 'local' },
      localUpdatedAtMs: 0,
      remote: { title: 'remote' },
      remoteModifiedAtMs: CONCURRENT_EDIT_WINDOW_MS,
      locallyPreferred: PREFERRED,
    });
    expect(atBoundary.resolution).toBe('merged');

    const beyondBoundary = resolveConflict({
      local: { title: 'local' },
      localUpdatedAtMs: 0,
      remote: { title: 'remote' },
      remoteModifiedAtMs: CONCURRENT_EDIT_WINDOW_MS + 1,
      locallyPreferred: PREFERRED,
    });
    expect(beyondBoundary.resolution).toBe('remote-wins');
  });

  it('ignores undefined remote properties ("no opinion")', () => {
    const outcome = resolveConflict({
      local: { title: 'local', notes: 'kept' },
      localUpdatedAtMs: 10_000,
      remote: { title: 'remote', notes: undefined },
      remoteModifiedAtMs: 10_000,
      locallyPreferred: PREFERRED,
    });
    expect(outcome.resolution).toBe('merged');
    expect(outcome.values.notes).toBe('kept');
  });
});

describe('deletion policy', () => {
  it('does not merge a tombstone with a remote edit — the newer intent wins wholesale', () => {
    const remoteWins = resolvePendingDeleteConflict({
      localDeletedAtMs: 1_000,
      remoteModifiedAtMs: 5_000,
      remoteValues: { title: 'edited remotely' },
    });
    expect(remoteWins.resolution).toBe('remote-wins');
    expect(remoteWins.values.title).toBe('edited remotely');

    const localWins = resolvePendingDeleteConflict({
      localDeletedAtMs: 9_000,
      remoteModifiedAtMs: 5_000,
      remoteValues: { title: 'edited remotely' },
    });
    expect(localWins.resolution).toBe('local-wins');
    expect(localWins.values).toEqual({});
  });

  it('lets a remote deletion win over a local edit', () => {
    expect(resolveRemoteDeletion().resolution).toBe('remote-wins');
  });
});

describe('small predicates', () => {
  it('classifies dirty states', () => {
    expect(isDirtyState('dirty')).toBe(true);
    expect(isDirtyState('pending_delete')).toBe(true);
    expect(isDirtyState('synced')).toBe(false);
    expect(isDirtyState('conflict')).toBe(false);
  });

  it('detects a remote change by ETag, treating "no etag" as its own value', () => {
    expect(remoteChangedSince('"a"', '"b"')).toBe(true);
    expect(remoteChangedSince('"a"', '"a"')).toBe(false);
    expect(remoteChangedSince(null, '"a"')).toBe(true);
    expect(remoteChangedSince(null, null)).toBe(false);
  });

  it('lists the locally non-null preferred fields', () => {
    expect(locallyTouchedFields({ title: 'x', notes: null, priority: undefined }, PREFERRED)).toEqual(['title']);
  });

  it('drops undefined values only', () => {
    expect(pickDefined({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null });
  });

  it('compares edits within the window', () => {
    expect(isConcurrentEdit(1_000, 1_000 + CONCURRENT_EDIT_WINDOW_MS)).toBe(true);
    expect(isConcurrentEdit(1_000, null)).toBe(false);
  });
});

describe('scheduler due-ness', () => {
  it('uses the configured interval before the failure threshold', () => {
    expect(effectiveIntervalMs(15, 0)).toBe(15 * 60_000);
    expect(effectiveIntervalMs(15, FAILURE_BACKOFF_THRESHOLD - 1)).toBe(15 * 60_000);
  });

  it('doubles the interval per consecutive failure past the threshold', () => {
    const base = effectiveIntervalMs(15, 0);
    expect(effectiveIntervalMs(15, 3)).toBe(base * 2);
    expect(effectiveIntervalMs(15, 4)).toBe(base * 4);
    expect(effectiveIntervalMs(15, 5)).toBe(base * 8);
  });

  it('caps the backoff at 12 hours and never shortens the configured interval', () => {
    expect(effectiveIntervalMs(15, 30)).toBe(MAX_BACKOFF_MS);
    // A 24h interval must not be pulled *down* by the cap.
    expect(effectiveIntervalMs(24 * 60, 30)).toBe(24 * 60 * 60_000);
  });

  it('treats a never-synced account as due and respects the interval afterwards', () => {
    const now = 10_000_000;
    expect(isAccountDue({ lastSyncAtMs: null, syncIntervalMinutes: 15, consecutiveFailures: 0 }, now)).toBe(true);
    expect(isAccountDue({ lastSyncAtMs: now - 60_000, syncIntervalMinutes: 15, consecutiveFailures: 0 }, now)).toBe(false);
    expect(isAccountDue({ lastSyncAtMs: now - 16 * 60_000, syncIntervalMinutes: 15, consecutiveFailures: 0 }, now)).toBe(true);
  });

  it('backs a failing account off instead of hammering the provider', () => {
    const now = 10_000_000;
    const state = { lastSyncAtMs: now - 20 * 60_000, syncIntervalMinutes: 15, consecutiveFailures: 4 };
    expect(isAccountDue(state, now)).toBe(false);
    expect(isAccountDue(state, now + 60 * 60_000)).toBe(true);
  });
});
