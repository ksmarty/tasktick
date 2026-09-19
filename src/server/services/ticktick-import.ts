/**
 * Applies a parsed TickTick import.
 *
 * ## Safety
 *
 * The whole write — every list, task and provenance row — runs inside one
 * {@link withTransaction}, so a failure at row 900 leaves the database exactly
 * as it was. Parsing happens before this function is called, which is why a
 * malformed file never even reaches the database.
 *
 * ## Idempotency
 *
 * Every row's stable source key (TickTick's own `taskId`, or the CSV record
 * number when the export has none) is recorded in `import_keys`. Re-importing
 * the same export therefore creates nothing: existing keys are skipped, and a
 * subtask whose parent was skipped is skipped too. Lists are matched first by
 * their recorded key, then by name (case-insensitively), so an existing
 * hand-made list is reused rather than duplicated.
 *
 * Skip — rather than replace — is the deliberate choice: replace would let a
 * second import of a stale backup delete tasks the user has since added. The
 * cost is that edits made in TickTick *after* the first import are not picked
 * up; the summary reports how many rows were skipped so the UI can say so.
 */
import { and, eq } from 'drizzle-orm';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db';
import { importKeys } from '../db/schema';
import { createList, getList, listLists } from '../repos/lists';
import { createTask } from '../repos/tasks';
import { newId } from '../crypto';
import { TICKTICK_SOURCE, type TickTickPlan } from '@/lib/ticktick-import';

export interface TickTickApplySummary {
  listsCreated: number;
  listsReused: number;
  tasksCreated: number;
  subtasksCreated: number;
  /** Rows the source key says were imported by an earlier run. */
  skippedExisting: number;
}

async function recordKey(
  db: Db,
  userId: string,
  sourceKey: string,
  entityType: 'task' | 'list',
  entityId: string,
): Promise<void> {
  await db
    .insert(importKeys)
    .values({
      id: newId(),
      userId,
      source: TICKTICK_SOURCE,
      sourceKey,
      entityType,
      entityId,
    })
    .onConflictDoNothing();
}

/**
 * Writes a parsed plan for one user. Resolves with the counters the UI reports;
 * rejects (rolling everything back) on any database error.
 */
export async function applyTickTickImport(options: {
  userId: string;
  zone: string;
  plan: TickTickPlan;
}): Promise<TickTickApplySummary> {
  const { userId, zone, plan } = options;

  return withTransaction(async (db) => {
    let listsCreated = 0;
    let listsReused = 0;
    let tasksCreated = 0;
    let subtasksCreated = 0;
    let skippedExisting = 0;

    const keyRows = await db
      .select({ sourceKey: importKeys.sourceKey, entityId: importKeys.entityId, entityType: importKeys.entityType })
      .from(importKeys)
      .where(and(eq(importKeys.userId, userId), eq(importKeys.source, TICKTICK_SOURCE)));

    /** Source key -> the row it already created. */
    const knownByKey = new Map(keyRows.map((row) => [row.sourceKey, row]));
    const knownTaskIds = new Map(
      keyRows.filter((row) => row.entityType === 'task').map((row) => [row.sourceKey, row.entityId]),
    );

    const listIdByName = new Map(
      (await listLists(userId, { includeArchived: true }, db)).map((list) => [list.name.trim().toLowerCase(), list.id]),
    );

    const listIdByKey = new Map<string, string>();
    for (const list of plan.lists) {
      const keyed = knownByKey.get(list.key);
      if (keyed && (await getList(userId, keyed.entityId, db))) {
        listIdByKey.set(list.key, keyed.entityId);
        listsReused += 1;
        continue;
      }

      const byName = listIdByName.get(list.name.trim().toLowerCase());
      if (byName) {
        listIdByKey.set(list.key, byName);
        listsReused += 1;
        await recordKey(db, userId, list.key, 'list', byName);
        continue;
      }

      const created = await createList(userId, { name: list.name }, db);
      listIdByKey.set(list.key, created.id);
      listIdByName.set(created.name.trim().toLowerCase(), created.id);
      await recordKey(db, userId, list.key, 'list', created.id);
      listsCreated += 1;
    }

    // Parents are created before children so `parentId` always resolves; a child
    // whose parent was skipped inherits the skip, otherwise re-importing would
    // duplicate every subtask of an already-imported task.
    const roots = plan.tasks.filter((task) => task.parentKey === null);
    const children = plan.tasks.filter((task) => task.parentKey !== null);
    const taskIdByKey = new Map(knownTaskIds);
    const skippedKeys = new Set<string>();

    for (const task of [...roots, ...children]) {
      const parentSkipped = task.parentKey !== null && skippedKeys.has(task.parentKey);
      if (knownByKey.has(task.key) || parentSkipped) {
        skippedExisting += 1;
        skippedKeys.add(task.key);
        continue;
      }

      const parentId = task.parentKey ? taskIdByKey.get(task.parentKey) ?? null : null;
      const created = await createTask(
        userId,
        {
          title: task.title,
          notes: task.notes,
          listId: listIdByKey.get(task.listKey) ?? null,
          parentId,
          priority: task.priority,
          status: task.status,
          completedAtMs: task.completedAtMs,
          createdAtMs: task.createdAtMs,
          dueDate: task.dueDate,
          dueTime: task.dueTime,
          startDate: task.startDate,
          startTime: task.startTime,
          timezone: task.timezone ?? zone,
          recurrenceRule: task.recurrenceRule,
          tagNames: task.tags,
        },
        zone,
        db,
      );

      taskIdByKey.set(task.key, created.id);
      await recordKey(db, userId, task.key, 'task', created.id);
      if (task.parentKey) subtasksCreated += 1;
      else tasksCreated += 1;
    }

    return { listsCreated, listsReused, tasksCreated, subtasksCreated, skippedExisting };
  });
}
