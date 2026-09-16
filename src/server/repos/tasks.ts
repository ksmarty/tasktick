/**
 * Task repository.
 *
 * Owns every read and write of the `tasks` table plus its satellites (tags,
 * subtasks, reminders, completion history).
 *
 * Two invariants this module is responsible for:
 *
 *  1. **Dual due representation.** A task stores both a floating `dueDate` and,
 *     when it has a clock time, a resolved `dueAtMs` instant. Callers pass
 *     `dueDate` + `dueTime` + `timezone` and this layer resolves them, so no
 *     route ever does timezone maths by hand.
 *
 *  2. **Sync dirtiness.** Any write to a task that is mirrored into a CalDAV
 *     collection flips `syncState` to `dirty` so the push half of the sync
 *     engine picks it up. Deletes become `pending_delete` tombstones rather than
 *     disappearing, so the delete can propagate.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNull, lt, lte, or, sql, type SQL } from 'drizzle-orm';
import { getDb } from '../db';
import { lists, calendars, tags, taskCompletions, taskReminders, taskTags, tasks } from '../db/schema';
import type { TaskRow } from '../db/schema';
import { newId } from '../crypto';
import { keyBetween, spreadKeys } from '@/lib/fractional';
import { asAccentColor } from '@/lib/colors';
import { combineDateAndTime, dateOnlyToMillis, nowIn, toDateOnly, dueWindowBounds, priorityWeight } from '@/lib/dates';
import { nextOccurrence } from '../recurrence';
import type { DateOnly, Millis, Priority, Reminder, SubTask, Tag, Task, TaskFilter, TaskStatus } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* input types                                                                */
/* -------------------------------------------------------------------------- */

export interface ReminderInput {
  /** Minutes before the due instant. */
  offsetMinutes?: number | null;
  absoluteAtMs?: Millis | null;
}

export interface CreateTaskInput {
  title: string;
  notes?: string | null;
  url?: string | null;
  listId?: string | null;
  parentId?: string | null;

  priority?: Priority;
  status?: TaskStatus;

  dueDate?: DateOnly | null;
  /** `HH:mm`. Presence of a time is what makes the task timed rather than all-day. */
  dueTime?: string | null;
  /** Escape hatch for callers that already hold an instant. */
  dueAtMs?: Millis | null;
  startDate?: DateOnly | null;
  startTime?: string | null;
  startAtMs?: Millis | null;
  timezone?: string | null;

  recurrenceRule?: string | null;
  recurrenceMode?: 'due' | 'completion';
  estimateMinutes?: number | null;

  tagIds?: string[];
  /** Tag names that do not exist yet are created on the fly (quick-add path). */
  tagNames?: string[];

  reminders?: ReminderInput[];

  /** Links the task to a calendar collection; this is what enables CalDAV sync. */
  calendarId?: string | null;

  /** Explicit ordering key; omitted means "append to the end of the list". */
  sortOrder?: string;
  isPinned?: boolean;
}

export type UpdateTaskInput = Partial<Omit<CreateTaskInput, 'parentId'>> & {
  /** Explicitly clear a field that is otherwise "leave alone when absent". */
  clearDue?: boolean;
  clearRecurrence?: boolean;
  clearReminders?: boolean;
};

export interface TaskQueryOptions {
  userId: string;
  filter?: TaskFilter;
  zone: string;
  sort?: TaskSort;
  /** Include subtasks as top-level rows. Off by default: they render nested. */
  includeSubtasks?: boolean;
  limit?: number;
  offset?: number;
}

export type TaskSort = 'smart' | 'due' | 'created' | 'updated' | 'priority' | 'title' | 'manual';

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

const isoNow = () => Date.now();

/** Resolves the dual due representation from a friendly input shape. */
function resolveDue(input: {
  dueDate?: DateOnly | null;
  dueTime?: string | null;
  dueAtMs?: Millis | null;
  timezone?: string | null;
}): { dueDate: DateOnly | null; dueAtMs: Millis | null; isAllDay: boolean } {
  const zone = input.timezone ?? 'UTC';

  if (input.dueDate) {
    if (input.dueTime) {
      return { dueDate: input.dueDate, dueAtMs: combineDateAndTime(input.dueDate, input.dueTime, zone), isAllDay: false };
    }
    return { dueDate: input.dueDate, dueAtMs: null, isAllDay: true };
  }

  if (typeof input.dueAtMs === 'number') {
    return { dueDate: toDateOnly(input.dueAtMs, zone), dueAtMs: input.dueAtMs, isAllDay: false };
  }

  return { dueDate: null, dueAtMs: null, isAllDay: true };
}

/**
 * Computes a reminder's absolute fire time.
 * Relative reminders on a task with no due date cannot fire, so they are
 * dropped rather than silently scheduled at the epoch.
 */
