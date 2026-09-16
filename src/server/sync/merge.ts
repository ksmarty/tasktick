/**
 * Pure conflict-resolution policy for the CalDAV sync engine.
 *
 * Everything in this module is a total function of its arguments: no database,
 * no clock, no network, no randomness. The merge heuristics are the part of sync
 * that is genuinely hard to reason about, so they live here where they can be
 * exercised directly (`tests/sync-merge.test.ts`) and behave deterministically
 * against a live provider.
 *
 * Vocabulary
 *  - "dirty"   the local row was edited since the last sync (`syncState`).
 *  - "changed" the remote object's ETag differs from the one we last stored,
 *              i.e. someone else wrote to the collection.
 *  A row that is dirty *and* changed is a genuine two-sided conflict.
 */
import type { SyncState } from '@/lib/types';

/** Two edits closer together than this are treated as a concurrent edit. */
export const CONCURRENT_EDIT_WINDOW_MS = 2000;

/**
 * Field names a local edit may pre-empt when both sides changed at the same
 * time. The union spans both mirrored entity shapes: a task is named by
 * `title`, an event by `summary`, and notes/descriptions and the date pairs
 * follow the same split. The engine passes the entity-specific subset.
 */
export const LOCALLY_PREFERRED_FIELDS: readonly string[] = [
  'title',
  'summary',
  'notes',
  'description',
  'priority',
  'dueAtMs',
  'dueDate',
  'startMs',
  'startDate',
  'endMs',
  'endDate',
  'completedAtMs',
  'status',
] as const;

export type ConflictResolution = 'local-wins' | 'remote-wins' | 'merged';
export type MergeSource = 'local' | 'remote';

export interface ConflictOutcome {
  resolution: ConflictResolution;
  /** The field values the local row must end up with. */
  values: Record<string, unknown>;
  /** Which side supplied each resulting value — the audit trail's "why". */
  sources: Record<string, MergeSource>;
  /** Human-readable justification, stored alongside the snapshots. */
  reason: string;
}

export interface ConflictInput {
  /** Current local field values (already narrowed to the mergeable subset). */
  local: Record<string, unknown>;
  /** Epoch ms of the local edit (`updatedAtMs`, or `deletedAtMs` for a delete). */
  localUpdatedAtMs: number;
  /**
   * Field values the remote side asserts. A key that is absent means "no
   * opinion" (iCalendar legitimately omits properties), never "set to null".
   */
  remote: Record<string, unknown>;
  /** LAST-MODIFIED, else DTSTAMP, else null when the server sent neither. */
  remoteModifiedAtMs: number | null;
  /** Locally edited fields that must win in the concurrent-edit case. */
  locallyPreferred?: readonly string[];
}

/** `dirty` and `pending_delete` are the two states that carry local intent. */
export function isDirtyState(state: SyncState): boolean {
  return state === 'dirty' || state === 'pending_delete';
}

export function remoteChangedSince(
  storedEtag: string | null | undefined,
  remoteEtag: string | null | undefined,
): boolean {
  return (storedEtag ?? null) !== (remoteEtag ?? null);
}

/** LAST-MODIFIED wins; DTSTAMP is the fallback; neither means "remote is older". */
export function pickRemoteModifiedAt(
  lastModifiedMs: number | null | undefined,
  dtstampMs: number | null | undefined,
): number | null {
  return lastModifiedMs ?? dtstampMs ?? null;
}

export function isConcurrentEdit(localUpdatedAtMs: number, remoteModifiedAtMs: number | null): boolean {
  if (remoteModifiedAtMs === null) return false;
  return Math.abs(localUpdatedAtMs - remoteModifiedAtMs) <= CONCURRENT_EDIT_WINDOW_MS;
}

/**
 * The locally non-null fields of `preferred`. We do not store per-field
 * dirtiness, so "the local side actually touched this" is approximated by
 * "the local side has an opinion about this"; fields the local side left null
 * stay available to the remote side in a merge.
 */
