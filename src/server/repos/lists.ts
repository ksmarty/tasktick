/**
 * Lists (projects) and tags.
 *
 * The Inbox is special: exactly one list per user is flagged `isInbox`, it can
 * never be deleted, and deleting the list a task lives in must not delete the
 * task — it falls back to the Inbox. That fallback is the reason deletion here
 * is a small transaction rather than a single statement.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { lists, tags, taskTags, tasks } from '../db/schema';
import { newId } from '../crypto';
import { keyBetween, spreadKeys } from '@/lib/fractional';
import { asAccentColor } from '@/lib/colors';
import type { AccentColor, List, Tag } from '@/lib/types';
import { requireInboxListId } from '../bootstrap';

export interface CreateListInput {
  name: string;
  description?: string | null;
  color?: AccentColor;
  emoji?: string | null;
}

export type UpdateListInput = Partial<CreateListInput> & { archived?: boolean };

function rowToList(row: typeof lists.$inferSelect): List {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    color: asAccentColor(row.color),
    emoji: row.emoji,
    sortOrder: row.sortOrder,
    archived: row.archived,
    isInbox: row.isInbox,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** All lists with open/total task counts, ordered for the sidebar. */
export async function listLists(userId: string, options: { includeArchived?: boolean } = {}): Promise<List[]> {
  const db = getDb();
  const conditions = [eq(lists.userId, userId), isNull(lists.deletedAtMs)];
  if (!options.includeArchived) conditions.push(eq(lists.archived, false));

  const rows = await db
    .select()
    .from(lists)
    .where(and(...conditions))
    .orderBy(desc(lists.isInbox), asc(lists.sortOrder), asc(lists.name));

  // One grouped count query rather than N per-list queries.
  const counts = await db
    .select({
      listId: tasks.listId,
      total: sql<number>`count(*)`,
      open: sql<number>`sum(case when ${tasks.status} = 'todo' then 1 else 0 end)`,
    })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAtMs), isNull(tasks.parentId)))
    .groupBy(tasks.listId);

  const byList = new Map(counts.map((c) => [c.listId ?? '', c]));

  return rows.map((row) => {
    const list = rowToList(row);
    const count = byList.get(row.id);
    list.taskCount = Number(count?.total ?? 0);
    list.openTaskCount = Number(count?.open ?? 0);
    return list;
  });
}

/** Maps list id -> open task count, for badge rendering without full hydration. */
export async function listOpenCounts(userId: string): Promise<Record<string, number>> {
  const db = getDb();
  const rows = await db
    .select({ listId: tasks.listId, open: sql<number>`count(*)` })
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAtMs),
        eq(tasks.status, 'todo'),
        isNull(tasks.parentId),
      ),
    )
    .groupBy(tasks.listId);

  const out: Record<string, number> = {};
  for (const row of rows) out[row.listId ?? ''] = Number(row.open);
  return out;
}

export async function getList(userId: string, id: string): Promise<List | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, id), eq(lists.userId, userId), isNull(lists.deletedAtMs)))
    .limit(1);
  return row ? rowToList(row) : null;
}

export async function createList(userId: string, input: CreateListInput): Promise<List> {
  const db = getDb();
  const [last] = await db
    .select({ sortOrder: lists.sortOrder })
    .from(lists)
    .where(and(eq(lists.userId, userId), isNull(lists.deletedAtMs)))
    .orderBy(desc(lists.sortOrder))
    .limit(1);

  const id = newId();
  const now = Date.now();

  await db.insert(lists).values({
    id,
    userId,
    name: input.name.trim() || 'New list',
    description: input.description ?? null,
    color: input.color ?? 'blue',
    emoji: input.emoji ?? null,
    sortOrder: keyBetween(last?.sortOrder ?? null, null).key,
    isInbox: false,
    createdAt: now,
    updatedAt: now,
  });

  const created = await getList(userId, id);
  if (!created) throw new Error('List insert did not persist');
  return created;
}

export async function updateList(userId: string, id: string, input: UpdateListInput): Promise<List | null> {
  const db = getDb();
  const existing = await getList(userId, id);
  if (!existing) return null;

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.name !== undefined) patch.name = input.name.trim() || existing.name;
  if (input.description !== undefined) patch.description = input.description;
  if (input.color !== undefined) patch.color = input.color;
  if (input.emoji !== undefined) patch.emoji = input.emoji;
  // The Inbox is a fixed anchor in the sidebar; archiving it would hide it.
  if (input.archived !== undefined && !existing.isInbox) patch.archived = input.archived;

  await db.update(lists).set(patch).where(and(eq(lists.id, id), eq(lists.userId, userId)));
  return getList(userId, id);
}