export function computeFireAt(
  reminder: ReminderInput,
  dueAtMs: Millis | null,
  dueDate: DateOnly | null,
  zone: string,
): Millis | null {
  if (typeof reminder.absoluteAtMs === 'number') return reminder.absoluteAtMs;
  if (reminder.offsetMinutes === null || reminder.offsetMinutes === undefined) return null;

  const base = dueAtMs ?? (dueDate ? dateOnlyToMillis(dueDate, zone) : null);
  if (base === null) return null;
  return base + reminder.offsetMinutes * 60_000;
}

/** True when this task's collection is a writable CalDAV calendar. */
async function calendarSyncsToRemote(calendarId: string | null | undefined, userId: string): Promise<boolean> {
  if (!calendarId) return false;
  const db = getDb();
  const [row] = await db
    .select({ provider: calendars.provider, readOnly: calendars.readOnly })
    .from(calendars)
    .where(and(eq(calendars.id, calendarId), eq(calendars.userId, userId)))
    .limit(1);
  return Boolean(row && row.provider === 'caldav' && !row.readOnly);
}

/** Resolves tag names to ids, creating any that do not exist yet. */
async function resolveTagIds(userId: string, tagIds: string[], tagNames: string[]): Promise<string[]> {
  const db = getDb();
  const resolved = new Set(tagIds);

  if (tagNames.length) {
    const wanted = [...new Set(tagNames.map((n) => n.trim()).filter(Boolean))];
    if (wanted.length) {
      const existing = await db
        .select({ id: tags.id, name: tags.name })
        .from(tags)
        .where(and(eq(tags.userId, userId), inArray(tags.name, wanted)));

      const byName = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));
      for (const id of existing.map((t) => t.id)) resolved.add(id);

      for (const name of wanted) {
        if (byName.has(name.toLowerCase())) continue;
        const id = newId();
        await db.insert(tags).values({ id, userId, name });
        byName.set(name.toLowerCase(), id);
        resolved.add(id);
      }
    }
  }

  if (!resolved.size) return [];

  // Never attach a tag that belongs to somebody else.
  const owned = await db
    .select({ id: tags.id })
    .from(tags)
    .where(and(eq(tags.userId, userId), inArray(tags.id, [...resolved])));
  return owned.map((t) => t.id);
}

async function replaceReminders(
  userId: string,
  taskId: string,
  reminders: ReminderInput[],
  dueAtMs: Millis | null,
  dueDate: DateOnly | null,
  zone: string,
): Promise<void> {
  const db = getDb();
  await db.delete(taskReminders).where(and(eq(taskReminders.taskId, taskId), eq(taskReminders.userId, userId)));

  const rows = reminders
    .map((reminder) => {
      const fireAtMs = computeFireAt(reminder, dueAtMs, dueDate, zone);
      if (fireAtMs === null) return null;
      return {
        id: newId(),
        userId,
        taskId,
        offsetMinutes: reminder.offsetMinutes ?? null,
        absoluteAtMs: reminder.absoluteAtMs ?? null,
        fireAtMs,
        sent: false,
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length) await db.insert(taskReminders).values(rows);
}

async function replaceTags(userId: string, taskId: string, tagIds: string[]): Promise<void> {
  const db = getDb();
  await db.delete(taskTags).where(eq(taskTags.taskId, taskId));
  if (!tagIds.length) return;
  await db.insert(taskTags).values(tagIds.map((tagId) => ({ taskId, tagId })));
  void userId;
}

/** Next free sort key at the end of a list (or among a parent's subtasks). */
async function nextSortOrder(userId: string, listId: string | null, parentId: string | null): Promise<string> {
  const db = getDb();
  const scope = parentId
    ? and(eq(tasks.userId, userId), eq(tasks.parentId, parentId), isNull(tasks.deletedAtMs))
    : and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAtMs),
        isNull(tasks.parentId),
        listId ? eq(tasks.listId, listId) : isNull(tasks.listId),
      );

  const [last] = await db
    .select({ sortOrder: tasks.sortOrder })
    .from(tasks)
    .where(scope)
    .orderBy(desc(tasks.sortOrder))
    .limit(1);

  return keyBetween(last?.sortOrder ?? null, null).key;
}

/* -------------------------------------------------------------------------- */
/* hydration                                                                  */
/* -------------------------------------------------------------------------- */

