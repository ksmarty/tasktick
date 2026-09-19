/**
 * Calendar aggregation.
 *
 * The calendar renders ONE homogeneous list of blocks. This service is what
 * makes that possible: it expands recurring events and recurring tasks into
 * concrete occurrences inside the requested window and projects both object
 * kinds into a single `CalendarItem` shape.
 *
 * Rule: expansion happens on read, never on write. A recurring series is one row
 * in the database, so "move the whole series an hour later" stays a one-row
 * update no matter how far into the future it repeats.
 */
import { expandRecurrence } from '@/server/recurrence';
import { eventsInRange, listCalendars } from '@/server/repos/calendars';
import { tasksInRange } from '@/server/repos/tasks';
import { allDayBounds, dateOnlyToMillis, fromDateOnly, toDateOnly } from '@/lib/dates';
import { asAccentColor } from '@/lib/colors';
import type { Calendar, CalendarEvent, CalendarItem, Millis, Task } from '@/lib/types';

/** Default block length for a task that has a due time but no estimate. */
const DEFAULT_TASK_MINUTES = 30;

/** All-day events occupy whole days, so their DTEND is exclusive by convention. */
function allDayEventBounds(event: CalendarEvent, zone: string): { startMs: Millis; endMs: Millis } {
  return allDayBounds(event.startDate!, event.endDate, zone);
}

/** Resolves the instant pair for a non-recurring event. */
function eventBounds(event: CalendarEvent, zone: string): { startMs: Millis; endMs: Millis } {
  if (event.isAllDay && event.startDate) return allDayEventBounds(event, zone);

  const startMs = event.startMs ?? (event.startDate ? dateOnlyToMillis(event.startDate, zone) : 0);
  const endMs = event.endMs ?? (event.endDate ? dateOnlyToMillis(event.endDate, zone) : startMs + 60 * 60 * 1000);
  return { startMs, endMs: Math.max(endMs, startMs) };
}

/** Parses the stored EXDATE strings into instants for the expander. */
function exdateSet(event: CalendarEvent): Set<number> {
  const out = new Set<number>();
  for (const raw of event.exdates ?? []) {
    const ms = Number.parseInt(raw, 10);
    if (Number.isFinite(ms)) out.add(ms);
  }
  return out;
}

interface ExpandedEvent {
  event: CalendarEvent;
  startMs: Millis;
  endMs: Millis;
}

/**
 * Expands one event into its occurrences inside the window.
 *
 * A `recurrenceId` row is a per-instance override: RFC 5545 lets a calendar
 * store a modified copy of a single occurrence, identified by the original
 * occurrence's start time. Those overrides are merged in here by replacing the
 * generated occurrence rather than adding to it.
 */
function expandEvent(event: CalendarEvent, range: { startMs: Millis; endMs: Millis }, zone: string): ExpandedEvent[] {
  const base = eventBounds(event, zone);

  if (!event.rrule) {
    return base.endMs > range.startMs && base.startMs < range.endMs
      ? [{ event, startMs: base.startMs, endMs: base.endMs }]
      : [];
  }

  const duration = base.endMs - base.startMs;
  const excluded = exdateSet(event);

  const occurrences = expandRecurrence({
    rrule: event.rrule,
    startMs: base.startMs,
    durationMs: duration,
    timezone: event.timezone || zone,
    exdates: event.exdates,
    rdates: event.rdates,
    range,
    maxOccurrences: 1000,
  });

  return occurrences
    .filter((occurrence) => !excluded.has(occurrence.startMs))
    .map((occurrence) => ({
      event,
      startMs: occurrence.startMs,
      endMs: occurrence.endMs ?? occurrence.startMs + duration,
    }));
}

function toEventItem(
  expanded: ExpandedEvent,
  calendar: Calendar | undefined,
  zone: string,
): CalendarItem {
  const { event, startMs, endMs } = expanded;

  // A cancelled instance still occupies the series' slot in the data, but it
  // must not be drawn as a real commitment.
  const color = asAccentColor(event.color ?? calendar?.colorOverride ?? calendar?.color ?? 'blue');

  return {
    key: `event:${event.id}:${startMs}`,
    kind: 'event',
    id: event.id,
    title: event.summary || '(No title)',
    startMs,
    endMs,
    isAllDay: event.isAllDay,
    color,
    calendarId: event.calendarId,
    calendarName: calendar?.name,
    location: event.location,
    url: event.url,
    seriesUid: event.uid,
    isRecurringInstance: Boolean(event.rrule),
    readonly: Boolean(calendar?.readOnly),
  };
}

