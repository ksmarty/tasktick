/**
 * Turning a search payload into one flat, ordered result list.
 *
 * Search results come back as three arrays but are traversed as a single list:
 * arrow keys have to walk from the last habit up into the tasks without the user
 * knowing where a section ended. Flattening here — and keeping the selection
 * maths pure — is what makes that behaviour testable.
 */
import { formatDateTime, relativeDayLabel, taskDay, type FormatPrefs } from '@/lib/dates';
import { frequencySummary } from '@/components/habits/period';
import type { SearchPayload } from '@/lib/view-types';
import type { DateOnly } from '@/lib/types';

export type SearchResultKind = 'task' | 'event' | 'habit';

export interface SearchResult {
  /** Stable key across sections, used for the active-descendant id. */
  key: string;
  kind: SearchResultKind;
  id: string;
  title: string;
  subtitle: string | null;
  /** Where Enter goes. */
  href: string;
}

export interface SearchGroups {
  tasks: SearchResult[];
  events: SearchResult[];
  habits: SearchResult[];
}

/**
 * Milliseconds of quiet after the last keystroke before a request goes out.
 * Long enough to swallow a burst of typing, short enough to feel immediate.
 */
export const SEARCH_DEBOUNCE_MS = 250;

/** Section headings, in the order they are rendered. */
export const SEARCH_SECTIONS: readonly { kind: SearchResultKind; label: string }[] = [
  { kind: 'task', label: 'Tasks' },
  { kind: 'event', label: 'Events' },
  { kind: 'habit', label: 'Habits' },
];

export function buildSearchResults(
  payload: SearchPayload | undefined,
  prefs: FormatPrefs,
  today: DateOnly,
): SearchGroups {
  if (!payload) return { tasks: [], events: [], habits: [] };

  const tasks: SearchResult[] = payload.tasks.map((task) => {
    const day = taskDay(task, prefs.zone);
    const overdue =
      task.status !== 'completed' && task.status !== 'wont_do' && Boolean(day && day < today);
    return {
      key: `task:${task.id}`,
      kind: 'task',
      id: task.id,
      title: task.title,
      subtitle: day ? `${relativeDayLabel(day, prefs.zone)}${overdue ? ' · overdue' : ''}` : 'No date',
      href: `/tasks?task=${task.id}`,
    };
  });

  const events: SearchResult[] = payload.events.map((event) => ({
    key: `event:${event.id}`,
    kind: 'event',
    id: event.id,
    title: event.summary,
    subtitle: eventSubtitle(event, prefs),
    href: `/calendar?event=${event.id}`,
  }));

  const habits: SearchResult[] = payload.habits.map((habit) => ({
    key: `habit:${habit.id}`,
    kind: 'habit',
    id: habit.id,
    title: habit.name,
    subtitle: frequencySummary(habit),
    href: `/habits?habit=${habit.id}`,
  }));

  return { tasks, events, habits };
}

/** `Tomorrow 09:00` for a timed event, `Tomorrow` for an all-day one. */
function eventSubtitle(
  event: SearchPayload['events'][number],
  prefs: FormatPrefs,
): string | null {
  if (event.startMs) return formatDateTime(event.startMs, prefs);
  if (event.startDate) return relativeDayLabel(event.startDate, prefs.zone);
  return null;
}

/** The rendered order of every result, section by section. */
export function flattenResults(groups: SearchGroups): SearchResult[] {
  return [...groups.tasks, ...groups.events, ...groups.habits];
}

export function totalResults(groups: SearchGroups): number {
  return groups.tasks.length + groups.events.length + groups.habits.length;
}

export function resultsFor(groups: SearchGroups, kind: SearchResultKind): SearchResult[] {
  return kind === 'task' ? groups.tasks : kind === 'event' ? groups.events : groups.habits;
}

/** Clamped position of a selected index after a key press. */
export function moveSelection(current: number, count: number, key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End'): number {
  if (count <= 0) return -1;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    case 'ArrowUp':
      return current <= 0 ? count - 1 : current - 1;
    case 'ArrowDown':
    default:
      return current < 0 || current >= count - 1 ? 0 : current + 1;
  }
}