function rowToTask(row: TaskRow): Task {
  return {
    id: row.id,
    userId: row.userId,
    listId: row.listId,
    parentId: row.parentId,
    title: row.title,
    notes: row.notes,
    url: row.url,
    status: row.status,
    priority: row.priority,
    dueAtMs: row.dueAtMs,
    dueDate: row.dueDate,
    startAtMs: row.startAtMs,
    startDate: row.startDate,
    isAllDay: row.isAllDay,
    timezone: row.timezone,
    completedAtMs: row.completedAtMs,
    recurrenceRule: row.recurrenceRule,
    recurrenceMode: row.recurrenceMode,
    recurrenceId: row.recurrenceId,
    estimateMinutes: row.estimateMinutes,
    spentMinutes: row.spentMinutes,
    sortOrder: row.sortOrder,
    isPinned: row.isPinned,
    calendarId: row.calendarId,
    syncProvider: row.syncProvider,
    syncState: row.syncState,
    externalUid: row.externalUid,
    externalHref: row.externalHref,
    externalEtag: row.externalEtag,
    lastSyncedAtMs: row.lastSyncedAtMs,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAtMs: row.deletedAtMs,
  };
}

/** Attaches tags, subtasks and reminders to a batch of tasks in three queries. */
async function hydrate(userId: string, rows: TaskRow[]): Promise<Task[]> {
  if (!rows.length) return [];
  const db = getDb();
  const ids = rows.map((r) => r.id);

  const [tagRows, subRows, reminderRows] = await Promise.all([
    db
      .select({ taskId: taskTags.taskId, id: tags.id, name: tags.name, color: tags.color })
      .from(taskTags)
      .innerJoin(tags, eq(tags.id, taskTags.tagId))
      .where(and(eq(tags.userId, userId), inArray(taskTags.taskId, ids))),
    db
      .select()
      .from(tasks)
      .where(and(eq(tasks.userId, userId), inArray(tasks.parentId, ids), isNull(tasks.deletedAtMs)))
      .orderBy(asc(tasks.sortOrder)),
    db
      .select()
      .from(taskReminders)
      .where(and(eq(taskReminders.userId, userId), inArray(taskReminders.taskId, ids)))
      .orderBy(asc(taskReminders.fireAtMs)),
  ]);

  const tagsByTask = new Map<string, Tag[]>();
  for (const row of tagRows) {
    const list = tagsByTask.get(row.taskId) ?? [];
    list.push({ id: row.id, userId, name: row.name, color: asAccentColor(row.color) });
    tagsByTask.set(row.taskId, list);
  }

  const subsByParent = new Map<string, SubTask[]>();
  for (const row of subRows) {
    if (!row.parentId) continue;
    const list = subsByParent.get(row.parentId) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      status: row.status,
      completedAtMs: row.completedAtMs,
      sortOrder: row.sortOrder,
    });
    subsByParent.set(row.parentId, list);
  }

  const remindersByTask = new Map<string, Reminder[]>();
  for (const row of reminderRows) {
    const list = remindersByTask.get(row.taskId) ?? [];
    list.push({
      id: row.id,
      offsetMinutes: row.offsetMinutes,
      absoluteAtMs: row.absoluteAtMs,
      fireAtMs: row.fireAtMs,
      sent: row.sent,
    });
    remindersByTask.set(row.taskId, list);
  }

  return rows.map((row) => {
    const task = rowToTask(row);
    task.tags = tagsByTask.get(row.id) ?? [];
    task.tagIds = task.tags.map((t) => t.id);
    task.subtasks = subsByParent.get(row.id) ?? [];
    task.reminders = remindersByTask.get(row.id) ?? [];
    return task;
  });
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Builds the WHERE clause for a filter.
 *
 * Deliberately portable: no `ILIKE`, no dialect-specific functions. Case
 * insensitive matching is done by lower-casing both sides, which behaves
 * identically on SQLite and Postgres.
 */
function filterConditions(userId: string, filter: TaskFilter, zone: string): SQL[] {
  const conditions: SQL[] = [eq(tasks.userId, userId), isNull(tasks.deletedAtMs)];

  if (!filter.includeCompleted) {
    conditions.push(eq(tasks.status, 'todo'));
  }
  if (filter.statuses?.length) {
    conditions.push(inArray(tasks.status, filter.statuses));
  }
  if (filter.listIds?.length) {
    conditions.push(inArray(tasks.listId, filter.listIds));
  }
  if (filter.priorities?.length) {
    conditions.push(inArray(tasks.priority, filter.priorities));
  }
  if (filter.isPinned !== undefined) {
    conditions.push(eq(tasks.isPinned, filter.isPinned));
  }
  if (filter.hasRecurrence !== undefined) {
    conditions.push(
      filter.hasRecurrence
        ? sql`${tasks.recurrenceRule} is not null`
        : sql`${tasks.recurrenceRule} is null`,
    );
  }

  if (filter.text) {
    const needle = `%${filter.text.trim().toLowerCase()}%`;
    // `notes is not null` guard keeps NULL propagation from swallowing matches.
    const textCondition = or(
      sql`lower(${tasks.title}) like ${needle}`,
      and(sql`${tasks.notes} is not null`, sql`lower(${tasks.notes}) like ${needle}`),
    );
    if (textCondition) conditions.push(textCondition);
  }

  const bounds = filter.dueWindow ? dueWindowBounds(filter.dueWindow, zone) : { from: null, to: null };
  const from = filter.dueFrom ?? bounds.from;
  const to = filter.dueTo ?? bounds.to;

  if (filter.dueWindow === 'noDate') {
    conditions.push(and(isNull(tasks.dueDate), isNull(tasks.dueAtMs)) as SQL);
  } else {
    // The sort instant is `dueAtMs` when present, otherwise `dueDate` at local
    // midnight. Comparing against both columns with an OR keeps this index-usable.
    if (from) {
      const fromMs = dateOnlyToMillis(from, zone);
      conditions.push(
        or(gte(tasks.dueAtMs, fromMs), and(isNull(tasks.dueAtMs), gte(tasks.dueDate, from))) as SQL,
      );
    }
    if (to) {
      const toMs = dateOnlyToMillis(to, zone) + 86_399_999;
      conditions.push(
        or(lte(tasks.dueAtMs, toMs), and(isNull(tasks.dueAtMs), lte(tasks.dueDate, to))) as SQL,
      );
    }
  }

  return conditions;
}

