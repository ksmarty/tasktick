/**
 * The accent a task row's colour strip uses.
 *
 * A task's colour is its list's colour, resolved once into a lookup rather than
 * searched per row: a long list is the one place an O(rows × lists) scan would
 * show. A task with no list of its own falls back to the Inbox — the list the
 * server files it in — and a task whose list has vanished still gets a strip,
 * because "no colour" would read as a rendering bug rather than as missing data.
 */
import type { AccentColor, List, Task } from '@/lib/types';

/** Builds the per-row resolver from the hydrated lists. */
export function taskAccentLookup(lists: readonly List[]): (task: Task) => AccentColor | null {
  const byId = new Map(lists.map((list) => [list.id, list.color]));
  const fallback = lists.find((list) => list.isInbox)?.color ?? null;

  return (task) => (task.listId ? byId.get(task.listId) ?? fallback : fallback);
}