/**
 * Deletes a list. Tasks inside it are moved to the Inbox rather than orphaned,
 * because `tasks.listId` is `ON DELETE SET NULL` and a null-list task would
 * vanish from every sidebar view while still existing.
 */
export async function deleteList(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const existing = await getList(userId, id);
  if (!existing) return false;
  // The Inbox cannot be deleted: it is the fallback destination.
  if (existing.isInbox) throw new Error('inbox-undeletable');

  const inboxId = await requireInboxListId(userId);

  await db
    .update(tasks)
    .set({ listId: inboxId, syncState: 'dirty', updatedAt: Date.now() })
    .where(and(eq(tasks.userId, userId), eq(tasks.listId, id)));

  await db
    .update(lists)
    .set({ deletedAtMs: Date.now(), updatedAt: Date.now() })
    .where(and(eq(lists.id, id), eq(lists.userId, userId)));

  return true;
}

export async function reorderLists(userId: string, orderedIds: string[]): Promise<void> {
  const db = getDb();
  const keys = spreadKeys(orderedIds.length);
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(lists)
      .set({ sortOrder: keys[i], updatedAt: Date.now() })
      .where(and(eq(lists.id, orderedIds[i]), eq(lists.userId, userId)));
  }
}

/* -------------------------------------------------------------------------- */
/* tags                                                                       */
/* -------------------------------------------------------------------------- */

function rowToTag(row: typeof tags.$inferSelect): Tag {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    color: asAccentColor(row.color),
  };
}

export async function listTags(userId: string): Promise<Tag[]> {
  const db = getDb();
  const rows = await db.select().from(tags).where(eq(tags.userId, userId)).orderBy(asc(tags.name));

  const counts = await db
    .select({ tagId: taskTags.tagId, count: sql<number>`count(*)` })
    .from(taskTags)
    .innerJoin(tasks, eq(tasks.id, taskTags.taskId))
    .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAtMs)))
    .groupBy(taskTags.tagId);

  const byTag = new Map(counts.map((c) => [c.tagId, Number(c.count)]));

  return rows.map((row) => {
    const tag = rowToTag(row);
    tag.taskCount = byTag.get(row.id) ?? 0;
    return tag;
  });
}

export async function createTag(userId: string, name: string, color?: AccentColor): Promise<Tag> {
  const db = getDb();
  const trimmed = name.trim().replace(/^#/, '');
  if (!trimmed) throw new Error('empty-name');

  const [existing] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.userId, userId), eq(tags.name, trimmed)))
    .limit(1);
  if (existing) return rowToTag(existing);

  const id = newId();
  await db.insert(tags).values({ id, userId, name: trimmed, color: color ?? 'gray' });
  const [row] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  return rowToTag(row);
}

export async function updateTag(
  userId: string,
  id: string,
  input: { name?: string; color?: AccentColor },
): Promise<Tag | null> {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.name !== undefined) patch.name = input.name.trim().replace(/^#/, '');
  if (input.color !== undefined) patch.color = input.color;

  await db.update(tags).set(patch).where(and(eq(tags.id, id), eq(tags.userId, userId)));
  const [row] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .limit(1);
  return row ? rowToTag(row) : null;
}

/** Deletes a tag and detaches it from every task. Tasks themselves survive. */
export async function deleteTag(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId)))
    .limit(1);
  if (!existing) return false;

  await db.delete(taskTags).where(eq(taskTags.tagId, id));
  await db.delete(tags).where(and(eq(tags.id, id), eq(tags.userId, userId)));
  return true;
}

/** Merges one tag into another — used to clean up near-duplicate tags. */
export async function mergeTags(userId: string, sourceId: string, targetId: string): Promise<boolean> {
  const db = getDb();
  const owned = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.id, [sourceId, targetId])));
  if (owned.length !== 2) return false;

  const attached = await db.select({ taskId: taskTags.taskId }).from(taskTags).where(eq(taskTags.tagId, sourceId));
  if (attached.length) {
    await db
      .insert(taskTags)
      .values(attached.map((a) => ({ taskId: a.taskId, tagId: targetId })))
      .onConflictDoNothing();
  }
  await db.delete(taskTags).where(eq(taskTags.tagId, sourceId));
  await db.delete(tags).where(and(eq(tags.id, sourceId), eq(tags.userId, userId)));
  return true;
}