function orderFor(sort: TaskSort): SQL[] {
  switch (sort) {
    case 'due':
      return [sql`coalesce(${tasks.dueAtMs}, 9223372036854775807) asc`, sql`${tasks.dueDate} asc`, asc(tasks.sortOrder)];
    case 'created':
      return [desc(tasks.createdAt)];
    case 'updated':
      return [desc(tasks.updatedAt)];
    case 'priority':
      // high -> low, expressed numerically so a text column still sorts right.
      return [
        sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end asc`,
        sql`coalesce(${tasks.dueAtMs}, 9223372036854775807) asc`,
      ];
    case 'title':
      return [sql`lower(${tasks.title}) asc`];
    case 'manual':
      return [asc(tasks.sortOrder)];
    case 'smart':
    default:
      // Pinned first, then undated-free chronological order, then priority.
      return [
        desc(tasks.isPinned),
        sql`case when ${tasks.dueAtMs} is null and ${tasks.dueDate} is null then 1 else 0 end asc`,
        sql`coalesce(${tasks.dueAtMs}, 9223372036854775807) asc`,
        sql`${tasks.dueDate} asc`,
        sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end asc`,
        asc(tasks.sortOrder),
      ];
  }
}

export async function queryTasks(options: TaskQueryOptions): Promise<Task[]> {
  const db = getDb();
  const { userId, filter = {}, zone, sort = 'smart', includeSubtasks = false, limit = 500, offset = 0 } = options;

  const conditions = filterConditions(userId, filter, zone);
  if (!includeSubtasks) conditions.push(isNull(tasks.parentId));
  if (filter.tagIds?.length) {
    // A task matches when it carries ANY of the requested tags.
    conditions.push(
      sql`exists (select 1 from ${taskTags} where ${taskTags.taskId} = ${tasks.id} and ${taskTags.tagId} in ${filter.tagIds})`,
    );
  }

  const rows = await db
    .select()
    .from(tasks)
    .where(and(...conditions))
    .orderBy(...orderFor(sort))
    .limit(Math.min(limit, 2000))
    .offset(offset);

  return hydrate(userId, rows);
}

export async function getTask(userId: string, id: string): Promise<Task | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId), isNull(tasks.deletedAtMs)))
    .limit(1);
  if (!row) return null;
  const [task] = await hydrate(userId, [row]);
  return task ?? null;
}

