/**
 * What TaskTick would remind about next, as a list something else can deliver.
 *
 * ## Why this exists
 *
 * The reminder sweep (`reminders.ts`) answers "what is due *now*". A mirror
 * cannot use that: it has to know what is coming, so it can hand the schedule to
 * something that owns its own timers — Home Assistant, whose app is awake when an
 * installed PWA is not.
 *
 * So this is the same schedule the sweep is built on, read forwards instead of
 * backwards, and it is derived from the same building blocks on purpose:
 *
 *  - **tasks** come from the `task_reminders` rows, whose `fireAtMs` the editor
 *    already resolved (and which a completed repeating task rolls forward —
 *    `replaceReminders` under `nextOccurrence`), so no recurrence arithmetic is
 *    repeated here;
 *  - **habits** are a time of day plus a schedule, so the next fire is the first
 *    scheduled day whose instant is still ahead (the same `matchesSchedule` the
 *    sweep applies);
 *  - **events** are expanded by `expandedEventsInRange`, the one server-side
 *    expansion of a series, and their offsets are applied exactly as
 *    `dueEventReminders` applies them.
 *
 * ## What the caller gets
 *
 * One entry per *recurrence slot*, not per occurrence: a habit that reminds at
 * 07:30 every weekday is one entry with `repeat: 'daily'`, because the thing
 * doing the delivering schedules repetition better than TaskTick could by
 * enumerating a month of instants. `key` identifies the slot stably across polls
 * — it is how a mirror recognises "this is the same reminder, its time moved"
 * rather than "that one went away and a new one appeared" — and it deliberately
 * contains no row id, because `replaceReminders` deletes and re-inserts on every
 * edit.
 *
 * All-day events are left out: with no start time there is no instant to count an
 * offset back from, and inventing one would put a notification at an hour nobody
 * chose.
 */
import { addDaysToDateOnly, dateOnlyToMillis, toDateOnly } from '@/lib/dates';
import type { CalendarEvent, DateOnly, Habit, Millis } from '@/lib/types';
import { habitsWithReminders, matchesSchedule } from '../repos/habits';
import { tasksWithReminders } from '../repos/tasks';
import { expandedEventsInRange } from './calendar-items';
import type { MirroredSource } from './ha-delivery';

/** How far ahead the schedule reaches by default, in days. */
export const REMINDER_SCHEDULE_DEFAULT_DAYS = 21;

/** The longest lookahead a caller may ask for. */
export const REMINDER_SCHEDULE_MAX_DAYS = 60;

/** A cap on the answer, so a pathological account cannot produce an unbounded reply. */
export const MAX_SCHEDULED_REMINDERS = 500;

/** How a delivering mirror should treat the slot: once, or every matching day. */
export type ReminderRepeat = 'once' | 'daily';

/** One reminder TaskTick would send, described so somebody else can send it. */
export interface ScheduledReminder {
  /**
   * Stable identity of the recurrence slot, e.g. `task:<id>:off:-30`,
   * `habit:<id>:420`, `event:<id>:60`. A mirror keys its own bookkeeping on this.
   */
  key: string;
  source: MirroredSource;
  /** The task, event or habit id. */
  sourceId: string;
  title: string;
  body: string;
  /**
   * The day the reminder is *about*, which is not always the day it fires: an
   * event's "-1 day" reminder belongs to the event's day, and that is the day a
   * deep link has to open.
   */
  date: DateOnly;
  /** When TaskTick would notify, as epoch milliseconds. */
  fireAtMs: Millis;
  repeat: ReminderRepeat;
  /** Minute of local midnight, for a `daily` repeat; null for a one-shot. */
  minuteOfDay: number | null;
  /** Weekdays a `daily` repeat runs on, 0 = Sunday; null means every day. */
  weekDays: number[] | null;
}

function clampDays(days: number | null | undefined): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return REMINDER_SCHEDULE_DEFAULT_DAYS;
  return Math.min(Math.max(Math.trunc(days), 1), REMINDER_SCHEDULE_MAX_DAYS);
}

/** The habit's scheduled weekdays in the app's own convention (0 = Sunday), or null for every day. */
function habitWeekDays(habit: Habit): number[] | null {
  if (habit.frequency !== 'custom') return null;
  const days = habit.weekDays?.length ? habit.weekDays : [0, 1, 2, 3, 4, 5, 6];
  return [...new Set(days)].sort((a, b) => a - b);
}

