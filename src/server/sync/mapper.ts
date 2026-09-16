/**
 * Conversion between the CalDAV wire format and our Drizzle rows.
 *
 * Two rules shape this file:
 *
 *  1. **The transport codec owns iCalendar.** We never parse (or hand-write) the
 *     syntax: `parseIcsObject` turns a payload into `ParsedObject`s and
 *     `serializeEvent` / `serializeTodo` turn a row back into a payload. This
 *     module only maps fields onto columns.
 *  2. **Absent means "no opinion".** A remote object that omits `DESCRIPTION`
 *     says nothing about our `description` column, so every mapper keeps
 *     `undefined` for absent properties and lets {@link pickDefined} drop them.
 *     That is what stops a sparse remote payload from clearing local data.
 */
import { parseIcsObject, serializeEvent, serializeTodo } from '@/server/caldav';
import type { ParsedEvent, ParsedObject, ParsedTodo, RemoteObject } from '@/server/caldav';
import type { CalendarEventRow, TaskRow } from '@/server/db/schema';
import { pickDefined } from './merge';

export const PRODID = '-//TaskTick//tasktick 0.1//EN';

/** Columns the conflict policy is allowed to arbitrate for an event. */
export const EVENT_MERGE_FIELDS: readonly string[] = [
  'summary',
  'description',
  'location',
  'url',
  'startMs',
  'endMs',
  'startDate',
  'endDate',
  'isAllDay',
  'timezone',
  'rrule',
  'exdates',
  'rdates',
  'status',
  'transparency',
  'organizer',
  'attendees',
  'categories',
  'reminders',
  'color',
] as const;

/** Columns the conflict policy is allowed to arbitrate for a task. */
export const TASK_MERGE_FIELDS: readonly string[] = [
  'title',
  'notes',
  'url',
  'status',
  'priority',
  'dueAtMs',
  'dueDate',
  'startAtMs',
  'startDate',
  'isAllDay',
  'timezone',
  'completedAtMs',
  'recurrenceRule',
  'estimateMinutes',
  'isPinned',
] as const;

/** "Title, notes, dates and completion state" — the event spelling. */
export const EVENT_LOCALLY_PREFERRED_FIELDS: readonly string[] = [
  'summary',
  'description',
  'location',
  'startMs',
  'endMs',
  'startDate',
  'endDate',
  'rrule',
  'exdates',
  'rdates',
  'status',
] as const;

/** "Title, notes, priority, due dates, completion state" — the task spelling. */
export const TASK_LOCALLY_PREFERRED_FIELDS: readonly string[] = [
  'title',
  'notes',
  'priority',
  'dueAtMs',
  'dueDate',
  'startAtMs',
  'startDate',
  'completedAtMs',
  'status',
  'recurrenceRule',
] as const;

export interface EventContext {
  userId: string;
  /** Local calendar the collection is mirrored into. */
  calendarId: string;
  /** Collection timezone, used when the payload carries none. */
  timezone: string;
  /** Raw payload, retained on the row so unknown properties survive round-trips. */
  rawIcs?: string | null;
}

export interface TaskContext {
  userId: string;
  /** Set when the VTODO lives in a collection; null keeps the task in Inbox. */
  calendarId: string | null;
  /** Collection timezone, used when the payload carries none. */
  timezone: string;
  rawIcs?: string | null;
}

/* -------------------------------------------------------------------------- */
/* wire -> row                                                                */
/* -------------------------------------------------------------------------- */

/** Wraps the transport codec so the engine never handles iCalendar text itself. */
export function parseRemoteObject(object: RemoteObject): ParsedObject[] {
  return parseIcsObject(object.data).objects;
}