/** Every open task inside a window, including its subtasks — used by the calendar. */
export async function tasksInRange(userId: string, startMs: Millis, endMs: Millis, zone: string): Promise<Task[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAtMs),
        eq(tasks.status, 'todo'),
        isNull(tasks.parentId),
        or(
          and(gte(tasks.dueAtMs, startMs), lt(tasks.dueAtMs, endMs)),
          and(isNull(tasks.dueAtMs), gte(tasks.dueDate, toDateOnly(startMs, zone)), lte(tasks.dueDate, toDateOnly(endMs, zone))),
          // Recurring tasks whose first occurrence predates the window but which
          // still have occurrences inside it.
          and(sql`${tasks.recurrenceRule} is not null`, or(lte(tasks.dueAtMs, endMs), lte(tasks.dueDate, toDateOnly(endMs, zone)))),
        ),
      ),
    )
    .limit(2000);

  return hydrate(userId, rows);
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function createTask(userId: string, input: CreateTaskInput, userZone: string): Promise<Task> {
  const db = getDb();
  const zone = input.timezone ?? userZone;
  const now = isoNow();
  const id = newId();

  const due = resolveDue({ ...input, timezone: zone });
  const start = input.startDate
    ? { startDate: input.startDate, startAtMs: input.startTime ? combineDateAndTime(input.startDate, input.startTime, zone) : null }
    : { startDate: null, startAtMs: input.startAtMs ?? null };

  const tagIds = await resolveTagIds(userId, input.tagIds ?? [], input.tagNames ?? []);
  const sortOrder = input.sortOrder ?? (await nextSortOrder(userId, input.listId ?? null, input.parentId ?? null));
  const syncRemote = await calendarSyncsToRemote(input.calendarId, userId);

  await db.insert(tasks).values({
    id,
    userId,
    listId: input.listId ?? null,
    parentId: input.parentId ?? null,
    title: input.title.trim() || 'Untitled',
    notes: input.notes ?? null,
    url: input.url ?? null,
    status: input.status ?? 'todo',
    priority: input.priority ?? 'none',
    dueDate: due.dueDate,
    dueAtMs: due.dueAtMs,
    startDate: start.startDate,
    startAtMs: start.startAtMs,
    isAllDay: due.isAllDay,
    timezone: zone,
    recurrenceRule: input.recurrenceRule ?? null,
    recurrenceMode: input.recurrenceMode ?? 'due',
    estimateMinutes: input.estimateMinutes ?? null,
    sortOrder,
    isPinned: input.isPinned ?? false,
    calendarId: input.calendarId ?? null,
    syncProvider: syncRemote ? 'caldav' : 'local',
    syncState: syncRemote ? 'dirty' : 'synced',
    createdAt: now,
    updatedAt: now,
  });

  await replaceTags(userId, id, tagIds);
  await replaceReminders(userId, id, input.reminders ?? [], due.dueAtMs, due.dueDate, zone);

  const created = await getTask(userId, id);
  if (!created) throw new Error('Task insert did not persist');
  return created;
}

export async function updateTask(userId: string, id: string, input: UpdateTaskInput, userZone: string): Promise<Task> {
  const db = getDb();
  const existing = await getTask(userId, id);
  if (!existing) throw new Error('not-found');

  const zone = input.timezone ?? existing.timezone ?? userZone;
  const patch: Record<string, unknown> = { updatedAt: isoNow() };

  if (input.title !== undefined) patch.title = input.title.trim() || 'Untitled';
  if (input.notes !== undefined) patch.notes = input.notes;
  if (input.url !== undefined) patch.url = input.url;
  if (input.listId !== undefined) patch.listId = input.listId;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.status !== undefined) {
    patch.status = input.status;
    patch.completedAtMs = input.status === 'completed' ? (existing.completedAtMs ?? isoNow()) : null;
  }
  if (input.estimateMinutes !== undefined) patch.estimateMinutes = input.estimateMinutes;
  if (input.isPinned !== undefined) patch.isPinned = input.isPinned;
  if (input.calendarId !== undefined) patch.calendarId = input.calendarId;
  if (input.sortOrder !== undefined) patch.sortOrder = input.sortOrder;
  if (input.timezone !== undefined) patch.timezone = input.timezone;

  if (input.recurrenceMode !== undefined) patch.recurrenceMode = input.recurrenceMode;
  if (input.clearRecurrence) patch.recurrenceRule = null;
  else if (input.recurrenceRule !== undefined) patch.recurrenceRule = input.recurrenceRule;

  // Due dates: `clearDue` wins, otherwise recompute whenever any part changed.
  const dueTouched =
    input.clearDue ||
    input.dueDate !== undefined ||
    input.dueTime !== undefined ||
    input.dueAtMs !== undefined ||
    input.timezone !== undefined;

  if (dueTouched) {
    if (input.clearDue) {
      patch.dueDate = null;
      patch.dueAtMs = null;
      patch.isAllDay = true;
    } else {
      const due = resolveDue({
        dueDate: input.dueDate !== undefined ? input.dueDate : existing.dueDate,
        dueTime: input.dueTime !== undefined ? input.dueTime : existing.isAllDay ? null : undefined,
        dueAtMs: input.dueAtMs !== undefined ? input.dueAtMs : undefined,
        timezone: zone,
      });
      patch.dueDate = due.dueDate;
      patch.dueAtMs = due.dueAtMs;
      patch.isAllDay = due.isAllDay;
    }
  }

  if (input.startDate !== undefined || input.startTime !== undefined || input.startAtMs !== undefined) {
    patch.startDate = input.startDate ?? null;
    patch.startAtMs = input.startAtMs ?? (input.startDate && input.startTime ? combineDateAndTime(input.startDate, input.startTime, zone) : null);
  }

  // Any local edit to a mirrored task must be pushed on the next sync run.
  const effectiveCalendarId = (patch.calendarId as string | null | undefined) ?? existing.calendarId;
  if (await calendarSyncsToRemote(effectiveCalendarId, userId)) {
    patch.syncState = 'dirty';
    patch.syncProvider = 'caldav';
  }

  await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));

  if (input.tagIds !== undefined || input.tagNames !== undefined) {
    const tagIds = await resolveTagIds(userId, input.tagIds ?? existing.tagIds ?? [], input.tagNames ?? []);
    await replaceTags(userId, id, tagIds);
  }

  if (input.clearReminders) {
    await db.delete(taskReminders).where(and(eq(taskReminders.taskId, id), eq(taskReminders.userId, userId)));
  } else if (input.reminders !== undefined) {
    const dueAtMs = (patch.dueAtMs as Millis | null | undefined) ?? existing.dueAtMs;
    const dueDate = (patch.dueDate as DateOnly | null | undefined) ?? existing.dueDate;
    await replaceReminders(userId, id, input.reminders, dueAtMs ?? null, dueDate ?? null, zone);
  } else if (dueTouched) {
    // Relative reminders must follow the new due date, or they fire at the old time.
    const existingOffsets = (existing.reminders ?? []).map((r) => ({
      offsetMinutes: r.offsetMinutes,
      absoluteAtMs: r.absoluteAtMs,
    }));
    const dueAtMs = (patch.dueAtMs as Millis | null | undefined) ?? existing.dueAtMs;
    const dueDate = (patch.dueDate as DateOnly | null | undefined) ?? existing.dueDate;
    await replaceReminders(userId, id, existingOffsets, dueAtMs ?? null, dueDate ?? null, zone);
  }

  const updated = await getTask(userId, id);
  if (!updated) throw new Error('not-found');
  return updated;
}

