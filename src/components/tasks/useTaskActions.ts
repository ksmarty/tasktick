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
 * Successful writes invalidate `/api/tasks` and `/api/bootstrap`, so the list,
 * the sidebar counts and the Today agenda all refresh from one response.
 */
import { useCallback } from 'react';
import { ApiClientError, api, errorMessage } from '@/lib/api-client';
import { relativeDayLabel } from '@/lib/dates';
import { useMutation, useOnline } from '@/lib/store';
import type { AccentColor, List, Tag, Task } from '@/lib/types';
import type { CompleteTaskPayload } from '@/lib/view-types';
import { useToast } from '@/components/app/Toast';
import type { BulkAction, BulkPayload, CreateTaskPayload, ListPatch, TaskPatch } from './payloads';

export const OFFLINE_NOTICE = 'You are offline, so changes cannot be saved yet. They will work again once you reconnect.';

/**
 * Cache keys a task write can affect.
 *
 * `/api/calendar/items` belongs here because a task with a due date IS a
 * calendar item — it renders in the day agenda and contributes a dot to the
 * month grid. Leaving it out meant a task created or completed on the tasks
 * screen did not appear on the calendar until a full reload, which reads as
 * "the calendar does not include tasks" rather than as a stale cache.
 *
 * `/api/bootstrap` carries the sidebar counts and the Today agenda, so it goes
 * with every write for the same reason.
 */
const INVALIDATES = ['/api/tasks', '/api/bootstrap', '/api/calendar/items', '/api/lists'];

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
      invalidates: INVALIDATES,
      onSuccess: (result, [task, undo]) => {
        if (!result) return;
        if (result.recurred && result.task?.dueDate) {
          toast({
            title: `Moved to ${relativeDayLabel(result.task.dueDate, zone)}`,
            description: `“${task.title}” repeats, so it rolled forward.`,
            variant: 'success',
          });
          return;
        }
        if (undo) {
          toast({ title: 'Marked as not done', description: task.title, variant: 'info' });
        }
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
    { invalidates: INVALIDATES, onError: fail },
  );

  const listMutation = useMutation(
    async (name: string, color?: AccentColor) => {
      try {
        return await api.post<List>('/api/lists', color ? { name, color } : { name });
      } catch (error) {
        throw writeFailure(error, 'Could not create the list');
      }
    },
    { invalidates: INVALIDATES, onError: fail },
  );

  const listPatchMutation = useMutation(
    async (id: string, input: ListPatch) => {
      try {
        return await api.patch<List>(`/api/lists/${id}`, input);
      } catch (error) {
        throw writeFailure(error, 'Could not save the list');
      }
    },
    { invalidates: INVALIDATES, onError: fail },
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
      invalidates: INVALIDATES,
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
    { invalidates: INVALIDATES, onError: fail },
  );

  const patchMutation = useMutation(
    async (id: string, input: TaskPatch) => {
      try {
        return await api.patch<Task>(`/api/tasks/${id}`, input);
      } catch (error) {
        throw writeFailure(error, 'Could not save your changes');
      }
    },
    { invalidates: INVALIDATES, onError: fail },
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
      invalidates: INVALIDATES,
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
      invalidates: INVALIDATES,
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
    { invalidates: INVALIDATES, onError: fail },
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