function toTaskItem(task: Task, startMs: Millis, calendar: Calendar | undefined, zone: string): CalendarItem {
  const minutes = task.estimateMinutes && task.estimateMinutes > 0 ? task.estimateMinutes : DEFAULT_TASK_MINUTES;
  const timed = Boolean(task.dueAtMs);

  return {
    key: `task:${task.id}:${startMs}`,
    kind: 'task',
    id: task.id,
    title: task.title,
    startMs,
    endMs: timed ? startMs + minutes * 60_000 : dateOnlyToMillis(toDateOnly(startMs, zone), zone) + 86_400_000,
    isAllDay: !timed,
    color: asAccentColor(calendar?.color ?? 'blue'),
    calendarId: task.calendarId,
    calendarName: calendar?.name,
    completed: task.status === 'completed',
    priority: task.priority,
    listId: task.listId,
    url: task.url,
    isRecurringInstance: Boolean(task.recurrenceRule),
    readonly: Boolean(calendar?.readOnly),
  };
}

export interface CalendarItemsOptions {
  userId: string;
  zone: string;
  startMs: Millis;
  endMs: Millis;
  /** Include tasks that have a due date. On by default — that is the point. */
  includeTasks?: boolean;
  includeEvents?: boolean;
  /** Restrict to specific calendars (the sidebar's visible toggles). */
  calendarIds?: string[] | null;
}

/**
 * Every block visible in `[startMs, endMs)`, sorted for rendering.
 *
 * Sort order matters: all-day items float to the top of a day column, then
 * timed items by start, then by duration so the taller block is drawn first and
 * the shorter one stacks over it.
 */
export async function getCalendarItems(options: CalendarItemsOptions): Promise<CalendarItem[]> {
  const { userId, zone, startMs, endMs, includeTasks = true, includeEvents = true } = options;

  const calendars = await listCalendars(userId);
  /*
   * Two callers share this read, and they mean different things by it.
   *
   * The calendar screen always names the calendars it wants: it derives the ids
   * from `isVisible` and passes them explicitly. An explicit `calendarIds` is
   * therefore authoritative and nothing here may second-guess it. That is what
   * keeps a calendar hidden from the task list still drawn on the calendar
   * screen.
   *
     * The task list passes no ids, so the default read *is* the task list's read.
     * It drops a calendar for two reasons, and they are not the same thing:
     *
     *   * `isVisible` is off. Hiding a calendar **disables** it - off everywhere,
     *     so it stops contributing to the task list as well as disappearing from
     *     the calendar screen. A toggle called Hide that only half-hides is the
     *     kind of thing that makes a setting untrustworthy.
     *   * `showInTasks` is off. This is the refinement: the calendar is on, you
     *     want it on the calendar screen, and you do not want its events in the
     *     list. It only means anything while the calendar is visible, which is
     *     why the two are checked together rather than independently.
   */
  const visible = options.calendarIds?.length
    ? calendars.filter((c) => options.calendarIds!.includes(c.id))
    : calendars.filter((c) => c.isVisible && c.showInTasks);
  const byId = new Map(calendars.map((c) => [c.id, c]));

  const items: CalendarItem[] = [];

  if (includeEvents) {
    // Hand the exact calendar set down rather than letting the query re-derive
    // it from `isVisible`: `showInTasks` and `isVisible` are independent, and
    // the calendar screen's explicit ids must win over both.
    const events = await eventsInRange(userId, startMs, endMs, zone, {
      calendarIds: visible.map((c) => c.id),
    });

    for (const event of events) {
      if (event.status === 'cancelled') continue;

      for (const expanded of expandEvent(event, { startMs, endMs }, zone)) {
        items.push(toEventItem(expanded, byId.get(event.calendarId), zone));
      }
    }
  }

  if (includeTasks) {
    const tasks = await tasksInRange(userId, startMs, endMs, zone);
    const listCalendarIds = new Set(calendars.map((c) => c.id));

    for (const task of tasks) {
      // Tasks linked to a calendar whose events are hidden follow that calendar's
      // visibility; a plain list task is always shown.
      if (task.calendarId && !listCalendarIds.has(task.calendarId)) continue;

      const calendar = task.calendarId ? byId.get(task.calendarId) : undefined;

      if (task.recurrenceRule) {
        const anchorMs =
          task.dueAtMs ?? (task.dueDate ? fromDateOnly(task.dueDate, task.timezone ?? zone).toMillis() : null);
        if (anchorMs === null) continue;

        const occurrences = expandRecurrence({
          rrule: task.recurrenceRule,
          startMs: anchorMs,
          durationMs: task.dueAtMs ? 0 : 86_400_000,
          timezone: task.timezone ?? zone,
          range: { startMs, endMs },
          maxOccurrences: 1000,
        });
        for (const occurrence of occurrences) {
          items.push(toTaskItem(task, occurrence.startMs, calendar, zone));
        }
      } else {
        const start = task.dueAtMs ?? (task.dueDate ? dateOnlyToMillis(task.dueDate, task.timezone ?? zone) : null);
        if (start === null) continue;
        items.push(toTaskItem(task, start, calendar, zone));
      }
    }
  }

  items.sort((a, b) => {
    if (a.startMs !== b.startMs) return a.startMs - b.startMs;
    if (a.isAllDay !== b.isAllDay) return a.isAllDay ? -1 : 1;
    // Longer blocks first so shorter ones paint over them.
    return b.endMs - b.startMs - (a.endMs - a.startMs);
  });

  return items;
}