/**
 * Completes a task.
 *
 * For a recurring task this does NOT mark the row completed. It records the
 * completion in `task_completions` (which powers streaks and stats) and advances
 * the task's due date to the next occurrence, which is how a repeating task
 * stays a single row instead of accumulating history.
 */
export async function completeTask(userId: string, id: string, userZone: string): Promise<Task | null> {
  const db = getDb();
  const existing = await getTask(userId, id);
  if (!existing) throw new Error('not-found');

  const now = isoNow();
  const zone = existing.timezone ?? userZone;

  await db.insert(taskCompletions).values({
    id: newId(),
    userId,
    taskId: id,
    completedAtMs: now,
    occurrenceDate: existing.dueDate ?? (existing.dueAtMs ? toDateOnly(existing.dueAtMs, zone) : null),
  });

  if (existing.recurrenceRule) {
    const next = nextOccurrence(existing, now, zone);
    if (next) {
      const patch: Record<string, unknown> = {
        dueDate: next.dueDate,
        dueAtMs: next.dueAtMs,
        isAllDay: next.dueAtMs === null,
        updatedAt: now,
      };
      if (await calendarSyncsToRemote(existing.calendarId, userId)) patch.syncState = 'dirty';

      await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));

      // Reminders belong to the new occurrence, not the one just finished.
      if (existing.reminders?.length) {
        await replaceReminders(
          userId,
          id,
          existing.reminders.map((r) => ({ offsetMinutes: r.offsetMinutes, absoluteAtMs: r.absoluteAtMs })),
          next.dueAtMs,
          next.dueDate,
          zone,
        );
      }

      // A parent's progress depends on its children, and vice versa.
      if (existing.parentId) await refreshParentStatus(userId, existing.parentId);

      return getTask(userId, id);
    }
    // Rule exhausted (COUNT/UNTIL) — fall through and retire the task.
  }

  const patch: Record<string, unknown> = { status: 'completed', completedAtMs: now, updatedAt: now };
  if (await calendarSyncsToRemote(existing.calendarId, userId)) patch.syncState = 'dirty';

  await db.update(tasks).set(patch).where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
  await db
    .update(taskReminders)
    .set({ sent: true, sentAtMs: now })
    .where(and(eq(taskReminders.taskId, id), eq(taskReminders.sent, false)));

  if (existing.parentId) await refreshParentStatus(userId, existing.parentId);

  return getTask(userId, id);
}

export async function uncompleteTask(userId: string, id: string): Promise<Task | null> {
  const db = getDb();
  const now = isoNow();

  await db
    .update(tasks)
    .set({ status: 'todo', completedAtMs: null, updatedAt: now })
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));

  // Drop the most recent completion so stats stay honest.
  const [latest] = await db
    .select({ id: taskCompletions.id })
    .from(taskCompletions)
    .where(and(eq(taskCompletions.taskId, id), eq(taskCompletions.userId, userId)))
    .orderBy(desc(taskCompletions.completedAtMs))
    .limit(1);
  if (latest) await db.delete(taskCompletions).where(eq(taskCompletions.id, latest.id));

  const task = await getTask(userId, id);
  if (task?.parentId) await refreshParentStatus(userId, task.parentId);
  return task;
}

