/**
 * GraphQL resolvers.
 *
 * Every resolver delegates to the same repository or service the REST route
 * uses, so the API and the UI cannot drift: a bug fixed in `updateTask` is fixed
 * for both callers, and there is exactly one implementation of the hard parts
 * (recurrence expansion, timezone resolution, sync dirtiness).
 *
 * ## Ownership
 *
 * No resolver ever reads an owner id from an argument. It always uses
 * `context.userId`, which came from the token. The one place that could go wrong
 * — triggering a CalDAV sync, which takes an account id and does not itself
 * scope by user — is guarded by an explicit `getAccount(context.userId, id)`
 * check first. That is what makes the two-user isolation guarantee hold.
 *
 * ## Input validation
 *
 * Inputs are described in the schema for discoverability, then validated with
 * the project's existing Zod schemas so a value the UI can send is a value the
 * API accepts, and an invalid one becomes a typed `BAD_USER_INPUT` rather than a
 * 500.
 */
import { z } from 'zod';
import {
  bulkActionSchema,
  checkInSchema,
  createAccountSchema,
  createCalendarSchema,
  createEventSchema,
  createHabitSchema,
  createIcalTokenSchema,
  createListSchema,
  createTagSchema,
  createTaskSchema,
  finishFocusSchema,
  icalSubscribeSchema,
  icalSubscriptionPatchSchema,
  pushSubscribeSchema,
  reorderSchema,
  startFocusSchema,
  updateAccountSchema,
  updateCalendarSchema,
  updateEventSchema,
  updateHabitSchema,
  updateListSchema,
  updateSettingsSchema,
  updateTagSchema,
  updateTaskSchema,
} from '@/lib/schemas';
import type { Attendee, TaskFilter } from '@/lib/types';
import { pushConfigured, oidcConfigured } from '@/lib/env';
import { badInput, conflict, forbidden, fromRepoError, notFound } from './errors';
import type { GraphQLContext } from './context';

/* -------------------------------------------------------------------------- */
/* repos + services                                                           */
/* -------------------------------------------------------------------------- */

import { getSettings, updateSettings, buildStats, recentFocusSessions, focusCountToday, startFocusSession, finishFocusSession, savePushSubscription, removePushSubscription, createIcalToken, listIcalTokens, revokeIcalToken, getAppriseConfig } from '../repos/settings';
import {
  bulkUpdate,
  buildAgenda,
  buildMatrix,
  completeTask,
  createTask,
  deleteTask,
  getTask,
  moveTaskBetween,
  queryTasks,
  reorderTasks,
  uncompleteTask,
  updateTask,
} from '../repos/tasks';
import {
  createList,
  createTag,
  deleteList,
  deleteTag,
  getList,
  listLists,
  listTags,
  mergeTags,
  reorderLists,
  updateList,
  updateTag,
} from '../repos/lists';
import { checkIn, createHabit, deleteHabit, getHabit, incrementHabit, listHabits, reorderHabits, updateHabit } from '../repos/habits';
import {
  createAccount,
  createCalendar,
  createEvent,
  deleteAccount,
  deleteCalendar,
  deleteEvent,
  eventsInRange,
  getAccount,
  getCalendar,
  getEvent,
  listAccounts,
  listCalendars,
  reorderCalendars,
  updateAccount,
  updateCalendar,
  updateEvent,
  type EventInput,
} from '../repos/calendars';
import { getCalendarItems, groupItemsByDay, layoutOverlaps } from '../services/calendar-items';
import { listIcalSubscriptions, subscribeToIcal, syncIcalCalendar, unsubscribeIcal, updateIcalSubscription } from '../services/ical-subscription';
import { FeedError } from '../services/ical-fetch';
import { APPRISE_TEST_PAYLOAD, sendApprise } from '../services/notifications';
import { discoverAccountCalendars, syncAccount } from '../sync';
import { ensureSyncScheduler } from '../services/scheduler';
import { createApiToken, getApiToken, issueApiToken, revokeApiToken } from '../repos/api-tokens';

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Validates an input with a Zod schema, turning a failure into BAD_USER_INPUT. */
function validate<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') ?? '';
    throw badInput(path ? `${path}: ${first.message}` : (first?.message ?? 'Invalid input.'), result.error.issues);
  }
  return result.data;
}

