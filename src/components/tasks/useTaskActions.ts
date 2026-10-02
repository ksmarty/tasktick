'use client';

/**
 * Every task write the views perform, in one hook.
 *
 * Three rules are enforced here rather than in each component:
 *   - a failed write always surfaces a toast and never fails silently;
 *   - an expired session says so instead of showing a bare 401;
 *   - when the browser is offline the write is refused up front with the reason,
 *     because the app has no queue to put it in.
 *
 * Successful writes drop what they changed and wake the views showing it, from
 * `AFFECTS` in `offline-rules.ts` — so the list, the sidebar counts and the Today
 * agenda all refresh from the one table, and no writer here can forget a key.
 */
import { useCallback } from 'react';
import { ApiClientError, api, errorMessage } from '@/lib/api-client';
import { relativeDayLabel } from '@/lib/dates';
import { affectsFor } from '@/lib/offline-rules';
import { useMutation, useOnline } from '@/lib/store';
import type { AccentColor, List, Tag, Task } from '@/lib/types';
import type { CompleteTaskPayload } from '@/lib/view-types';
import { useToast } from '@/components/app/Toast';
import { fireConfetti } from '@/components/godui/confetti';
import type { BulkAction, BulkPayload, CreateTaskPayload, ListPatch, TaskPatch } from './payloads';

export const OFFLINE_NOTICE = 'You are offline, so changes cannot be saved yet. They will work again once you reconnect.';

/**
 * What a task write reaches.
 *
 * Derived from `affectsFor`, never hand-written. It used to be a literal array
 * duplicated at each writer, and the matrix and the pomodoro screen each kept a
 * shorter version that omitted `/api/bootstrap` and `/api/calendar/items` — so a
 * task moved on the matrix left the sidebar count, the Today agenda and the
 * calendar's dot showing the old answer.
 *
 * Exported because those two screens write tasks through their own hooks and
 * need the same answer; deriving it means they cannot get a different one.
 */
export const TASK_WRITE_PREFIXES: string[] = affectsFor('POST', '/api/tasks');

/** What a list write reaches: bootstrap for the sidebar, tasks for their list ids. */
const LIST_WRITE_PREFIXES: string[] = affectsFor('POST', '/api/lists');

/** What a tag write reaches: the tag picker itself, plus the tasks carrying it. */
const TAG_WRITE_PREFIXES: string[] = affectsFor('POST', '/api/tags');

/** Maps a thrown value onto something worth showing a human. */
function writeFailure(error: unknown, what: string): Error {
  if (error instanceof ApiClientError && error.isAuthError) {
    return new Error('Your session expired. Sign in again to save your changes.');
  }
  return new Error(`${what}: ${errorMessage(error)}`);
}

export interface TaskActions {
  online: boolean;
  /** Caption to render next to a disabled control while offline. */
  offlineNotice: string;
  isSaving: boolean;
  /** Ticks a task off; `undo` un-ticks it. Subtasks are tasks too. */
  complete(task: TaskRef, undo?: boolean): Promise<CompleteTaskPayload | undefined>;
  create(input: CreateTaskPayload): Promise<Task | undefined>;
  /** Creates a list from a quick-add `@Name`, then the caller retries. */
  createList(name: string, color?: AccentColor): Promise<List | undefined>;
  /** Renames, recolours or describes a list. */
  updateList(id: string, input: ListPatch): Promise<List | undefined>;
  /** Deletes a list; its tasks move to the Inbox on the server. */
  removeList(id: string): Promise<boolean>;
  /** Creates a tag from the tag picker's inline field. */
  createTag(name: string): Promise<Tag | undefined>;
  patch(id: string, input: TaskPatch): Promise<Task | undefined>;
  remove(id: string): Promise<boolean>;
  bulk(ids: readonly string[], action: BulkAction, payload?: BulkPayload): Promise<boolean>;
  reorder(orderedIds: readonly string[]): Promise<boolean>;
}

/** The only fields a write needs from a row, so subtasks can reuse the actions. */
export interface TaskRef {
  id: string;
  title: string;
}