/** A parent is complete only when every one of its subtasks is. */
async function refreshParentStatus(userId: string, parentId: string): Promise<void> {
  const db = getDb();
  const children = await db
    .select({ status: tasks.status })
    .from(tasks)
    .where(and(eq(tasks.userId, userId), eq(tasks.parentId, parentId), isNull(tasks.deletedAtMs)));

  if (!children.length) return;

  const allDone = children.every((c) => c.status === 'completed');
  await db
    .update(tasks)
    .set({ status: allDone ? 'completed' : 'todo', completedAtMs: allDone ? isoNow() : null, updatedAt: isoNow() })
    .where(and(eq(tasks.id, parentId), eq(tasks.userId, userId)));
}

/**
 * Soft-deletes a task.
 *
 * A task mirrored to CalDAV keeps a tombstone so the sync engine can issue the
 * remote DELETE; everything else is removed immediately. Subtasks go with their
 * parent — leaving orphans would make them invisible but still count in stats.
 */
export async function deleteTask(userId: string, id: string): Promise<void> {
  const db = getDb();
  const existing = await getTask(userId, id);
  if (!existing) return;

  const now = isoNow();
  const childIds = (existing.subtasks ?? []).map((s) => s.id);
  const allIds = [id, ...childIds];
  const syncsRemotely = await calendarSyncsToRemote(existing.calendarId, userId);

  if (syncsRemotely) {
    await db
      .update(tasks)
      .set({ deletedAtMs: now, syncState: 'pending_delete', updatedAt: now })
      .where(and(eq(tasks.userId, userId), inArray(tasks.id, allIds)));
  } else {
    await db.delete(taskReminders).where(and(eq(taskReminders.userId, userId), inArray(taskReminders.taskId, allIds)));
    await db.delete(taskTags).where(inArray(taskTags.taskId, allIds));
    await db.delete(tasks).where(and(eq(tasks.userId, userId), inArray(tasks.id, allIds)));
  }

  if (existing.parentId) await refreshParentStatus(userId, existing.parentId);
}

/** Bulk actions from the multi-select mode. */
export async function bulkUpdate(
  userId: string,
  ids: string[],
  action: 'complete' | 'delete' | 'move' | 'priority' | 'addTag' | 'removeTag',
  payload: { listId?: string | null; priority?: Priority; tagId?: string } = {},
  userZone = 'UTC',
): Promise<number> {
  if (!ids.length) return 0;
  const db = getDb();
  let affected = 0;

  for (const id of ids) {
    try {
      switch (action) {
        case 'complete':
          await completeTask(userId, id, userZone);
          break;
        case 'delete':
          await deleteTask(userId, id);
          break;
        case 'move':
          await db
            .update(tasks)
            .set({ listId: payload.listId ?? null, syncState: 'dirty', updatedAt: isoNow() })
            .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
          break;
        case 'priority':
          if (payload.priority) {
            await db
              .update(tasks)
              .set({ priority: payload.priority, syncState: 'dirty', updatedAt: isoNow() })
              .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));
          }
          break;
        case 'addTag':
          if (payload.tagId) {
            await db.insert(taskTags).values({ taskId: id, tagId: payload.tagId }).onConflictDoNothing();
          }
          break;
        case 'removeTag':
          if (payload.tagId) {
            await db.delete(taskTags).where(and(eq(taskTags.taskId, id), eq(taskTags.tagId, payload.tagId)));
          }
          break;
      }
      affected++;
    } catch {
      // Skip rows the user no longer owns rather than failing the whole batch.
    }
  }

  return affected;
}

export interface ReorderItem {
  id: string;
  listId?: string | null;
}

/**
 * Applies new positions. Accepts the full ordered id list for a list so the
 * server can recompute keys itself — a client that sends stale neighbours would
 * otherwise corrupt the ordering.
 */
export async function reorderTasks(userId: string, orderedIds: string[]): Promise<void> {
  const db = getDb();
  const keys = spreadKeys(orderedIds.length);
  const now = isoNow();

  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(tasks)
      .set({ sortOrder: keys[i], updatedAt: now, syncState: 'dirty' })
      .where(and(eq(tasks.id, orderedIds[i]), eq(tasks.userId, userId)));
  }
}

/** Moves one task between two neighbours, writing a single row. */
export async function moveTaskBetween(
  userId: string,
  id: string,
  beforeSortOrder: string | null,
  afterSortOrder: string | null,
): Promise<Task | null> {
  const db = getDb();
  const { key, needsRenumber } = keyBetween(beforeSortOrder, afterSortOrder);

  await db
    .update(tasks)
    .set({ sortOrder: key, updatedAt: isoNow(), syncState: 'dirty' })
    .where(and(eq(tasks.id, id), eq(tasks.userId, userId)));

  if (needsRenumber) {
    // The key space between the neighbours ran out; renumber the whole list.
    const [task] = await db.select({ listId: tasks.listId }).from(tasks).where(eq(tasks.id, id)).limit(1);
    const siblings = await db
      .select({ id: tasks.id, sortOrder: tasks.sortOrder })
      .from(tasks)
      .where(
        and(
          eq(tasks.userId, userId),
          isNull(tasks.deletedAtMs),
          task?.listId ? eq(tasks.listId, task.listId) : isNull(tasks.listId),
        ),
      )
      .orderBy(asc(tasks.sortOrder));

    await reorderTasks(
      userId,
      siblings.map((s) => s.id),
    );
  }

  return getTask(userId, id);
}