/**
 * Lays out overlapping timed items into columns for the day/week grid.
 *
 * Classic sweep: group items into clusters of mutually-overlapping blocks, then
 * give each item the first column where it does not collide. Every item in a
 * cluster reports the cluster's column count so widths line up.
 */
export interface LaidOutItem {
  item: CalendarItem;
  /** Zero-based column index. */
  column: number;
  /** Total columns in this item's overlap cluster. */
  columns: number;
}

export function layoutOverlaps(items: CalendarItem[]): LaidOutItem[] {
  const timed = items.filter((i) => !i.isAllDay).sort((a, b) => a.startMs - b.startMs || b.endMs - a.endMs);

  const result: LaidOutItem[] = [];
  let cluster: CalendarItem[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    if (!cluster.length) return;

    const columns: CalendarItem[][] = [];
    for (const item of cluster) {
      let placed = false;
      for (const column of columns) {
        const last = column[column.length - 1];
        if (last.endMs <= item.startMs) {
          column.push(item);
          result.push({ item, column: columns.indexOf(column), columns: columns.length });
          placed = true;
          break;
        }
      }
      if (!placed) {
        columns.push([item]);
        result.push({ item, column: columns.length - 1, columns: columns.length });
      }
    }

    // The column count is only final once the whole cluster is placed, so patch
    // the entries we already emitted for this cluster.
    const total = columns.length;
    for (let i = result.length - 1; i >= 0 && cluster.includes(result[i].item); i--) {
      result[i].columns = total;
    }

    cluster = [];
    clusterEnd = -Infinity;
  };

  for (const item of timed) {
    if (cluster.length && item.startMs >= clusterEnd) flush();
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMs);
  }
  flush();

  return result;
}

/** Groups items by floating day for the agenda and month views. */
export function groupItemsByDay(items: CalendarItem[], zone: string): Record<string, CalendarItem[]> {
  const out: Record<string, CalendarItem[]> = {};

  for (const item of items) {
    const firstDay = toDateOnly(item.startMs, zone);
    // A multi-day block should appear on every day it spans, not just its first.
    const lastDay = toDateOnly(Math.max(item.startMs, item.endMs - 1), zone);

    let cursor = fromDateOnly(firstDay, zone);
    const last = fromDateOnly(lastDay, zone);
    let guard = 0;
    while (cursor <= last && guard++ < 400) {
      const key = cursor.toFormat('yyyy-MM-dd');
      (out[key] ??= []).push(item);
      cursor = cursor.plus({ days: 1 });
    }
  }

  return out;
}