/** `LAST-MODIFIED` column value: an ISO-8601 string, or null when unknown. */
export function formatRemoteLastModified(ms: number | null | undefined): string | null {
  return typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** The `<collection>/<uid>.ics` resource name for an object we create. */
export function deriveObjectHref(collectionHref: string, uid: string, recurrenceId?: string | null): string {
  const base = collectionHref.endsWith('/') ? collectionHref : `${collectionHref}/`;
  const safeUid = uid.replace(/[^A-Za-z0-9._-]/g, '_');
  const suffix = recurrenceId ? `--${recurrenceId.replace(/[^A-Za-z0-9._-]/g, '_')}` : '';
  return `${base}${safeUid}${suffix}.ics`;
}

/**
 * Event fields asserted by the remote payload. Keys are row property names;
 * `undefined` values are "the remote said nothing" and must be dropped before
 * they reach the database.
 */
export function eventValuesFromParsed(parsed: ParsedEvent, ctx: EventContext): Record<string, unknown> {
  const event = parsed.event;
  return {
    summary: event.summary,
    description: event.description,
    location: event.location,
    url: event.url,
    startMs: event.startMs,
    endMs: event.endMs,
    startDate: event.startDate,
    endDate: event.endDate,
    isAllDay: event.isAllDay,
    timezone: event.timezone,
    rrule: event.rrule,
    exdates: event.exdates,
    rdates: event.rdates,
    status: event.status,
    transparency: event.transparency,
    organizer: event.organizer,
    attendees: event.attendees,
    categories: event.categories,
    reminders: event.reminders,
    color: event.color,
    rawIcs: ctx.rawIcs ?? undefined,
    // Identity + bookkeeping the remote side always owns.
    uid: parsed.uid,
    recurrenceId: event.recurrenceId ?? null,
    remoteSequence: parsed.sequence,
    remoteLastModified: formatRemoteLastModified(parsed.lastModifiedMs),
  };
}

/** Full insert payload for a newly discovered remote event. */
export function eventInsertValues(parsed: ParsedEvent, ctx: EventContext): Record<string, unknown> {
  return {
    userId: ctx.userId,
    calendarId: ctx.calendarId,
    summary: '',
    isAllDay: false,
    timezone: ctx.timezone,
    status: 'confirmed',
    transparency: 'opaque',
    syncProvider: 'caldav',
    syncState: 'synced',
    ...pickDefined(eventValuesFromParsed(parsed, ctx)),
  };
}

/** Task fields asserted by the remote VTODO. */
export function taskValuesFromParsed(parsed: ParsedTodo, ctx: TaskContext): Record<string, unknown> {
  const task = parsed.task;
  return {
    title: task.title,
    notes: task.notes,
    url: task.url,
    status: task.status,
    priority: task.priority,
    dueAtMs: task.dueAtMs,
    dueDate: task.dueDate,
    startAtMs: task.startAtMs,
    startDate: task.startDate,
    isAllDay: task.isAllDay,
    timezone: task.timezone,
    completedAtMs: task.completedAtMs,
    recurrenceRule: task.recurrenceRule,
    recurrenceId: task.recurrenceId,
    estimateMinutes: task.estimateMinutes,
    isPinned: task.isPinned,
    rawIcs: ctx.rawIcs ?? undefined,
    externalUid: parsed.uid,
    remoteSequence: parsed.sequence,
    remoteLastModified: formatRemoteLastModified(parsed.lastModifiedMs),
  };
}

/** Full insert payload for a newly discovered remote VTODO. */
export function taskInsertValues(parsed: ParsedTodo, ctx: TaskContext): Record<string, unknown> {
  return {
    userId: ctx.userId,
    calendarId: ctx.calendarId,
    title: 'Untitled task',
    status: 'todo',
    priority: 'none',
    isAllDay: false,
    recurrenceMode: 'due',
    spentMinutes: 0,
    sortOrder: 'a0',
    isPinned: false,
    timezone: ctx.timezone,
    syncProvider: 'caldav',
    syncState: 'synced',
    ...pickDefined(taskValuesFromParsed(parsed, ctx)),
  };
}

/* -------------------------------------------------------------------------- */
/* row -> merge view / audit snapshot                                         */
/* -------------------------------------------------------------------------- */

function project(row: Record<string, unknown>, fields: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) out[field] = row[field];
  return out;
}

export function eventMergeView(row: CalendarEventRow): Record<string, unknown> {
  return pickDefined(project(row as unknown as Record<string, unknown>, EVENT_MERGE_FIELDS));
}

export function taskMergeView(row: TaskRow): Record<string, unknown> {
  return pickDefined(project(row as unknown as Record<string, unknown>, TASK_MERGE_FIELDS));
}

/** Compact, JSON-safe snapshot for the `sync_conflicts` audit trail. */
export function eventAuditSnapshot(row: CalendarEventRow): Record<string, unknown> {
  return {
    id: row.id,
    calendarId: row.calendarId,
    uid: row.uid,
    recurrenceId: row.recurrenceId,
    summary: row.summary,
    description: row.description,
    location: row.location,
    startMs: row.startMs,
    endMs: row.endMs,
    startDate: row.startDate,
    endDate: row.endDate,
    isAllDay: row.isAllDay,
    rrule: row.rrule,
    status: row.status,
    syncState: row.syncState,
    externalEtag: row.externalEtag,
    updatedAt: row.updatedAt,
    deletedAtMs: row.deletedAtMs,
  };
}

export function taskAuditSnapshot(row: TaskRow): Record<string, unknown> {
  return {
    id: row.id,
    externalUid: row.externalUid,
    externalHref: row.externalHref,
    title: row.title,
    notes: row.notes,
    status: row.status,
    priority: row.priority,
    dueAtMs: row.dueAtMs,
    dueDate: row.dueDate,
    completedAtMs: row.completedAtMs,
    recurrenceRule: row.recurrenceRule,
    syncState: row.syncState,
    externalEtag: row.externalEtag,
    updatedAt: row.updatedAt,
    deletedAtMs: row.deletedAtMs,
  };
}

/* -------------------------------------------------------------------------- */
/* row -> wire                                                                */
/* -------------------------------------------------------------------------- */

export interface IcsBuildOptions {
  /** iCalendar SEQUENCE; the engine increments the row's stored one. */
  sequence: number;
  /** Emitted as DTSTAMP. Defaults to now. */
  nowMs?: number;
}

/** Serialises an event row into the VCALENDAR body the transport PUTs. */
export function buildEventIcs(row: CalendarEventRow, opts: IcsBuildOptions): string {
  return serializeEvent(row, {
    prodId: PRODID,
    sequence: opts.sequence,
    dtstamp: new Date(opts.nowMs ?? Date.now()),
  });
}

/**
 * Serialises a task row into the VCALENDAR body the transport PUTs. The UID is
 * the task's `externalUid`, falling back to its local id on first upload.
 */
export function buildTaskIcs(row: TaskRow, opts: IcsBuildOptions): string {
  return serializeTodo(
    { ...row, externalUid: row.externalUid ?? row.id },
    { prodId: PRODID, sequence: opts.sequence, dtstamp: new Date(opts.nowMs ?? Date.now()) },
  );
}