/** Converts a completed-task backlog into history, used by "clear completed". */
export async function clearCompleted(userId: string, listId?: string | null): Promise<number> {
  const db = getDb();
  const conditions: SQL[] = [eq(tasks.userId, userId), eq(tasks.status, 'completed')];
  if (listId) conditions.push(eq(tasks.listId, listId));

  const rows = await db.select({ id: tasks.id, calendarId: tasks.calendarId }).from(tasks).where(and(...conditions));
  let removed = 0;
  for (const row of rows) {
    await deleteTask(userId, row.id);
    removed++;
  }
  return removed;
}

/* -------------------------------------------------------------------------- */
/* agenda                                                                     */
/* -------------------------------------------------------------------------- */

export type { AgendaBuckets } from '@/lib/agenda-types';
import type { AgendaBuckets } from '@/lib/agenda-types';

/** Groups open tasks into the sections the Today view renders. */
export async function buildAgenda(userId: string, zone: string): Promise<AgendaBuckets> {
  const db = getDb();
  const today = nowIn(zone).startOf('day');
  const todayStr = today.toFormat('yyyy-MM-dd');
  const tomorrowStr = today.plus({ days: 1 }).toFormat('yyyy-MM-dd');
  const weekEndStr = today.plus({ days: 7 }).toFormat('yyyy-MM-dd');

  const openRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.userId, userId), isNull(tasks.deletedAtMs), eq(tasks.status, 'todo'), isNull(tasks.parentId)))
    .orderBy(
      desc(tasks.isPinned),
      sql`coalesce(${tasks.dueAtMs}, 9223372036854775807) asc`,
      asc(tasks.dueDate),
      sql`case ${tasks.priority} when 'high' then 0 when 'medium' then 1 when 'low' then 2 else 3 end asc`,
      asc(tasks.sortOrder),
    )
    .limit(2000);

  const completedRows = await db
    .select()
    .from(tasks)
    .where(
      and(
        eq(tasks.userId, userId),
        isNull(tasks.deletedAtMs),
        eq(tasks.status, 'completed'),
        gte(tasks.completedAtMs, today.toMillis()),
      ),
    )
    .orderBy(desc(tasks.completedAtMs))
    .limit(200);

  const [open, completed] = await Promise.all([hydrate(userId, openRows), hydrate(userId, completedRows)]);

  const buckets: AgendaBuckets = {
    overdue: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: [],
    noDate: [],
    completedToday: completed,
  };

  for (const task of open) {
    const day = task.dueDate ?? (task.dueAtMs ? toDateOnly(task.dueAtMs, zone) : null);

    if (!day) {
      buckets.noDate.push(task);
      continue;
    }
    if (day < todayStr) {
      buckets.overdue.push(task);
      continue;
    }
    if (day === todayStr) {
      buckets.today.push(task);
      continue;
    }
    if (day === tomorrowStr) {
      buckets.tomorrow.push(task);
      continue;
    }
    if (day <= weekEndStr) {
      buckets.thisWeek.push(task);
      continue;
    }
    buckets.later.push(task);
  }

  return buckets;
}

/** Eisenhower matrix quadrants, derived from due date and priority. */
export async function buildMatrix(userId: string, zone: string): Promise<{ q1: Task[]; q2: Task[]; q3: Task[]; q4: Task[] }> {
  const tasks_ = await queryTasks({ userId, zone, filter: {}, sort: 'smart', limit: 2000 });
  const todayStr = nowIn(zone).toFormat('yyyy-MM-dd');
  const soonStr = nowIn(zone).plus({ days: 3 }).toFormat('yyyy-MM-dd');

  const result = { q1: [] as Task[], q2: [] as Task[], q3: [] as Task[], q4: [] as Task[] };

  for (const task of tasks_) {
    const day = task.dueDate ?? (task.dueAtMs ? toDateOnly(task.dueAtMs, zone) : null);
    const urgent = Boolean(day && day <= soonStr) || (day !== null && day < todayStr);
    const important = priorityWeight(task.priority) >= 2;

    if (urgent && important) result.q1.push(task);
    else if (!urgent && important) result.q2.push(task);
    else if (urgent && !important) result.q3.push(task);
    else result.q4.push(task);
  }

  return result;
}

/** Distinct list ids referenced by a filter — used by bulk operations. */
export async function listIdsForUser(userId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db.select({ id: lists.id }).from(lists).where(eq(lists.userId, userId));
  return rows.map((r) => r.id);
}