export function useTaskActions(zone: string): TaskActions {
  const online = useOnline();
  const { toast } = useToast();

  const fail = useCallback(
    (message: string) => {
      toast({ title: "Couldn't save", description: message, variant: 'error' });
    },
    [toast],
  );

  const refuseWhenOffline = useCallback(() => {
    if (online) return false;
    toast({ title: 'You are offline', description: OFFLINE_NOTICE, variant: 'info' });
    return true;
  }, [online, toast]);

  const completeMutation = useMutation(
    async (task: TaskRef, undo: boolean) => {
      try {
        return await api.post<CompleteTaskPayload>(
          `/api/tasks/${task.id}/complete`,
          undefined,
          undo ? { undo: 1 } : undefined,
        );
      } catch (error) {
        throw writeFailure(error, 'Could not update the task');
      }
    },
    {
      invalidates: TASK_WRITE_PREFIXES,
      onSuccess: (result, [task, undo]) => {
        if (!result) return;
        if (result.recurred && result.task?.dueDate) {
          toast({
            title: `Moved to ${relativeDayLabel(result.task.dueDate, zone)}`,
            description: `“${task.title}” repeats, so it rolled forward.`,
            variant: 'success',
          });
        } else if (!undo) {
          /*
           * A real completion gets the burst — GodUI's confetti, at the canvas's own
           * default origin.
           *
           * Two cases deliberately get nothing: an **un-completion**, which is the reverse
           * of a celebration, and a **recurring** task that rolled forward, which was
           * never finished. Both are handled by the branches above.
           *
           * `disableForReducedMotion` is on by default and reads the app's own motion
           * store rather than the media query, so the user's preference and Low Power
           * Mode both turn it off.
           */
          /*
           * Wrapped because this runs inside a mutation handler: a canvas that cannot
           * be created must cost the user a burst, not the rest of the success path.
           */
          try {
            fireConfetti();
          } catch {
            // A missing 2d context is not worth surfacing.
          }
        }
        // Un-completing is deliberately silent: the row reappearing (and, on the
        // lists, the left-edge Undo going away) is the feedback. A "Marked as
        // not done" banner was the success chatter the user asked to remove.
      },
      onError: fail,
    },
  );

  const createMutation = useMutation(
    async (input: CreateTaskPayload) => {
      try {
        return await api.post<Task>('/api/tasks', input);
      } catch (error) {
        throw writeFailure(error, 'Could not save the task');
      }
    },
    { invalidates: TASK_WRITE_PREFIXES, onError: fail },
  );

  const listMutation = useMutation(
    async (name: string, color?: AccentColor) => {
      try {
        return await api.post<List>('/api/lists', color ? { name, color } : { name });
      } catch (error) {
        throw writeFailure(error, 'Could not create the list');
      }
    },
    { invalidates: LIST_WRITE_PREFIXES, onError: fail },
  );

  const listPatchMutation = useMutation(
    async (id: string, input: ListPatch) => {
      try {
        return await api.patch<List>(`/api/lists/${id}`, input);
      } catch (error) {
        throw writeFailure(error, 'Could not save the list');
      }
    },
    { invalidates: LIST_WRITE_PREFIXES, onError: fail },
  );

  const listRemoveMutation = useMutation(
    async (id: string) => {
      try {
        return await api.delete<{ deleted: boolean }>(`/api/lists/${id}`);
      } catch (error) {
        throw writeFailure(error, 'Could not delete the list');
      }
    },
    {
      invalidates: LIST_WRITE_PREFIXES,
      onSuccess: () =>
        toast({ title: 'List deleted', description: 'Its tasks moved to the Inbox.', variant: 'info' }),
      onError: fail,
    },
  );

  const tagMutation = useMutation(
    async (name: string) => {
      try {
        return await api.post<Tag>('/api/tags', { name });
      } catch (error) {
        throw writeFailure(error, 'Could not create the tag');
      }
    },
    { invalidates: TAG_WRITE_PREFIXES, onError: fail },
  );

  const patchMutation = useMutation(
    async (id: string, input: TaskPatch) => {
      try {
        return await api.patch<Task>(`/api/tasks/${id}`, input);
      } catch (error) {
        throw writeFailure(error, 'Could not save your changes');
      }
    },
    { invalidates: TASK_WRITE_PREFIXES, onError: fail },
  );

  const removeMutation = useMutation(
    async (id: string) => {
      try {
        return await api.delete<{ deleted: boolean }>(`/api/tasks/${id}`);
      } catch (error) {
        throw writeFailure(error, 'Could not delete the task');
      }
    },
    {
      invalidates: TASK_WRITE_PREFIXES,
      onSuccess: () => toast({ title: 'Task deleted', variant: 'info' }),
      onError: fail,
    },
  );

  const bulkMutation = useMutation(
    async (ids: readonly string[], action: BulkAction, payload: BulkPayload) => {
      try {
        return await api.post<{ affected: number }>('/api/tasks/bulk', { ids: [...ids], action, ...payload });
      } catch (error) {
        throw writeFailure(error, 'Could not update the selected tasks');
      }
    },
    {
      invalidates: TASK_WRITE_PREFIXES,
      onSuccess: (result) => {
        if (result) toast({ title: `${result.affected} task${result.affected === 1 ? '' : 's'} updated`, variant: 'success' });
      },
      onError: fail,
    },
  );

  const reorderMutation = useMutation(
    async (orderedIds: readonly string[]) => {
      try {
        return await api.post<{ reordered: number }>('/api/tasks/reorder', { orderedIds: [...orderedIds] });
      } catch (error) {
        throw writeFailure(error, 'Could not save the new order');
      }
    },
    { invalidates: TASK_WRITE_PREFIXES, onError: fail },
  );

  const complete = useCallback(
    async (task: TaskRef, undo = false) => {
      if (refuseWhenOffline()) return undefined;
      return completeMutation.run(task, undo);
    },
    [completeMutation, refuseWhenOffline],
  );

  const create = useCallback(
    async (input: CreateTaskPayload) => {
      if (refuseWhenOffline()) return undefined;
      return createMutation.run(input);
    },
    [createMutation, refuseWhenOffline],
  );

  const createList = useCallback(
    async (name: string, color?: AccentColor) => {
      if (refuseWhenOffline()) return undefined;
      return listMutation.run(name, color);
    },
    [listMutation, refuseWhenOffline],
  );

  const updateList = useCallback(
    async (id: string, input: ListPatch) => {
      if (refuseWhenOffline()) return undefined;
      return listPatchMutation.run(id, input);
    },
    [listPatchMutation, refuseWhenOffline],
  );

  const removeList = useCallback(
    async (id: string) => {
      if (refuseWhenOffline()) return false;
      const result = await listRemoveMutation.run(id);
      return result !== undefined;
    },
    [listRemoveMutation, refuseWhenOffline],
  );

  const createTag = useCallback(
    async (name: string) => {
      if (refuseWhenOffline()) return undefined;
      return tagMutation.run(name);
    },
    [refuseWhenOffline, tagMutation],
  );

  const patch = useCallback(
    async (id: string, input: TaskPatch) => {
      if (refuseWhenOffline()) return undefined;
      return patchMutation.run(id, input);
    },
    [patchMutation, refuseWhenOffline],
  );

  const remove = useCallback(
    async (id: string) => {
      if (refuseWhenOffline()) return false;
      const result = await removeMutation.run(id);
      return result !== undefined;
    },
    [refuseWhenOffline, removeMutation],
  );

  const bulk = useCallback(
    async (ids: readonly string[], action: BulkAction, payload: BulkPayload = {}) => {
      if (ids.length === 0) return false;
      if (refuseWhenOffline()) return false;
      const result = await bulkMutation.run(ids, action, payload);
      return result !== undefined;
    },
    [bulkMutation, refuseWhenOffline],
  );

  const reorder = useCallback(
    async (orderedIds: readonly string[]) => {
      if (orderedIds.length === 0) return false;
      if (refuseWhenOffline()) return false;
      const result = await reorderMutation.run(orderedIds);
      return result !== undefined;
    },
    [reorderMutation, refuseWhenOffline],
  );

  return {
    online,
    offlineNotice: OFFLINE_NOTICE,
    isSaving:
      completeMutation.isPending ||
      createMutation.isPending ||
      listMutation.isPending ||
      listPatchMutation.isPending ||
      listRemoveMutation.isPending ||
      tagMutation.isPending ||
      patchMutation.isPending ||
      removeMutation.isPending ||
      bulkMutation.isPending ||
      reorderMutation.isPending,
    complete,
    create,
    createList,
    updateList,
    removeList,
    createTag,
    patch,
    remove,
    bulk,
    reorder,
  };
}
