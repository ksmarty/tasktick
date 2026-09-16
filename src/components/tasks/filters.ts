/**
 * URL ↔ task-filter translation for `/tasks`.
 *
 * The URL is the single source of truth for the task list: it makes a filtered
 * view shareable, keeps the back button honest, and means the resource cache key
 * (`/api/tasks?...`) is derived from something the user can see.
 *
 * Pure, so the mapping is unit-tested in `tests/tasks-filters.test.ts`.
 */
import type { Priority } from '@/lib/types';

export type TaskSort = 'smart' | 'due' | 'created' | 'updated' | 'priority' | 'title' | 'manual';
export type TaskWindow = 'today' | 'next7days' | 'all' | 'completed' | 'overdue' | 'noDate';

export interface TaskViewState {
  listId: string | null;
  tagId: string | null;
  window: TaskWindow;
  q: string;
  sort: TaskSort;
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
  priority: null,
};

const WINDOW_VALUES = TASK_WINDOWS.map((item) => item.value);
const SORT_VALUES = TASK_SORTS.map((item) => item.value);
const PRIORITY_VALUES: readonly Priority[] = ['none', 'low', 'medium', 'high'];

function isWindow(value: string | null): value is TaskWindow {
  return value !== null && (WINDOW_VALUES as readonly string[]).includes(value);
}

function isSort(value: string | null): value is TaskSort {
  return value !== null && (SORT_VALUES as readonly string[]).includes(value);
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

  return {
    listId: params.get('list') || null,
    tagId: params.get('tag') || null,
    window: isWindow(window) ? window : DEFAULT_TASK_VIEW.window,
    q: params.get('q') ?? '',
    sort: isSort(sort) ? sort : DEFAULT_TASK_VIEW.sort,
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

/**
 * A day grouping only makes sense while the order is chronological; sorting by
 * title or priority across days is something the user asked to see flat.
 */
export function shouldGroupByDay(sort: TaskSort): boolean {
  return sort === 'smart' || sort === 'due';
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

/** The chip row: only filters that are actually narrowing the list. */
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
