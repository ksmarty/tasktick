/**
 * Read-only iCalendar subscription feed.
 *
 * Serves one VCALENDAR containing the user's events as VEVENTs and their
 * scheduled tasks as VTODOs, so Apple Calendar, Google Calendar, Thunderbird and
 * Fastmail can all subscribe to it via a `webcal://` URL.
 *
 * Recurring series are emitted with their RRULE intact rather than expanded —
 * that is the correct thing for a feed (the client expands them, and it keeps
 * the payload small), and it means an edit shows up immediately in the
 * subscriber instead of needing a re-expansion.
 *
 * The component body is produced by the same tested codec the CalDAV client
 * uses; this module only stitches the pieces into one calendar and manages the
 * envelope properties.
 */
import { serializeEvent, serializeTodo } from '@/server/caldav';
import { eventsInRange, listCalendars } from '@/server/repos/calendars';
import { queryTasks } from '@/server/repos/tasks';
import { fromDateOnly, toDateOnly } from '@/lib/dates';
import type { CalendarEvent, Task } from '@/lib/types';

const PRODID = '-//TaskTick//TaskTick Calendar//EN';

/** iCalendar requires CRLF and 75-octet folding; delegate both to the codec. */
function extractComponent(payload: string, name: 'VEVENT' | 'VTODO'): string | null {
  const begin = payload.indexOf(`BEGIN:${name}`);
  const end = payload.indexOf(`END:${name}`);
  if (begin === -1 || end === -1) return null;
  return payload.slice(begin, end + `END:${name}`.length);
}

/** Escapes a value for a TEXT property (used only for the envelope). */
function escapeText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

function wrap(components: string[], calendarName: string, timezone: string): string {
  const head = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    // PUBLISH is right for a one-way feed: subscribers must not try to write back.
    'METHOD:PUBLISH',
    'X-PUBLISHED-TTL:PT15M',
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    `X-WR-TIMEZONE:${timezone}`,
  ];

  const body = components.flatMap((component) => component.split('\r\n').filter(Boolean));

  return [...head, ...body, 'END:VCALENDAR', ''].join('\r\n');
}

export interface BuildFeedOptions {
  userId: string;
  zone: string;
  calendarName: string;
  startMs: number;
  endMs: number;
  includeTasks: boolean;
  includeEvents: boolean;
  listIds?: string[] | null;
}

export async function buildIcsFeed(options: BuildFeedOptions): Promise<string> {
  const { userId, zone, calendarName, startMs, endMs, includeTasks, includeEvents } = options;
  const components: string[] = [];

  if (includeEvents) {
    const [events, calendars] = await Promise.all([eventsInRange(userId, startMs, endMs, zone), listCalendars(userId)]);
    const colorByCalendar = new Map(calendars.map((c) => [c.id, c.color]));

    for (const event of events) {
      if (event.status === 'cancelled') continue;
      const payload = serializeEvent(toSerializableEvent(event, colorByCalendar.get(event.calendarId)), {
        prodId: PRODID,
      });
      const component = extractComponent(payload, 'VEVENT');
      if (component) components.push(component);
    }
  }

  if (includeTasks) {
    // A feed cannot represent "completed" meaningfully for most clients, so only
    // open tasks are published — a subscription full of finished work is noise.
    const tasks = await queryTasks({
      userId,
      zone,
      filter: { statuses: ['todo'], ...(options.listIds?.length ? { listIds: options.listIds } : {}) },
      sort: 'due',
      limit: 2000,
    });

    for (const task of tasks) {
      if (!task.dueDate && !task.dueAtMs) continue;
      const payload = serializeTodo(toSerializableTodo(task), { prodId: PRODID });
      const component = extractComponent(payload, 'VTODO');
      if (component) components.push(component);
    }
  }

  return wrap(components, calendarName, zone);
}

/**
 * Dates must sit inside the requested window, and the codec expects the domain
 * shape — this normalises a row into it without leaking DB columns into the feed.
 */
function toSerializableEvent(event: CalendarEvent, fallbackColor: string | undefined): CalendarEvent {
  return { ...event, color: event.color ?? fallbackColor ?? null };
}

function toSerializableTodo(task: Task): Partial<Task> & { externalUid: string } {
  return {
    externalUid: task.externalUid ?? `tasktick-task-${task.id}`,
    title: task.title,
    notes: task.notes,
    dueDate: task.dueDate,
    dueAtMs: task.dueAtMs,
    isAllDay: task.isAllDay,
    timezone: task.timezone,
    priority: task.priority,
    status: task.status,
    completedAtMs: task.completedAtMs,
    recurrenceRule: task.recurrenceRule,
    estimateMinutes: task.estimateMinutes,
    url: task.url,
  };
}

/**
 * Default feed window.
 *
 * Asymmetric on purpose: a subscription is a forward-looking view (what is
 * coming up), but people also scroll back through what they did, so a few years
 * of history are included. Wide enough that a task scheduled far out is not
 * silently missing from the subscribed calendar.
 */
export function defaultFeedRange(zone: string): { startMs: number; endMs: number } {
  const today = toDateOnly(Date.now(), zone);
  return {
    startMs: fromDateOnly(today, zone).minus({ years: 3 }).toMillis(),
    endMs: fromDateOnly(today, zone).plus({ years: 5 }).toMillis(),
  };
}

/** Builds the `webcal://` URL Apple Calendar needs to subscribe without prompts. */
export function webcalUrl(httpsUrl: string): string {
  return httpsUrl.replace(/^https?:\/\//, 'webcal://');
}
