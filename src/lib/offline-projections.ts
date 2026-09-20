/**
 * What a queued CREATE looks like on screen before the server has seen it.
 *
 * ## Why this exists
 *
 * Every *update* in this app is already optimistic: the screen changes first and
 * the write follows (`TasksView.toggleTask`, the habits page's check-in, the
 * calendar's drag). Those keep working offline untouched — the store refuses to
 * apply a server response over a resource with a pending write, so the local
 * change survives.
 *
 * A *create* is different. There is nothing optimistic about it today: the
 * component posts, then invalidates and refetches, and the new row appears
 * because the server sent it back. Offline there is no server response, so the
 * row would never appear — the user taps Add, sees "Task added", and the list is
 * unchanged. That is the one gap this module closes: a queued create is turned
 * into the entity the endpoint would have returned, and inserted into the cached
 * reads it belongs to.
 *
 * It is deliberately best-effort and self-correcting:
 *
 *   - The placeholder carries the same `temp:<id>` the caller received, so the
 *     UI, the queue and the eventual server id all refer to one thing.
 *   - Defaults mirror the server's own (`createTask` in `src/server/repos/tasks.ts`),
 *     so a placeholder renders through exactly the same code as a saved row.
 *   - The moment the write lands, `invalidate()` marks the affected reads stale
 *     and they are refetched: the real entity replaces the placeholder, with its
 *     real id, sort order and server-assigned fields.
 *
 * Only creates that have a single obvious home in the cache are projected. A
 * created event needs a day bucket and a layout (`/api/calendar/items`) that this
 * layer cannot honestly invent, so it is left to appear on sync.
 */
import type { CalendarEvent, Habit, List, Task } from './types';

const DEFAULT_ACCENT = 'blue';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function str(value: unknown, fallback: string | null = null): string | null {
  return typeof value === 'string' ? value : fallback;
}

function num(value: unknown, fallback: number | null = null): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export interface CreateProjection {
  /** The cached read (by pathname) the entity belongs in. */
  resource: string;
  entity: Task | List | Habit | CalendarEvent;
}

/**
 * The placeholder entity for a queued create, or `null` for a create this layer
 * will not guess at.
 */
export function projectQueuedCreate(
  path: string,
  body: unknown,
  tempId: string | undefined,
  now: number,
): CreateProjection | null {
  if (!tempId) return null;
  const pathname = path.split('?')[0];
  const input = asRecord(body);

  if (pathname === '/api/tasks') {
    const task: Task = {
      id: tempId,
      // No session is needed to render a row, so the placeholder is not
      // pretends to know whose task it is.
      userId: '',
      listId: str(input.listId),
      parentId: str(input.parentId),
      title: str(input.title, 'Untitled') ?? 'Untitled',
      notes: str(input.notes),
      url: str(input.url),
      status: (str(input.status, 'todo') as Task['status']) ?? 'todo',
      priority: (str(input.priority, 'none') as Task['priority']) ?? 'none',
      dueAtMs: num(input.dueAtMs),
      dueDate: str(input.dueDate),
      startAtMs: num(input.startAtMs),
      startDate: str(input.startDate),
      isAllDay: input.isAllDay === true,
      timezone: str(input.timezone),
      completedAtMs: null,
      recurrenceRule: str(input.recurrenceRule),
      recurrenceMode: (str(input.recurrenceMode, 'due') as Task['recurrenceMode']) ?? 'due',
      recurrenceId: null,
      estimateMinutes: num(input.estimateMinutes),
      spentMinutes: 0,
      // Empty sorts last-ish among strings, which is where the server would put
      // a task with no explicit order. The real value arrives on sync.
      sortOrder: str(input.sortOrder, '') ?? '',
      isPinned: input.isPinned === true,
      calendarId: str(input.calendarId),
      syncProvider: 'local',
      syncState: 'synced',
      externalUid: null,
      externalHref: null,
      externalEtag: null,
      lastSyncedAtMs: null,
      createdAt: now,
      updatedAt: now,
      deletedAtMs: null,
      tagIds: Array.isArray(input.tagIds) ? (input.tagIds.filter((id) => typeof id === 'string') as string[]) : [],
      tags: [],
      subtasks: [],
      reminders: [],
    };
    return { resource: '/api/tasks', entity: task };
  }

  if (pathname === '/api/lists') {
    const list: List = {
      id: tempId,
      userId: '',
      name: str(input.name, 'New list') ?? 'New list',
      description: str(input.description),
      color: (str(input.color, DEFAULT_ACCENT) as List['color']) ?? DEFAULT_ACCENT,
      emoji: str(input.emoji),
      sortOrder: str(input.sortOrder, '') ?? '',
      archived: false,
      isInbox: false,
      createdAt: now,
      updatedAt: now,
    };
    return { resource: '/api/lists', entity: list };
  }

  if (pathname === '/api/habits') {
    const habit: Habit = {
      id: tempId,
      userId: '',
      name: str(input.name, 'New habit') ?? 'New habit',
      description: str(input.description),
      icon: str(input.icon, 'target') ?? 'target',
      color: (str(input.color, DEFAULT_ACCENT) as Habit['color']) ?? DEFAULT_ACCENT,
      goalType: (str(input.goalType, 'boolean') as Habit['goalType']) ?? 'boolean',
      goalTarget: num(input.goalTarget, 1) ?? 1,
      unit: str(input.unit),
      frequency: (str(input.frequency, 'daily') as Habit['frequency']) ?? 'daily',
      weekDays: Array.isArray(input.weekDays) ? (input.weekDays.filter((day) => typeof day === 'number') as number[]) : null,
      timesPerPeriod: num(input.timesPerPeriod, 1) ?? 1,
      startDate: str(input.startDate, '') ?? '',
      reminders: Array.isArray(input.reminders)
        ? (input.reminders.filter((value) => typeof value === 'number') as number[])
        : null,
      archived: false,
      sortOrder: str(input.sortOrder, '') ?? '',
      createdAt: now,
      updatedAt: now,
      entries: {},
      streak: 0,
    };
    return { resource: '/api/habits', entity: habit };
  }

  return null;
}

/**
 * Inserts a placeholder into a cached payload.
 *
 * Two shapes exist in this app: a bare array (`/api/tasks`, `/api/habits`,
 * `/api/lists`) and an envelope with an `items` array (`/api/calendar/items`).
 * Anything else is returned untouched — a projection must never be able to
 * corrupt a payload it does not recognise.
 */
export function insertProjectedEntity(payload: unknown, entity: unknown): unknown {
  if (Array.isArray(payload)) {
    if (payload.some((item) => sameId(item, entity))) return payload;
    return [...payload, entity];
  }

  if (payload && typeof payload === 'object' && Array.isArray((payload as { items?: unknown[] }).items)) {
    const envelope = payload as { items: unknown[] };
    if (envelope.items.some((item) => sameId(item, entity))) return payload;
    return { ...envelope, items: [...envelope.items, entity] };
  }

  return payload;
}

function sameId(candidate: unknown, entity: unknown): boolean {
  if (!candidate || typeof candidate !== 'object' || !entity || typeof entity !== 'object') return false;
  const a = (candidate as { id?: unknown }).id;
  const b = (entity as { id?: unknown }).id;
  return typeof a === 'string' && a === b;
}
