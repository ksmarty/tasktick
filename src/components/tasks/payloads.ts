/**
 * Wire shapes the task views send to the API.
 *
 * Declared here rather than imported from `@/server/repos/tasks` so no server
 * module is reachable from the browser bundle; the fields mirror
 * `createTaskSchema` / `updateTaskSchema` in `@/lib/schemas`.
 */
import type { AccentColor, DateOnly, Priority, TaskStatus, TimeOnly } from '@/lib/types';

/** Body of `POST /api/tasks`. */
export interface CreateTaskPayload {
  title: string;
  notes?: string | null;
  url?: string | null;
  listId?: string | null;
  parentId?: string | null;
  priority?: Priority;
  status?: TaskStatus;
  dueDate?: DateOnly | null;
  /** `HH:mm`; `null` means an all-day task on `dueDate`. */
  dueTime?: TimeOnly | null;
  estimateMinutes?: number | null;
  recurrenceRule?: string | null;
  recurrenceMode?: 'due' | 'completion';
  /** Server creates any tag that does not exist yet. */
  tagNames?: string[];
  tagIds?: string[];
  reminders?: { offsetMinutes: number | null; absoluteAtMs?: number | null }[];
  isPinned?: boolean;
  /**
   * The calendar the task is filed into, which is also what makes it sync: the
   * server marks a task in a writable CalDAV collection dirty and pushes it.
   * `null` means no collection at all.
   */
  calendarId?: string | null;
}

/** Body of `PATCH /api/tasks/[id]` — every field optional, with explicit clears. */
export interface TaskPatch {
  title?: string;
  notes?: string | null;
  url?: string | null;
  listId?: string | null;
  priority?: Priority;
  status?: TaskStatus;
  dueDate?: DateOnly | null;
  dueTime?: TimeOnly | null;
  clearDue?: boolean;
  recurrenceRule?: string | null;
  clearRecurrence?: boolean;
  recurrenceMode?: 'due' | 'completion';
  estimateMinutes?: number | null;
  tagIds?: string[];
  tagNames?: string[];
  reminders?: { offsetMinutes: number | null; absoluteAtMs?: number | null }[];
  clearReminders?: boolean;
  isPinned?: boolean;
  /**
   * Moving the task to another calendar, or out of every calendar with `null`.
   * The server treats this as a detach: the old collection's copy is deleted on
   * the next sync rather than left behind (see `applyRemoteTask`).
   */
  calendarId?: string | null;
}

/** Body of `PATCH /api/lists/[id]` — every field optional. */
export interface ListPatch {
  name?: string;
  description?: string | null;
  color?: AccentColor;
  emoji?: string | null;
  archived?: boolean;
}

export type BulkAction = 'complete' | 'delete' | 'move' | 'priority' | 'addTag' | 'removeTag';

/** Body of `POST /api/tasks/bulk`. */
export interface BulkPayload {
  listId?: string | null;
  priority?: Priority;
  tagId?: string;
}
