/**
 * Optimistic list maths.
 *
 * Every function here is pure and returns NEW arrays/objects: the store's
 * `mutate` publishes the value it is handed, so mutating the resource's `data`
 * in place would leave React with nothing to re-render. Keeping the maths out of
 * the components also makes the drag/drop rules testable without a DOM.
 */
import type { AgendaBuckets } from '@/lib/agenda-types';
import type { Millis, Priority, Task, TaskStatus } from '@/lib/types';
import { SECTION_BUCKET } from './sections';

/** Completed and projected rows must never be reordered. */
export function canReorder(task: Pick<Task, 'status' | 'isProjection'>): boolean {
  return task.status === 'todo' && task.isProjection !== true;
}

export function reorderableIds(tasks: readonly Task[]): string[] {
  return tasks.filter(canReorder).map((task) => task.id);
}

/** Moves one entry in a list, clamping the destination into range. */
export function moveId(ids: readonly string[], from: number, to: number): string[] {
  if (from < 0 || from >= ids.length) return [...ids];
  const next = [...ids];
  const target = Math.max(0, Math.min(ids.length - 1, to));
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/**
 * The ordering produced by dropping `draggedId` immediately before or after
 * `overId`. Unknown ids and no-op drops return an unchanged copy, which lets
 * callers skip the network round trip.
 */
export function reorderIds(
  ids: readonly string[],
  draggedId: string,
  overId: string,
  edge: 'before' | 'after',
): string[] {
  if (draggedId === overId) return [...ids];
  const from = ids.indexOf(draggedId);
  const over = ids.indexOf(overId);
  if (from < 0 || over < 0) return [...ids];

  const without = ids.filter((id) => id !== draggedId);
  const anchor = without.indexOf(overId);
  if (anchor < 0) return [...ids];

  const insertAt = edge === 'before' ? anchor : anchor + 1;
  without.splice(insertAt, 0, draggedId);
  return without;
}

/**
 * Reorders `items` into `orderedIds`. Items the caller did not mention keep
 * their relative order at the end, and ids with no matching item are ignored, so
 * a stale optimistic payload can never drop a row from the screen.
 */
export function applyOrder<T extends { id: string }>(items: readonly T[], orderedIds: readonly string[]): T[] {
  const index = new Map<string, number>();
  orderedIds.forEach((id, position) => {
    if (!index.has(id)) index.set(id, position);
  });

  return items
    .map((item, original) => ({ item, original, rank: index.get(item.id) }))
    .sort((a, b) => {
      if (a.rank === undefined && b.rank === undefined) return a.original - b.original;
      if (a.rank === undefined) return 1;
      if (b.rank === undefined) return -1;
      return a.rank - b.rank;
    })
    .map((entry) => entry.item);
}

/** Applies a partial update to one row, returning a new array. */
export function patchById(tasks: readonly Task[], id: string, patch: Partial<Task>): Task[] {
  return tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
}

/** Applies a partial update to many rows at once. */
export function patchByIds(tasks: readonly Task[], ids: ReadonlySet<string>, patch: Partial<Task>): Task[] {
  if (ids.size === 0) return [...tasks];
  return tasks.map((task) => (ids.has(task.id) ? { ...task, ...patch } : task));
}

export function setStatusById(
  tasks: readonly Task[],
  id: string,
  status: TaskStatus,
  nowMs: Millis,
): Task[] {
  return patchById(tasks, id, {
    status,
    completedAtMs: status === 'completed' ? nowMs : null,
  });
}

export function setStatusByIds(
  tasks: readonly Task[],
  ids: ReadonlySet<string>,
  status: TaskStatus,
  nowMs: Millis,
): Task[] {
  return patchByIds(tasks, ids, { status, completedAtMs: status === 'completed' ? nowMs : null });
}

export function removeByIds(tasks: readonly Task[], ids: ReadonlySet<string>): Task[] {
  if (ids.size === 0) return [...tasks];
  return tasks.filter((task) => !ids.has(task.id));
}

export function setPriorityByIds(tasks: readonly Task[], ids: ReadonlySet<string>, priority: Priority): Task[] {
  return patchByIds(tasks, ids, { priority });
}

/** Replaces the whole list with `orderedIds` order, keeping unlisted rows. */
export function reorderList(tasks: readonly Task[], orderedIds: readonly string[]): Task[] {
  return applyOrder(tasks, orderedIds);
}

/* -------------------------------------------------------------------------- */
/* agenda                                                                     */
/* -------------------------------------------------------------------------- */

function agendaWithBucket(agenda: AgendaBuckets, bucket: keyof AgendaBuckets, tasks: Task[]): AgendaBuckets {
  return { ...agenda, [bucket]: tasks };
}

/**
 * Ticks a task off inside the agenda: it leaves every open bucket and lands at
 * the top of "Completed today".
 *
 * Un-ticking only removes the row from "Completed today"; which day it belongs
 * to is the server's call, and the invalidated bootstrap refetch puts it back in
 * the right bucket a moment later.
 */
export function setAgendaStatus(
  agenda: AgendaBuckets,
  id: string,
  status: TaskStatus,
  nowMs: Millis,
): AgendaBuckets {
  const existing =
    agenda.completedToday.find((task) => task.id === id) ??
    agenda.overdue.find((task) => task.id === id) ??
    agenda.today.find((task) => task.id === id) ??
    agenda.tomorrow.find((task) => task.id === id) ??
    agenda.thisWeek.find((task) => task.id === id) ??
    agenda.later.find((task) => task.id === id) ??
    agenda.noDate.find((task) => task.id === id) ??
    null;

  // The task is not in the agenda at all: nothing to move, and inventing a row
  // would put a half-built task on screen.
  if (!existing) return agenda;

  const ticked: Task = {
    ...existing,
    status,
    completedAtMs: status === 'completed' ? nowMs : null,
  };

  const stripped: AgendaBuckets = {
    overdue: agenda.overdue.filter((task) => task.id !== id),
    today: agenda.today.filter((task) => task.id !== id),
    tomorrow: agenda.tomorrow.filter((task) => task.id !== id),
    thisWeek: agenda.thisWeek.filter((task) => task.id !== id),
    later: agenda.later.filter((task) => task.id !== id),
    noDate: agenda.noDate.filter((task) => task.id !== id),
    completedToday: agenda.completedToday.filter((task) => task.id !== id),
  };

  if (status === 'completed') stripped.completedToday = [ticked, ...stripped.completedToday];
  return stripped;
}

/**
 * Flips one task's pin flag wherever it sits in the agenda.
 *
 * Pinning does not move a row between Today's buckets — the agenda groups by
 * day, not by pin — so this only touches the flag the row's pin glyph reads.
 * The list screen regroups from its own `buildListSections` pass.
 */
export function setAgendaPinned(agenda: AgendaBuckets, id: string, isPinned: boolean): AgendaBuckets {
  const ids: ReadonlySet<string> = new Set([id]);
  return {
    overdue: patchByIds(agenda.overdue, ids, { isPinned }),
    today: patchByIds(agenda.today, ids, { isPinned }),
    tomorrow: patchByIds(agenda.tomorrow, ids, { isPinned }),
    thisWeek: patchByIds(agenda.thisWeek, ids, { isPinned }),
    later: patchByIds(agenda.later, ids, { isPinned }),
    noDate: patchByIds(agenda.noDate, ids, { isPinned }),
    completedToday: patchByIds(agenda.completedToday, ids, { isPinned }),
  };
}

export function removeFromAgenda(agenda: AgendaBuckets, ids: ReadonlySet<string>): AgendaBuckets {
  return {
    overdue: agenda.overdue.filter((task) => !ids.has(task.id)),
    today: agenda.today.filter((task) => !ids.has(task.id)),
    tomorrow: agenda.tomorrow.filter((task) => !ids.has(task.id)),
    thisWeek: agenda.thisWeek.filter((task) => !ids.has(task.id)),
    later: agenda.later.filter((task) => !ids.has(task.id)),
    noDate: agenda.noDate.filter((task) => !ids.has(task.id)),
    completedToday: agenda.completedToday.filter((task) => !ids.has(task.id)),
  };
}

/**
 * Publishes a new manual order for one Today section. Used for the optimistic
 * half of a drag: the drop POSTs the same id list to `/api/tasks/reorder`.
 */
export function reorderAgendaSection(
  agenda: AgendaBuckets,
  sectionId: string,
  orderedIds: readonly string[],
): AgendaBuckets {
  const bucket = SECTION_BUCKET[sectionId];
  if (!bucket) return agenda;
  return agendaWithBucket(agenda, bucket, applyOrder(agenda[bucket], orderedIds));
}
