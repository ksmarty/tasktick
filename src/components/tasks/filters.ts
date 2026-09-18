/**
 * URL ↔ task-filter translation for `/tasks`.
 *
 * The URL is the single source of truth for the task list: it makes a filtered
 * view shareable, keeps the back button honest, and means the resource cache key
 * (`/api/tasks?...`) is derived from something the user can see.
 *
 * Pure, so the mapping is unit-tested in `tests/tasks-filters.test.ts`.
 *
 * ## Sort direction
 *
 * The order a list is shown in is a two-axis choice now: which key (`sort`) and
 * which way (`sortDir`). The API takes no direction parameter, so `desc` is
 * applied to the fetched page here, by `sortTasks` — a presentation reversal
 * rather than a second query. Only the sorts where a reverse is meaningful carry
 * a direction; see `DIRECTIONAL_SORTS`.
 */
import type { Priority, Task } from '@/lib/types';

export type TaskSort = 'smart' | 'due' | 'created' | 'updated' | 'priority' | 'title' | 'manual';
export type TaskSortDir = 'asc' | 'desc';
export type TaskWindow = 'today' | 'next7days' | 'all' | 'completed' | 'overdue' | 'noDate';

export interface TaskViewState {
  listId: string | null;
  tagId: string | null;
  window: TaskWindow;
  q: string;
  sort: TaskSort;
  /** Which way `sort` runs. Ignored by the sorts that cannot be reversed. */
  sortDir: TaskSortDir;
  priority: Priority | null;
}

export const TASK_WINDOWS: readonly { value: TaskWindow; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'today', label: 'Today' },
  { value: 'next7days', label: 'Next 7 days' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'noDate', label: 'No date' },
  { value: 'completed', label: 'Completed' },
];

export const TASK_SORTS: readonly { value: TaskSort; label: string }[] = [
  { value: 'smart', label: 'Smart' },
  { value: 'due', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'manual', label: 'Manual' },
];

export const DEFAULT_TASK_VIEW: TaskViewState = {
  listId: null,
  tagId: null,
  window: 'all',
  q: '',
  sort: 'smart',
  sortDir: 'asc',
  priority: null,
};

/**
 * The sorts for which a reverse order means something.
 *
 * `smart` is a ranking, `manual` is a stored order and `updated` is a recency
 * feed — reversing any of them would be a different sort, not the same one read
 * backwards. Everything else has a natural first-to-last axis.
 */
export const DIRECTIONAL_SORTS: readonly TaskSort[] = ['due', 'priority', 'title', 'created'];

/** Whether the sort carries a user-selectable direction. */
export function isDirectionalSort(sort: TaskSort): boolean {
  return DIRECTIONAL_SORTS.includes(sort);
}

/**
 * The direction a sort starts in: the server's own default order, so an old
 * link without a `dir` keeps reading exactly as it did before.
 */
export function defaultSortDir(sort: TaskSort): TaskSortDir {
  // The server orders `created` newest-first; every other directional sort is
  // ascending (soonest / highest / A→Z).
  return sort === 'created' ? 'desc' : 'asc';
}

/** Human phrase for the direction, for the trigger's accessible name. */
export function sortDirLabel(dir: TaskSortDir): string {
  return dir === 'asc' ? 'ascending' : 'descending';
}

const WINDOW_VALUES = TASK_WINDOWS.map((item) => item.value);
const SORT_VALUES = TASK_SORTS.map((item) => item.value);
const SORT_DIR_VALUES: readonly TaskSortDir[] = ['asc', 'desc'];
const PRIORITY_VALUES: readonly Priority[] = ['none', 'low', 'medium', 'high'];

function isWindow(value: string | null): value is TaskWindow {
  return value !== null && (WINDOW_VALUES as readonly string[]).includes(value);
}

function isSort(value: string | null): value is TaskSort {
  return value !== null && (SORT_VALUES as readonly string[]).includes(value);
}

function isSortDir(value: string | null): value is TaskSortDir {
  return value !== null && (SORT_DIR_VALUES as readonly string[]).includes(value);
}

function isPriority(value: string | null): value is Priority {
  return value !== null && (PRIORITY_VALUES as readonly string[]).includes(value);
}

/** Reads the view state out of a query string (with or without the `?`). */
export function parseTaskView(search: string): TaskViewState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const window = params.get('window');
  const sort = params.get('sort');
  const priority = params.get('priority');
  const dir = params.get('dir');

  const parsedSort = isSort(sort) ? sort : DEFAULT_TASK_VIEW.sort;

  return {
    listId: params.get('list') || null,
    tagId: params.get('tag') || null,
    window: isWindow(window) ? window : DEFAULT_TASK_VIEW.window,
    q: params.get('q') ?? '',
    sort: parsedSort,
    // A direction only means something for a directional sort; elsewhere it is
    // dropped so the state can never claim a reversal a `smart` order cannot do.
    sortDir:
      isDirectionalSort(parsedSort) && isSortDir(dir) ? dir : defaultSortDir(parsedSort),
    priority: isPriority(priority) ? priority : null,
  };
}

/** Serialises the view state, omitting anything still at its default. */
export function serializeTaskView(state: TaskViewState): string {
  const params = new URLSearchParams();
  if (state.listId) params.set('list', state.listId);
  if (state.tagId) params.set('tag', state.tagId);
  if (state.window !== DEFAULT_TASK_VIEW.window) params.set('window', state.window);
  if (state.q.trim()) params.set('q', state.q.trim());
  if (state.sort !== DEFAULT_TASK_VIEW.sort) params.set('sort', state.sort);
  // Additive: `dir` only appears when it differs from the sort's own default, so
  // links written before direction existed still parse and re-serialise cleanly.
  if (isDirectionalSort(state.sort) && state.sortDir !== defaultSortDir(state.sort)) {
    params.set('dir', state.sortDir);
  }
  if (state.priority) params.set('priority', state.priority);
  return params.toString();
}

