/**
 * Task collection: list and create.
 */
import { ok, parseJson, route, searchParam, searchParamBool, searchParamInt, searchParamList } from '@/server/http';
import { createTask, queryTasks, type TaskSort } from '@/server/repos/tasks';
import { getSettings } from '@/server/repos/settings';
import { createTaskSchema } from '@/lib/schemas';
import type { Priority, TaskFilter, TaskStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  const filter: TaskFilter = {
    text: searchParam(req, 'text'),
    listIds: searchParamList(req, 'listIds'),
    tagIds: searchParamList(req, 'tagIds'),
    priorities: searchParamList(req, 'priorities') as Priority[] | undefined,
    statuses: searchParamList(req, 'statuses') as TaskStatus[] | undefined,
    dueWindow: searchParam(req, 'dueWindow') as TaskFilter['dueWindow'],
    dueFrom: searchParam(req, 'dueFrom'),
    dueTo: searchParam(req, 'dueTo'),
    includeCompleted: searchParamBool(req, 'includeCompleted', false),
  };

  const hasRecurrence = searchParam(req, 'hasRecurrence');
  if (hasRecurrence !== undefined) filter.hasRecurrence = searchParamBool(req, 'hasRecurrence');
  const isPinned = searchParam(req, 'isPinned');
  if (isPinned !== undefined) filter.isPinned = searchParamBool(req, 'isPinned');

  const tasks = await queryTasks({
    userId: user.id,
    zone,
    filter,
    sort: (searchParam(req, 'sort') as TaskSort | undefined) ?? 'smart',
    includeSubtasks: searchParamBool(req, 'includeSubtasks', false),
    limit: searchParamInt(req, 'limit', 500),
    offset: searchParamInt(req, 'offset', 0),
  });

  return ok(tasks);
});

export const POST = route(async ({ user, req }) => {
  const body = await parseJson(req, createTaskSchema);
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  // Fall back to the user's default list so quick-added tasks are never orphaned.
  const listId = body.listId ?? settings.defaultListId ?? null;

  const task = await createTask(user.id, { ...body, listId }, zone);
  return ok(task, 201);
});