/** Runs `fn`, translating a feed error into a typed input error. */
async function withFeedErrors<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof FeedError) throw badInput(error.message);
    throw error;
  }
}

interface ListArgs {
  includeArchived?: boolean | null;
}

type Resolver<TParent = unknown, TArgs = Record<string, never>> = (
  parent: TParent,
  args: TArgs,
  context: GraphQLContext,
) => unknown;

/** Resolver table keyed by type then field, applied to the built schema. */
export const resolvers: Record<string, Record<string, Resolver<any, any>>> = {
  Query: {
    me: (_p, _a, ctx) => ctx.user,
    apiToken: (_p, _a, ctx) => getApiToken(ctx.userId),
    capabilities: () => ({
      push: pushConfigured(),
      oidc: oidcConfigured(),
      vapidPublicKey: process.env.VAPID_PUBLIC_KEY ?? null,
    }),

    tasks: (_p, args: { filter?: TaskFilter | null; sort?: string; includeSubtasks?: boolean; limit?: number; offset?: number }, ctx) =>
      queryTasks({
        userId: ctx.userId,
        zone: ctx.zone,
        filter: (args.filter ?? {}) as TaskFilter,
        sort: (args.sort as never) ?? 'smart',
        includeSubtasks: args.includeSubtasks ?? false,
        limit: args.limit ?? 500,
        offset: args.offset ?? 0,
      }),
    task: (_p, args: { id: string }, ctx) => getTask(ctx.userId, args.id),

    lists: (_p, args: ListArgs, ctx) => listLists(ctx.userId, { includeArchived: args.includeArchived ?? false }),
    list: (_p, args: { id: string }, ctx) => getList(ctx.userId, args.id),
    tags: (_p, _a, ctx) => listTags(ctx.userId),

    habits: (_p, args: { from?: string; to?: string; includeArchived?: boolean }, ctx) =>
      listHabits({
        userId: ctx.userId,
        zone: ctx.zone,
        weekStartsOn: ctx.weekStartsOn,
        from: args.from,
        to: args.to,
        includeArchived: args.includeArchived ?? false,
      }),
    habit: (_p, args: { id: string }, ctx) => getHabit(ctx.userId, args.id, ctx.zone, ctx.weekStartsOn),

    calendars: (_p, _a, ctx) => listCalendars(ctx.userId),
    calendar: (_p, args: { id: string }, ctx) => getCalendar(ctx.userId, args.id),
    event: (_p, args: { id: string }, ctx) => getEvent(ctx.userId, args.id),
    calendarItems: async (
      _p,
      args: { startMs: number; endMs: number; calendarIds?: string[]; kinds?: string[]; layout?: boolean },
      ctx,
    ) => {
      const { startMs, endMs } = args;
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        throw badInput('A valid startMs and endMs range is required.');
      }
      // Same cap as the REST endpoint: a decade of daily recurrence is a DoS vector.
      if (endMs - startMs > 1000 * 60 * 60 * 24 * 400) {
        throw badInput('The requested range is too large (maximum 400 days).');
      }
      const kinds = args.kinds ?? [];
      const includeEvents = kinds.length === 0 || kinds.includes('event');
      const includeTasks = kinds.length === 0 || kinds.includes('task');

      const [items, calendars] = await Promise.all([
        getCalendarItems({ userId: ctx.userId, zone: ctx.zone, startMs, endMs, calendarIds: args.calendarIds, includeEvents, includeTasks }),
        listCalendars(ctx.userId),
      ]);

      const dayMap = groupItemsByDay(items, ctx.zone);
      return {
        items,
        calendars,
        days: Object.entries(dayMap).map(([date, dayItems]) => ({ date, items: dayItems })),
        layout: args.layout ? layoutOverlaps(items) : null,
      };
    },

    caldavAccounts: (_p, _a, ctx) => listAccounts(ctx.userId),
    caldavAccount: (_p, args: { id: string }, ctx) => getAccount(ctx.userId, args.id),
    icalSubscriptions: (_p, _a, ctx) => listIcalSubscriptions(ctx.userId),
    icalFeedTokens: (_p, _a, ctx) => listIcalTokens(ctx.userId),

    settings: (_p, _a, ctx) => getSettings(ctx.userId),
    stats: (_p, args: { days?: number }, ctx) =>
      buildStats({ userId: ctx.userId, zone: ctx.zone, days: Math.min(365, Math.max(7, args.days ?? 30)) }),
    focusSessions: (_p, args: { limit?: number }, ctx) => recentFocusSessions(ctx.userId, args.limit ?? 20),
    focusCountToday: (_p, _a, ctx) => focusCountToday(ctx.userId, ctx.zone),
    search: async (_p, args: { query: string }, ctx) => {
      const query = args.query.trim();
      if (query.length < 2) return { tasks: [], events: [], habits: [] };
      const needle = query.toLowerCase();
      const [tasks, events, habits] = await Promise.all([
        queryTasks({ userId: ctx.userId, zone: ctx.zone, filter: { text: query, includeCompleted: true }, sort: 'updated', limit: 40 }),
        eventsInRange(ctx.userId, Date.now() - 1000 * 60 * 60 * 24 * 365 * 2, Date.now() + 1000 * 60 * 60 * 24 * 365 * 2, ctx.zone),
        listHabits({ userId: ctx.userId, zone: ctx.zone, weekStartsOn: ctx.weekStartsOn, includeArchived: true }),
      ]);
      return {
        tasks,
        events: events.filter((e) => e.summary.toLowerCase().includes(needle)).slice(0, 20),
        habits: habits.filter((h) => h.name.toLowerCase().includes(needle)).slice(0, 20),
      };
    },
    agenda: (_p, _a, ctx) => buildAgenda(ctx.userId, ctx.zone),
    matrix: (_p, _a, ctx) => buildMatrix(ctx.userId, ctx.zone),
  },

  Mutation: {
    /* ---- tasks ---- */
    createTask: async (_p, args: { input: Record<string, unknown> }, ctx) => {
      const body = validate(createTaskSchema, args.input);
      const listId = body.listId ?? ctx.settings.defaultListId ?? null;
      return createTask(ctx.userId, { ...body, listId }, ctx.zone);
    },
    updateTask: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const body = validate(updateTaskSchema, args.input);
      try {
        return await updateTask(ctx.userId, args.id, body, ctx.zone);
      } catch (error) {
        fromRepoError(error, { 'not-found': 'That task does not exist.' });
      }
    },
    deleteTask: async (_p, args: { id: string }, ctx) => {
      const existing = await getTask(ctx.userId, args.id);
      if (!existing) throw notFound('That task does not exist.');
      await deleteTask(ctx.userId, args.id);
      return { deleted: true };
    },
    completeTask: async (_p, args: { id: string }, ctx) => {
      const before = await getTask(ctx.userId, args.id);
      if (!before) throw notFound('That task does not exist.');
      const task = await completeTask(ctx.userId, args.id, ctx.zone);
      const recurred = Boolean(before.recurrenceRule) && task?.status === 'todo';
      return { task, recurred };
    },
    uncompleteTask: async (_p, args: { id: string }, ctx) => {
      const before = await getTask(ctx.userId, args.id);
      if (!before) throw notFound('That task does not exist.');
      const task = await uncompleteTask(ctx.userId, args.id);
      return { task, recurred: false };
    },
    moveTask: async (_p, args: { id: string; beforeSortOrder?: string | null; afterSortOrder?: string | null }, ctx) => {
      const task = await moveTaskBetween(ctx.userId, args.id, args.beforeSortOrder ?? null, args.afterSortOrder ?? null);
      if (!task) throw notFound('That task does not exist.');
      return task;
    },
    reorderTasks: async (_p, args: { orderedIds: string[] }, ctx) => {
      const { orderedIds } = validate(reorderSchema, { orderedIds: args.orderedIds });
      await reorderTasks(ctx.userId, orderedIds);
      return { reordered: orderedIds.length };
    },
    bulkUpdateTasks: async (_p, args: { input: { ids: string[]; action: string; listId?: string | null; priority?: string; tagId?: string } }, ctx) => {
      const body = validate(bulkActionSchema, args.input);
      const affected = await bulkUpdate(
        ctx.userId,
        body.ids,
        body.action,
        { listId: body.listId ?? null, priority: body.priority, tagId: body.tagId },
        ctx.zone,
      );
      return { affected };
    },

    /* ---- lists + tags ---- */
    createList: async (_p, args: { input: Record<string, unknown> }, ctx) => createList(ctx.userId, validate(createListSchema, args.input)),
    updateList: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const list = await updateList(ctx.userId, args.id, validate(updateListSchema, args.input));
      if (!list) throw notFound('That list does not exist.');
      return list;
    },
    deleteList: async (_p, args: { id: string }, ctx) => {
      try {
        const deleted = await deleteList(ctx.userId, args.id);
        if (!deleted) throw notFound('That list does not exist.');
        return { deleted: true };
      } catch (error) {
        if (error instanceof Error && error.message === 'inbox-undeletable') {
          throw conflict('The Inbox cannot be deleted. Tasks in a deleted list are moved here instead.');
        }
        throw error;
      }
    },
    reorderLists: async (_p, args: { orderedIds: string[] }, ctx) => {
      const { orderedIds } = validate(reorderSchema, { orderedIds: args.orderedIds });
      await reorderLists(ctx.userId, orderedIds);
      return { reordered: orderedIds.length };
    },
    createTag: async (_p, args: { input: { name: string; color?: string } }, ctx) => {
      const body = validate(createTagSchema, args.input);
      return createTag(ctx.userId, body.name, body.color as never);
    },
    updateTag: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const tag = await updateTag(ctx.userId, args.id, validate(updateTagSchema, args.input) as never);
      if (!tag) throw notFound('That tag does not exist.');
      return tag;
    },
    deleteTag: async (_p, args: { id: string }, ctx) => {
      const deleted = await deleteTag(ctx.userId, args.id);
      if (!deleted) throw notFound('That tag does not exist.');
      return { deleted: true };
    },
    mergeTags: async (_p, args: { sourceId: string; targetId: string }, ctx) => ({
      merged: await mergeTags(ctx.userId, args.sourceId, args.targetId),
    }),

    /* ---- habits ---- */
    createHabit: async (_p, args: { input: Record<string, unknown> }, ctx) =>
      createHabit(ctx.userId, validate(createHabitSchema, args.input) as never, ctx.zone),
    updateHabit: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const habit = await updateHabit(ctx.userId, args.id, validate(updateHabitSchema, args.input) as never);
      if (!habit) throw notFound('That habit does not exist.');
      return habit;
    },
    deleteHabit: async (_p, args: { id: string }, ctx) => {
      const deleted = await deleteHabit(ctx.userId, args.id);
      if (!deleted) throw notFound('That habit does not exist.');
      return { deleted: true };
    },
    reorderHabits: async (_p, args: { orderedIds: string[] }, ctx) => {
      const { orderedIds } = validate(reorderSchema, { orderedIds: args.orderedIds });
      await reorderHabits(ctx.userId, orderedIds);
      return { reordered: orderedIds.length };
    },
    checkInHabit: async (_p, args: { id: string; input?: Record<string, unknown> | null }, ctx) => {
      const body = validate(checkInSchema, args.input ?? {});
      const result =
        body.delta !== undefined
          ? await incrementHabit(ctx.userId, args.id, body.delta, body.date, ctx.zone)
          : await checkIn(ctx.userId, args.id, body, ctx.zone);
      if (!result) throw notFound('That habit does not exist.');
      const habit = await getHabit(ctx.userId, args.id, ctx.zone, ctx.weekStartsOn);
      return { habit, doneToday: result.doneToday };
    },

    /* ---- calendars + events ---- */
    createCalendar: async (_p, args: { input: Record<string, unknown> }, ctx) =>
      createCalendar(ctx.userId, validate(createCalendarSchema, args.input) as never, ctx.zone),
    updateCalendar: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const calendar = await updateCalendar(ctx.userId, args.id, validate(updateCalendarSchema, args.input) as never);
      if (!calendar) throw notFound('That calendar does not exist.');
      return calendar;
    },
    deleteCalendar: async (_p, args: { id: string }, ctx) => {
      const deleted = await deleteCalendar(ctx.userId, args.id);
      if (!deleted) throw notFound('That calendar does not exist.');
      return { deleted: true };
    },
    reorderCalendars: async (_p, args: { orderedIds: string[] }, ctx) => {
      const { orderedIds } = validate(reorderSchema, { orderedIds: args.orderedIds });
      await reorderCalendars(ctx.userId, orderedIds);
      return { reordered: orderedIds.length };
    },
    createEvent: async (_p, args: { input: Record<string, unknown> }, ctx) => {
      const body = validate(createEventSchema, args.input);
      try {
        return await createEvent(ctx.userId, body as unknown as EventInput, ctx.zone);
      } catch (error) {
        fromRepoError(error, {
          'not-found': 'That calendar does not exist.',
          'invalid-span': 'An event needs a start date or start time.',
          'read-only': 'That calendar is read-only, so nothing is written back.',
        });
      }
    },
    updateEvent: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const body = validate(updateEventSchema, args.input);
      try {
        const event = await updateEvent(ctx.userId, args.id, body as never, ctx.zone);
        if (!event) throw notFound('That event does not exist.');
        return event;
      } catch (error) {
        fromRepoError(error, {
          'not-found': 'That event or calendar does not exist.',
          'read-only': 'That calendar is read-only, so nothing is written back.',
        });
      }
    },
    deleteEvent: async (_p, args: { id: string }, ctx) => {
      const deleted = await deleteEvent(ctx.userId, args.id);
      if (!deleted) throw notFound('That event does not exist.');
      return { deleted: true };
    },

    /* ---- CalDAV accounts ---- */
    createCaldavAccount: async (_p, args: { input: Record<string, unknown> }, ctx) => {
      const account = await createAccount(ctx.userId, validate(createAccountSchema, args.input) as never);
      try {
        await ensureSyncScheduler();
      } catch {
        /* scheduler startup is best-effort */
      }
      return account;
    },
    updateCaldavAccount: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const account = await updateAccount(ctx.userId, args.id, validate(updateAccountSchema, args.input) as never);
      if (!account) throw notFound('That calendar account does not exist.');
      return account;
    },
    deleteCaldavAccount: async (_p, args: { id: string; purge?: boolean }, ctx) => {
      const deleted = await deleteAccount(ctx.userId, args.id, !(args.purge ?? false));
      if (!deleted) throw notFound('That calendar account does not exist.');
      return { deleted: true };
    },
    syncCaldavAccount: async (_p, args: { id: string; kind?: string; calendarId?: string }, ctx) => {
      // Ownership check before the account-id-only sync entrypoint.
      const account = await getAccount(ctx.userId, args.id);
      if (!account) throw notFound('That calendar account does not exist.');
      if (args.kind === 'discover') return discoverAccountCalendars(args.id);
      return syncAccount(args.id, {
        kind: (args.kind as 'full' | 'incremental' | 'push' | undefined) ?? 'incremental',
        calendarId: args.calendarId,
        trigger: 'manual',
      });
    },
    discoverCaldavAccount: async (_p, args: { id: string }, ctx) => {
      const account = await getAccount(ctx.userId, args.id);
      if (!account) throw notFound('That calendar account does not exist.');
      return discoverAccountCalendars(args.id);
    },

    /* ---- iCal subscriptions ---- */
    subscribeIcal: async (_p, args: { input: Record<string, unknown> }, ctx) => {
      const body = validate(icalSubscribeSchema, args.input);
      const result = await withFeedErrors(() => subscribeToIcal(ctx.userId, body));
      try {
        await ensureSyncScheduler();
      } catch {
        /* best-effort */
      }
      return { calendar: result.calendar, sync: result.sync };
    },
    updateIcalSubscription: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const body = validate(icalSubscriptionPatchSchema, args.input);
      const result = await withFeedErrors(() => updateIcalSubscription(ctx.userId, args.id, body));
      if (!result) throw notFound('That subscription does not exist.');
      return { calendar: result.calendar, sync: result.sync };
    },
    unsubscribeIcal: async (_p, args: { id: string }, ctx) => {
      const removed = await unsubscribeIcal(ctx.userId, args.id);
      if (!removed) throw notFound('That subscription does not exist.');
      return { deleted: true };
    },
    syncIcalSubscription: async (_p, args: { id: string }, ctx) => {
      const result = await syncIcalCalendar(ctx.userId, args.id);
      if (result.error === 'not-found') throw notFound('That subscription does not exist.');
      return result;
    },

    /* ---- ICS feed tokens ---- */
    createIcalFeedToken: async (_p, args: { input?: Record<string, unknown> | null }, ctx) => {
      const body = validate(createIcalTokenSchema, args.input ?? {});
      return createIcalToken(ctx.userId, body);
    },
    revokeIcalFeedToken: async (_p, args: { id: string }, ctx) => {
      await revokeIcalToken(ctx.userId, args.id);
      return { deleted: true };
    },

    /* ---- settings ---- */
    updateSettings: async (_p, args: { input: Record<string, unknown> }, ctx) =>
      updateSettings(ctx.userId, validate(updateSettingsSchema, args.input)),

    /* ---- focus ---- */
    startFocusSession: async (_p, args: { input: Record<string, unknown> }, ctx) =>
      startFocusSession(ctx.userId, validate(startFocusSchema, args.input)),
    finishFocusSession: async (_p, args: { id: string; input: Record<string, unknown> }, ctx) => {
      const session = await finishFocusSession(ctx.userId, args.id, validate(finishFocusSchema, args.input));
      if (!session) throw notFound('That focus session does not exist.');
      return session;
    },

    /* ---- push ---- */
    subscribePush: async (_p, args: { input: Record<string, unknown> }, ctx) => {
      await savePushSubscription(ctx.userId, validate(pushSubscribeSchema, args.input) as never);
      return { saved: true };
    },
    unsubscribePush: async (_p, args: { endpoint: string }, ctx) => {
      await removePushSubscription(ctx.userId, args.endpoint);
      return { deleted: true };
    },
    testApprise: async (_p, _a, ctx) => {
      const config = await getAppriseConfig(ctx.userId);
      if (!config) return { configured: false, delivered: false, error: 'not-configured' };
      const result = await sendApprise(config, APPRISE_TEST_PAYLOAD);
      return { configured: true, ...result };
    },

    /* ---- API tokens ---- */
    createApiToken: async (_p, _a, ctx) => {
      try {
        return await createApiToken(ctx.userId);
      } catch (error) {
        fromRepoError(error, { exists: 'A token already exists. Cycle it instead.' });
      }
    },
    cycleApiToken: (_p, _a, ctx) => issueApiToken(ctx.userId),
    revokeApiToken: async (_p, _a, ctx) => {
      await revokeApiToken(ctx.userId);
      return { deleted: true };
    },
  },

  /* ---- field resolvers that need shaping ---- */
  Task: {
    tagIds: (task: { tagIds?: string[] }) => task.tagIds ?? [],
    tags: (task: { tags?: unknown[] }) => task.tags ?? [],
    subtasks: (task: { subtasks?: unknown[] }) => task.subtasks ?? [],
    reminders: (task: { reminders?: unknown[] }) => task.reminders ?? [],
  },
  Habit: {
    entries: (habit: { entries?: Record<string, number> }) =>
      Object.entries(habit.entries ?? {}).map(([date, count]) => ({ date, count })),
  },
  CalendarItemsPayload: {
    layout: (payload: { layout?: unknown[] | null }) => payload.layout ?? null,
  },
  CalendarEvent: {
    exdates: (event: { exdates?: string[] | null }) => event.exdates ?? null,
    rdates: (event: { rdates?: string[] | null }) => event.rdates ?? null,
    categories: (event: { categories?: string[] | null }) => event.categories ?? null,
    reminders: (event: { reminders?: number[] | null }) => event.reminders ?? null,
    attendees: (event: { attendees?: Attendee[] | null }) => event.attendees ?? null,
  },
};