/** The first scheduled day at or after `nowMs` on which `minute` is still ahead. */
function nextHabitFire(
  habit: Habit,
  minute: number,
  zone: string,
  nowMs: Millis,
  days: number,
): { date: DateOnly; fireAtMs: Millis } | null {
  const today = toDateOnly(nowMs, zone);

  for (let offset = 0; offset <= days; offset += 1) {
    const day = addDaysToDateOnly(today, offset, zone);
    if (!matchesSchedule(habit, day)) continue;
    const fireAtMs = dateOnlyToMillis(day, zone) + minute * 60_000;
    if (fireAtMs <= nowMs) continue;
    return { date: day, fireAtMs };
  }

  return null;
}

/** The day a millisecond instant falls on, in the given zone. */
function dayOf(ms: Millis, zone: string): DateOnly {
  return toDateOnly(ms, zone);
}

/**
 * Every reminder TaskTick would send in the next `days`, soonest first.
 *
 * Read-only and idempotent: calling it twice changes nothing, which is what lets
 * a poller ask every minute without side effects of its own.
 */
export async function upcomingReminders(
  userId: string,
  zone: string,
  nowMs: Millis,
  days?: number | null,
): Promise<ScheduledReminder[]> {
  const window = clampDays(days);
  const horizonMs = nowMs + window * 24 * 60 * 60 * 1000;
  const scheduled: ScheduledReminder[] = [];

  for (const { task, reminders } of await tasksWithReminders(userId)) {
    const taskZone = task.timezone ?? zone;
    for (const reminder of reminders) {
      /*
       * `fireAtMs` is already absolute — the editor resolved the offset when the
       * due date was set, and completing a repeating task re-resolves it for the
       * next occurrence — so a reminder whose moment has passed is simply not
       * part of what is still to come.
       */
      if (reminder.fireAtMs <= nowMs || reminder.fireAtMs > horizonMs) continue;
      const slot = reminder.offsetMinutes !== null ? `off:${reminder.offsetMinutes}` : `abs:${reminder.absoluteAtMs}`;
      scheduled.push({
        key: `task:${task.id}:${slot}`,
        source: 'task',
        sourceId: task.id,
        title: task.title,
        body: 'Task due',
        date: task.dueAtMs !== null ? dayOf(task.dueAtMs, taskZone) : task.dueDate ?? dayOf(reminder.fireAtMs, taskZone),
        fireAtMs: reminder.fireAtMs,
        repeat: 'once',
        minuteOfDay: null,
        weekDays: null,
      });
    }
  }

  for (const habit of await habitsWithReminders(userId)) {
    const weekDays = habitWeekDays(habit);
    for (const minute of habit.reminders ?? []) {
      const next = nextHabitFire(habit, minute, zone, nowMs, window);
      if (!next) continue;
      scheduled.push({
        key: `habit:${habit.id}:${minute}`,
        source: 'habit',
        sourceId: habit.id,
        title: habit.name,
        body: 'Habit reminder',
        date: next.date,
        fireAtMs: next.fireAtMs,
        repeat: 'daily',
        minuteOfDay: minute,
        weekDays,
      });
    }
  }

  /*
   * The event window is widened backwards by the largest offset the editors can
   * produce, so an occurrence whose reminder fires *after* now but *before* its
   * own start is still inside the read. The offsets are applied below, and a fire
   * that has already passed is dropped there.
   */
  const span = 7 * 24 * 60 * 60 * 1000;
  for (const { event, startMs } of await expandedEventsInRange(userId, nowMs - span, horizonMs, zone)) {
    if ((event as CalendarEvent).isAllDay) continue;
    for (const offsetMinutes of event.reminders ?? []) {
      const fireAtMs = startMs + offsetMinutes * 60_000;
      if (fireAtMs <= nowMs || fireAtMs > horizonMs) continue;
      scheduled.push({
        key: `event:${event.id}:${offsetMinutes}`,
        source: 'event',
        sourceId: event.id,
        title: event.summary,
        body: 'Calendar event',
        date: dayOf(startMs, zone),
        fireAtMs,
        repeat: 'once',
        minuteOfDay: null,
        weekDays: null,
      });
    }
  }

  scheduled.sort((a, b) => a.fireAtMs - b.fireAtMs || a.key.localeCompare(b.key));
  return scheduled.slice(0, MAX_SCHEDULED_REMINDERS);
}