export function locallyTouchedFields(
  values: Record<string, unknown>,
  preferred: readonly string[] = LOCALLY_PREFERRED_FIELDS,
): string[] {
  return preferred.filter((field) => values[field] !== null && values[field] !== undefined);
}

/** Drops `undefined` entries — "no opinion" must not overwrite a stored value. */
export function pickDefined(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}

function outcome(
  resolution: ConflictResolution,
  values: Record<string, unknown>,
  source: MergeSource,
  reason: string,
): ConflictOutcome {
  const sources: Record<string, MergeSource> = {};
  for (const key of Object.keys(values)) sources[key] = source;
  return { resolution, values, sources, reason };
}

/**
 * Resolves one two-sided conflict.
 *
 * Order of decisions (all deterministic):
 *  1. no remote timestamp at all -> the remote is the older side -> local wins;
 *  2. both edits within {@link CONCURRENT_EDIT_WINDOW_MS} -> merge field-wise,
 *     locally preferred fields keep the local value, everything the local side
 *     left null comes from the remote (and remote-only fields are kept);
 *  3. otherwise the strictly newer side wins wholesale.
 */
export function resolveConflict(input: ConflictInput): ConflictOutcome {
  const local = pickDefined(input.local);
  const remote = pickDefined(input.remote);
  const preferred = input.locallyPreferred ?? LOCALLY_PREFERRED_FIELDS;

  if (input.remoteModifiedAtMs === null) {
    return outcome('local-wins', local, 'local', 'remote carries neither LAST-MODIFIED nor DTSTAMP');
  }

  const deltaMs = input.localUpdatedAtMs - input.remoteModifiedAtMs;

  if (isConcurrentEdit(input.localUpdatedAtMs, input.remoteModifiedAtMs)) {
    const touched = locallyTouchedFields(local, preferred);
    const values: Record<string, unknown> = { ...remote };
    const sources: Record<string, MergeSource> = {};
    for (const key of Object.keys(remote)) sources[key] = 'remote';
    for (const [key, value] of Object.entries(local)) {
      if (!(key in values)) {
        // The remote has no opinion about this field, so the local value stands.
        values[key] = value;
        sources[key] = 'local';
        continue;
      }
      if (touched.includes(key) && value !== null) {
        values[key] = value;
        sources[key] = 'local';
      }
    }
    return {
      resolution: 'merged',
      values,
      sources,
      reason: `concurrent edit (${Math.abs(deltaMs)}ms apart); local wins for ${touched.length} field(s)`,
    };
  }

  if (deltaMs > 0) {
    return outcome('local-wins', local, 'local', `local edit is ${deltaMs}ms newer than the remote one`);
  }
  return outcome('remote-wins', remote, 'remote', `remote edit is ${-deltaMs}ms newer than the local one`);
}

/**
 * A tombstoned row (`pending_delete`) meeting a remote edit is not a mergeable
 * case: either the user's delete is the newer intent, or the remote write is.
 * There is no field-wise middle ground, so no merge is attempted.
 */
export function resolvePendingDeleteConflict(input: {
  localDeletedAtMs: number;
  remoteModifiedAtMs: number | null;
  remoteValues: Record<string, unknown>;
}): ConflictOutcome {
  if (input.remoteModifiedAtMs !== null && input.remoteModifiedAtMs > input.localDeletedAtMs) {
    return outcome(
      'remote-wins',
      input.remoteValues,
      'remote',
      `remote edit is ${input.remoteModifiedAtMs - input.localDeletedAtMs}ms newer than the local delete`,
    );
  }
  return outcome('local-wins', {}, 'local', 'the local delete is the newer intent');
}

/**
 * A remote object disappeared from the collection. CalDAV gives a deletion no
 * timestamp, so there is nothing to compare — the remote side is authoritative.
 * Resurrecting automatically would fight whichever client deleted the object,
 * so the local row is tombstoned and the resolution is still audited.
 */
export function resolveRemoteDeletion(): { resolution: 'remote-wins'; reason: string } {
  return { resolution: 'remote-wins', reason: 'remote object was deleted; deletion is authoritative' };
}