export function updateTaskView(state: TaskViewState, patch: Partial<TaskViewState>): TaskViewState {
  return { ...state, ...patch };
}

/** Removes one filter, leaving the rest of the view untouched. */
export function clearFilter(state: TaskViewState, key: 'list' | 'tag' | 'window' | 'q' | 'priority'): TaskViewState {
  switch (key) {
    case 'list':
      return { ...state, listId: null };
    case 'tag':
      return { ...state, tagId: null };
    case 'window':
      return { ...state, window: DEFAULT_TASK_VIEW.window };
    case 'priority':
      return { ...state, priority: null };
    case 'q':
    default:
      return { ...state, q: '' };
  }
}

/**
 * Query for `GET /api/tasks`.
 *
 * `completed` is a status filter rather than a due window, and `all` has to ask
 * for completed rows explicitly — the server forces `status = 'todo'` otherwise.
 */
export function taskQuery(state: TaskViewState): Record<string, string | number | undefined> {
  const query: Record<string, string | number | undefined> = { sort: state.sort };

  if (state.q.trim()) query.text = state.q.trim();
  if (state.listId) query.listIds = state.listId;
  if (state.tagId) query.tagIds = state.tagId;
  if (state.priority) query.priorities = state.priority;

  if (state.window === 'completed') {
    query.statuses = 'completed';
    query.includeCompleted = 1;
  } else if (state.window === 'all') {
    query.includeCompleted = 1;
  } else {
    query.dueWindow = state.window;
  }

  return query;
}

/** Priority rank for sorting: high first, `none` last. */
const PRIORITY_RANK: Record<Priority, number> = { high: 0, medium: 1, low: 2, none: 3 };

/** The instant a task is due — its `dueAtMs`, else its floating day at UTC midnight. */
function dueSortInstant(task: Task): number | null {
  if (task.dueAtMs !== null) return task.dueAtMs;
  if (task.dueDate) return Date.parse(`${task.dueDate}T00:00:00Z`);
  return null;
}

function compareTasks(a: Task, b: Task, sort: TaskSort, dir: TaskSortDir): number {
  const sign = dir === 'asc' ? 1 : -1;
  switch (sort) {
    case 'title':
      return sign * a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
    case 'created':
      return sign * (a.createdAt - b.createdAt);
    case 'priority': {
      // An unset priority is the absence of a value, not the far end of the
      // scale, so it stays last whichever way the sort runs — its ordering is
      // deliberately outside the `sign`.
      if (a.priority === 'none' || b.priority === 'none') {
        if (a.priority === 'none' && b.priority === 'none') return 0;
        return a.priority === 'none' ? 1 : -1;
      }
      return sign * (PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
    }
    case 'due': {
      const ad = dueSortInstant(a);
      const bd = dueSortInstant(b);
      if (ad === null || bd === null) {
        if (ad === null && bd === null) return 0;
        return ad === null ? 1 : -1;
      }
      return sign * (ad - bd);
    }
    default:
      return 0;
  }
}

/**
 * Applies the chosen direction to an already-fetched page.
 *
 * The API sorts but takes no direction parameter, so a descending order is this
 * reversal rather than a second request. Non-directional sorts (`smart`,
 * `updated`, `manual`) keep the server's order untouched, and undated / unset
 * rows stay last in both directions.
 */
export function sortTasks(tasks: readonly Task[], sort: TaskSort, dir: TaskSortDir): Task[] {
  if (!isDirectionalSort(sort)) return [...tasks];
  return [...tasks].sort((a, b) => compareTasks(a, b, sort, dir));
}

export interface FilterLookups {
  lists: readonly { id: string; name: string }[];
  tags: readonly { id: string; name: string }[];
}

export interface ActiveFilter {
  key: 'list' | 'tag' | 'window' | 'q' | 'priority';
  label: string;
  /** Raw value, for the accessible remove label. */
  value: string;
}

/** The filters that are actually narrowing the list: the filter sheet marks
 * them, and the header's filter button tints while any is set. */
export function activeFilters(state: TaskViewState, lookups: FilterLookups): ActiveFilter[] {
  const chips: ActiveFilter[] = [];

  if (state.listId) {
    const list = lookups.lists.find((item) => item.id === state.listId);
    chips.push({ key: 'list', label: list?.name ?? 'List', value: state.listId });
  }
  if (state.tagId) {
    const tag = lookups.tags.find((item) => item.id === state.tagId);
    chips.push({ key: 'tag', label: `#${tag?.name ?? 'Tag'}`, value: state.tagId });
  }
  if (state.window !== DEFAULT_TASK_VIEW.window) {
    const window = TASK_WINDOWS.find((item) => item.value === state.window);
    chips.push({ key: 'window', label: window?.label ?? state.window, value: state.window });
  }
  if (state.priority) {
    chips.push({ key: 'priority', label: state.priority, value: state.priority });
  }
  if (state.q.trim()) {
    chips.push({ key: 'q', label: `“${state.q.trim()}”`, value: state.q.trim() });
  }

  return chips;
}

/** Browser title / navbar title for the current view. */
export function taskViewTitle(state: TaskViewState, lookups: FilterLookups): string {
  if (state.listId) {
    const list = lookups.lists.find((item) => item.id === state.listId);
    if (list) return list.name;
  }
  switch (state.window) {
    case 'today':
      return 'Today';
    case 'next7days':
      return 'Next 7 days';
    case 'overdue':
      return 'Overdue';
    case 'noDate':
      return 'No date';
    case 'completed':
      return 'Completed';
    default:
      return 'All tasks';
  }
}
