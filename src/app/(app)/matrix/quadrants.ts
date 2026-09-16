/**
 * Eisenhower quadrants: classification, and the patch a drop translates into.
 *
 * The classification **mirrors the server's rule exactly** (`buildMatrix` in
 * `src/server/repos/tasks.ts`): urgent means due within three days or overdue,
 * important means priority high or medium. Mirroring it here rather than
 * inventing a second definition is the whole point — the matrix the user sees is
 * the matrix the server would build.
 *
 * Pure and clock-injected so the rules can be tested without a DOM.
 */
import { addDaysToDateOnly, combineDateAndTime, priorityWeight, timeIn, toDateOnly } from '@/lib/dates';
import type { DateOnly, Priority, Task } from '@/lib/types';

export type QuadrantId = 'q1' | 'q2' | 'q3' | 'q4';

/** Days ahead that still count as "urgent". Matches the server. */
export const URGENT_WINDOW_DAYS = 3;

export interface QuadrantDefinition {
  id: QuadrantId;
  /** Full name, as the headings read. */
  title: string;
  /** One-line strategy hint. */
  hint: string;
  important: boolean;
  urgent: boolean;
  color: 'red' | 'blue' | 'orange' | 'gray';
}

export const QUADRANTS: readonly QuadrantDefinition[] = [
  { id: 'q1', title: 'Urgent and important', hint: 'Do it now', important: true, urgent: true, color: 'red' },
  { id: 'q2', title: 'Important, not urgent', hint: 'Schedule it', important: true, urgent: false, color: 'blue' },
  { id: 'q3', title: 'Urgent, not important', hint: 'Delegate it', important: false, urgent: true, color: 'orange' },
  { id: 'q4', title: 'Neither', hint: 'Let it go', important: false, urgent: false, color: 'gray' },
];

export function quadrantById(id: QuadrantId): QuadrantDefinition {
  return QUADRANTS.find((quadrant) => quadrant.id === id) ?? QUADRANTS[0];
}

/** The floating day a task is due on, as the server computes it. */
export function taskDueDay(
  task: Pick<Task, 'dueDate' | 'dueAtMs'>,
  zone: string,
): DateOnly | null {
  if (task.dueDate) return task.dueDate;
  if (task.dueAtMs) return toDateOnly(task.dueAtMs, zone);
  return null;
}

/** Due within three days, or already overdue. */
export function isUrgent(task: Pick<Task, 'dueDate' | 'dueAtMs'>, today: DateOnly, zone: string): boolean {
  const day = taskDueDay(task, zone);
  if (day === null) return false;
  return day <= addDaysToDateOnly(today, URGENT_WINDOW_DAYS, zone);
}

/** High or medium priority. */
export function isImportant(task: Pick<Task, 'priority'>): boolean {
  return priorityWeight(task.priority) >= 2;
}

export function quadrantOf(task: Pick<Task, 'dueDate' | 'dueAtMs' | 'priority'>, today: DateOnly, zone: string): QuadrantId {
  const urgent = isUrgent(task, today, zone);
  const important = isImportant(task);
  if (urgent && important) return 'q1';
  if (!urgent && important) return 'q2';
  if (urgent && !important) return 'q3';
  return 'q4';
}

export type QuadrantBuckets = Record<QuadrantId, Task[]>;

/** Buckets tasks into the four quadrants, preserving the incoming order. */
export function groupByQuadrant(tasks: readonly Task[], today: DateOnly, zone: string): QuadrantBuckets {
  const buckets: QuadrantBuckets = { q1: [], q2: [], q3: [], q4: [] };
  for (const task of tasks) buckets[quadrantOf(task, today, zone)].push(task);
  return buckets;
}

/** The subset of `updateTaskSchema` a quadrant drop needs. */
export interface QuadrantPatch {
  priority?: Priority;
  dueDate?: DateOnly;
  dueTime?: string;
  clearDue?: boolean;
}

export interface QuadrantDrop {
  quadrant: QuadrantDefinition;
  /** Fields to PATCH. Empty when the task already belongs there. */
  patch: QuadrantPatch;
  /** Human sentences describing exactly what changed, for the toast. */
  changes: string[];
}

/**
 * Translates a drop into the smallest edit that puts the task in that quadrant.
 *
 * The urgency axis is a due date, so moving a task between the urgent and
 * non-urgent rows rewrites its due date — which is why the caller must explain
 * the action in a toast rather than moving a card silently.
 *
 * The importance axis only touches `priority` when the task's importance would
 * actually change, so dragging a task one row down does not needlessly demote a
 * High priority to Medium. A timed task keeps its clock time; only the day
 * moves.
 */
export function planDrop(task: Task, target: QuadrantId, today: DateOnly, zone: string): QuadrantDrop {
  const quadrant = quadrantById(target);
  const patch: QuadrantPatch = {};
  const changes: string[] = [];

  if (isImportant(task) !== quadrant.important) {
    patch.priority = quadrant.important ? 'medium' : 'low';
    changes.push(quadrant.important ? 'priority raised to Medium' : 'priority lowered to Low');
  }

  if (isUrgent(task, today, zone) !== quadrant.urgent) {
    if (quadrant.urgent) {
      patch.dueDate = today;
      // Keep the clock time of a timed task; PATCHing only the day would make it
      // all-day, which is a silent data loss.
      if (!task.isAllDay && task.dueAtMs) patch.dueTime = timeIn(task.dueAtMs, zone);
      changes.push('due date moved to today');
    } else {
      patch.clearDue = true;
      changes.push('due date cleared');
    }
  }

  return { quadrant, patch, changes };
}

/** Toast copy for a drop. */
export function dropMessage(task: Pick<Task, 'title'>, drop: QuadrantDrop): string {
  if (drop.changes.length === 0) {
    return `“${task.title}” is already in ${drop.quadrant.title}.`;
  }
  return `“${task.title}” moved to ${drop.quadrant.title}: ${drop.changes.join(' and ')}.`;
}

/**
 * Applies a drop plan to a local copy, so the card lands in its new quadrant
 * before the server answers. The field handling matches `resolveDue` on the
 * server: a day without a time is an all-day task.
 */
export function applyDropLocally(task: Task, patch: QuadrantPatch, zone: string): Task {
  const next: Task = { ...task };

  if (patch.priority !== undefined) next.priority = patch.priority;

  if (patch.clearDue) {
    next.dueDate = null;
    next.dueAtMs = null;
    next.isAllDay = true;
  } else if (patch.dueDate !== undefined) {
    next.dueDate = patch.dueDate;
    next.isAllDay = !patch.dueTime;
    next.dueAtMs = patch.dueTime ? combineDateAndTime(patch.dueDate, patch.dueTime, zone) : null;
  }

  return next;
}

/** Neighbouring quadrant for keyboard moves: the 2×2 grid in reading order. */
export function neighbourQuadrant(id: QuadrantId, key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight'): QuadrantId | null {
  const index = QUADRANTS.findIndex((quadrant) => quadrant.id === id);
  if (index < 0) return null;
  const row = Math.floor(index / 2);
  const column = index % 2;

  switch (key) {
    case 'ArrowUp':
      return row === 0 ? null : QUADRANTS[(row - 1) * 2 + column].id;
    case 'ArrowDown':
      return row === 1 ? null : QUADRANTS[(row + 1) * 2 + column].id;
    case 'ArrowLeft':
      return column === 0 ? null : QUADRANTS[row * 2 + column - 1].id;
    case 'ArrowRight':
    default:
      return column === 1 ? null : QUADRANTS[row * 2 + column + 1].id;
  }
}
