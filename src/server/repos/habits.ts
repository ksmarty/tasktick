/**
 * Habit repository: definitions, daily check-ins, streaks and heatmap data.
 *
 * ## The streak model
 *
 * A habit has a *schedule* (which days/periods it is expected) and a *goal*
 * (how much counts as done in a period). A streak is the number of consecutive
 * **scheduled** periods that met the goal. Non-scheduled days are skipped rather
 * than breaking the streak, so a Mon/Wed/Fri habit keeps its streak over the
 * weekend — which is what every serious habit tracker does and what users
 * expect.
 *
 * The current period is always treated as *not yet failed*: if a Mon/Wed/Fri
 * habit is due today and you have not checked in yet, the streak still shows the
 * value it had after the previous scheduled day. Failing a period only breaks
 * the streak once that period is genuinely over.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { habitEntries, habits } from '../db/schema';
import { newId } from '../crypto';
import { keyBetween, spreadKeys } from '@/lib/fractional';
import { asAccentColor } from '@/lib/colors';
import {
  DATE_FORMAT,
  addDaysToDateOnly,
  fromDateOnly,
  startOfWeekDate,
  todayIn,
  weekBounds,
  monthBounds,
} from '@/lib/dates';
import { weekdayOfDate } from '@/lib/rrule';
import type { AccentColor, DateOnly, Habit, HabitFrequency, HabitGoalType } from '@/lib/types';

export interface CreateHabitInput {
  name: string;
  description?: string | null;
  icon?: string | null;
  color?: AccentColor;
  goalType?: HabitGoalType;
  goalTarget?: number;
  unit?: string | null;
  frequency?: HabitFrequency;
  weekDays?: number[] | null;
  timesPerPeriod?: number;
  startDate?: DateOnly;
  /** Reminder times as minutes since local midnight (0–1439). */
  reminders?: number[] | null;
}

export type UpdateHabitInput = Partial<Omit<CreateHabitInput, 'startDate'>> & {
  archived?: boolean;
  startDate?: DateOnly;
};

function rowToHabit(row: typeof habits.$inferSelect): Habit {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: asAccentColor(row.color),
    goalType: row.goalType,
    goalTarget: row.goalTarget,
    unit: row.unit,
    frequency: row.frequency,
    weekDays: row.weekDays ? row.weekDays.split(',').map((n) => Number.parseInt(n, 10)) : null,
    timesPerPeriod: row.timesPerPeriod,
    startDate: row.startDate,
    reminders: row.reminders ?? null,
    archived: row.archived,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* schedule maths                                                             */
/* -------------------------------------------------------------------------- */

/** Whether the habit is expected on a given day. */
export function isScheduledOn(habit: Habit, date: DateOnly): boolean {
  if (date < habit.startDate) return false;
  switch (habit.frequency) {
    case 'custom': {
      const days = habit.weekDays?.length ? habit.weekDays : [0, 1, 2, 3, 4, 5, 6];
      return days.includes(weekdayOfDate(date));
    }
    case 'daily':
    case 'weekly':
    case 'monthly':
    default:
      return true;
  }
}

/** The period a date belongs to, and the first day of that period. */
export function periodKey(habit: Habit, date: DateOnly, weekStartsOn: number, zone: string): { key: string; start: DateOnly; end: DateOnly } {
  if (habit.frequency === 'weekly') {
    const { start, end } = weekBounds(date, weekStartsOn, zone);
    return { key: start, start, end };
  }
  if (habit.frequency === 'monthly') {
    const { start, end } = monthBounds(date, zone);
    return { key: start.slice(0, 7), start, end };
  }
  return { key: date, start: date, end: date };
}

/** How much is required for one period to count as done. */
export function periodTarget(habit: Habit): number {
  if (habit.frequency === 'weekly' || habit.frequency === 'monthly') {
    return habit.timesPerPeriod > 0 ? habit.timesPerPeriod : Math.max(1, habit.goalTarget);
  }
  return Math.max(0.0001, habit.goalTarget);
}

/** The value a check-in contributes: 1 for boolean habits, else the raw amount. */
function entryWeight(goalType: HabitGoalType, count: number, value: number | null): number {
  if (goalType === 'duration') return value ?? count;
  if (goalType === 'count') return count;
  return count > 0 ? 1 : 0;
}

interface PeriodProgress {
  /** Whether the goal was met. */
  met: boolean;
  total: number;
  target: number;
}

/** Aggregates entries into periods and decides which ones were satisfied. */
function computePeriodProgress(
  habit: Habit,
  entries: Record<DateOnly, { count: number; value: number | null }>,
  fromDate: DateOnly,
  toDate: DateOnly,
  weekStartsOn: number,
  zone: string,
): Map<string, PeriodProgress> {
  const periods = new Map<string, PeriodProgress>();
  const target = periodTarget(habit);

  for (let cursor = fromDate; cursor <= toDate; cursor = addDaysToDateOnly(cursor, 1, zone)) {
    const entry = entries[cursor];
    if (!entry) continue;
    const { key } = periodKey(habit, cursor, weekStartsOn, zone);
    const current = periods.get(key) ?? { met: false, total: 0, target };
    current.total += entryWeight(habit.goalType, entry.count, entry.value);
    periods.set(key, current);
  }

  for (const progress of periods.values()) {
    progress.met = progress.total >= progress.target;
  }

  return periods;
}

/**
 * Consecutive completed periods, ending at the current one.
 *
 * `allowPendingToday` is the grace rule described in the file header: the
 * in-progress period does not break the streak, it is simply not counted yet.
 */
export function computeStreak(
  habit: Habit,
  progress: Map<string, PeriodProgress>,
  today: DateOnly,
  weekStartsOn: number,
  zone: string,
): number {
  let streak = 0;
  const maxLookback = habit.frequency === 'monthly' ? 400 : habit.frequency === 'weekly' ? 400 : 1500;

  if (habit.frequency === 'weekly' || habit.frequency === 'monthly') {
    let cursor = today;
    for (let i = 0; i < maxLookback; i++) {
      const period = periodKey(habit, cursor, weekStartsOn, zone);
      const isCurrent = period.start <= today && today <= period.end;
      const state = progress.get(period.key);

      if (state?.met) {
        streak++;
      } else if (isCurrent) {
        // Current period still open — do not break, do not count.
      } else {
        break;
      }

      // Step to the previous period.
      cursor = habit.frequency === 'weekly'
        ? addDaysToDateOnly(period.start, -1, zone)
        : addDaysToDateOnly(period.start, -1, zone);
    }
    return streak;
  }

  // Daily / custom: walk back one scheduled day at a time.
  let cursor = today;
  let checkedPeriods = 0;
  while (checkedPeriods < maxLookback) {
    const due = isScheduledOn(habit, cursor);
    const isToday = cursor === today;

    if (due) {
      const state = progress.get(cursor);
      if (state?.met) streak++;
      else if (isToday) {
        // grace
      } else break;
    }

    cursor = addDaysToDateOnly(cursor, -1, zone);
    checkedPeriods++;
    if (cursor < habit.startDate) break;
  }

  return streak;
}

/** Longest run of satisfied periods anywhere in the window. */
function computeLongestStreak(
  habit: Habit,
  progress: Map<string, PeriodProgress>,
  fromDate: DateOnly,
  toDate: DateOnly,
  zone: string,
): number {
  const target = periodTarget(habit);
  let best = 0;
  let run = 0;

  for (let cursor = fromDate; cursor <= toDate; cursor = addDaysToDateOnly(cursor, 1, zone)) {
    if (!isScheduledOn(habit, cursor)) continue;
    const { key } = periodKey(habit, cursor, 1, zone);
    const state = progress.get(key);
    if (state && state.met) {
      run++;
      best = Math.max(best, run);
    } else if (cursor !== toDate) {
      run = 0;
    }
    void target;
  }

  return best;
}

/* -------------------------------------------------------------------------- */
/* reads                                                                      */
/* -------------------------------------------------------------------------- */

export interface ListHabitsOptions {
  userId: string;
  zone: string;
  weekStartsOn: number;
  /** Heatmap window. Defaults to the trailing 365 days. */
  from?: DateOnly;
  to?: DateOnly;
  includeArchived?: boolean;
}

export async function listHabits(options: ListHabitsOptions): Promise<Habit[]> {
  const db = getDb();
  const { userId, zone, weekStartsOn } = options;
  const today = todayIn(zone);
  const from = options.from ?? addDaysToDateOnly(today, -365, zone);
  const to = options.to ?? today;

  const conditions = [eq(habits.userId, userId), isNull(habits.deletedAtMs)];
  if (!options.includeArchived) conditions.push(eq(habits.archived, false));

  const rows = await db
    .select()
    .from(habits)
    .where(and(...conditions))
    .orderBy(asc(habits.sortOrder), asc(habits.name));

  if (!rows.length) return [];

  const entryRows = await db
    .select()
    .from(habitEntries)
    .where(
      and(
        eq(habitEntries.userId, userId),
        inArray(habitEntries.habitId, rows.map((r) => r.id)),
        gte(habitEntries.date, from),
        lte(habitEntries.date, to),
      ),
    );

  const byHabit = new Map<string, typeof entryRows>();
  for (const entry of entryRows) {
    const list = byHabit.get(entry.habitId) ?? [];
    list.push(entry);
    byHabit.set(entry.habitId, list);
  }

  return rows.map((row) => {
    const habit = rowToHabit(row);
    const raw = byHabit.get(row.id) ?? [];

    const entries: Record<DateOnly, number> = {};
    const detailed: Record<DateOnly, { count: number; value: number | null }> = {};
    for (const entry of raw) {
      entries[entry.date] = entry.count;
      detailed[entry.date] = { count: entry.count, value: entry.value };
    }

    const progress = computePeriodProgress(habit, detailed, from, to, weekStartsOn, zone);
    const currentPeriod = periodKey(habit, today, weekStartsOn, zone);
    const currentState = progress.get(currentPeriod.key);

    habit.entries = entries;
    habit.streak = computeStreak(habit, progress, today, weekStartsOn, zone);
    habit.longestStreak = computeLongestStreak(habit, progress, from, to, zone);
    habit.doneToday = currentState?.met ?? false;
    habit.progress = Math.min(1, (currentState?.total ?? 0) / periodTarget(habit));

    const scheduledDays = Object.keys(detailed).length;
    const metPeriods = [...progress.values()].filter((p) => p.met).length;
    habit.completionRate = scheduledDays === 0 ? 0 : Math.min(1, metPeriods / Math.max(1, scheduledDays));

    return habit;
  });
}

export async function getHabit(
  userId: string,
  id: string,
  zone: string,
  weekStartsOn: number,
): Promise<Habit | null> {
  const all = await listHabits({ userId, zone, weekStartsOn, includeArchived: true });
  return all.find((h) => h.id === id) ?? null;
}

/** Per-day completion counts across all habits, for the productivity strip. */
export async function habitCompletionSeries(
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<Record<DateOnly, number>> {
  const db = getDb();
  const rows = await db
    .select({ date: habitEntries.date, count: sql<number>`count(*)` })
    .from(habitEntries)
    .where(and(eq(habitEntries.userId, userId), gte(habitEntries.date, from), lte(habitEntries.date, to)))
    .groupBy(habitEntries.date);

  const out: Record<DateOnly, number> = {};
  for (const row of rows) out[row.date] = Number(row.count);
  return out;
}

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

export async function createHabit(
  userId: string,
  input: CreateHabitInput,
  zone: string,
): Promise<Habit> {
  const db = getDb();
  const [last] = await db
    .select({ sortOrder: habits.sortOrder })
    .from(habits)
    .where(and(eq(habits.userId, userId), isNull(habits.deletedAtMs)))
    .orderBy(desc(habits.sortOrder))
    .limit(1);

  const id = newId();
  const now = Date.now();

  await db.insert(habits).values({
    id,
    userId,
    name: input.name.trim() || 'New habit',
    description: input.description ?? null,
    icon: input.icon ?? null,
    color: input.color ?? 'green',
    goalType: input.goalType ?? 'boolean',
    goalTarget: input.goalTarget ?? 1,
    unit: input.unit ?? null,
    frequency: input.frequency ?? 'daily',
    weekDays: input.weekDays?.length ? input.weekDays.join(',') : null,
    timesPerPeriod: input.timesPerPeriod ?? 1,
    startDate: input.startDate ?? todayIn(zone),
    reminders: normalizeReminderMinutes(input.reminders),
    sortOrder: keyBetween(last?.sortOrder ?? null, null).key,
    createdAt: now,
    updatedAt: now,
  });

  const created = await getHabit(userId, id, zone, 1);
  if (!created) throw new Error('Habit insert did not persist');
  return created;
}

/**
 * A habit's reminder times, normalised to the one stored shape.
 *
 * `null`, `undefined` and `[]` all mean "no reminders" and store `null`, so
 * "unset" and "an empty list" never become two different states. Otherwise the
 * minutes are clamped into a day, de-duplicated and sorted ascending: the same
 * wall-clock time twice is one reminder, because two identical times would fire
 * together and there is nothing a second copy could mean. A habit reminder is a
 * time of day, so the value is minutes since local midnight rather than an
 * instant — that is what keeps it the same clock time through a DST change and
 * independent of the reader's zone.
 */
export function normalizeReminderMinutes(input: number[] | null | undefined): number[] | null {
  if (!input || input.length === 0) return null;
  const minutes = input
    .filter((value) => Number.isFinite(value))
    .map((value) => Math.min(1439, Math.max(0, Math.round(value))));
  if (!minutes.length) return null;
  return [...new Set(minutes)].sort((a, b) => a - b);
}

export async function updateHabit(userId: string, id: string, input: UpdateHabitInput): Promise<Habit | null> {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };

  if (input.name !== undefined) patch.name = input.name.trim();
  if (input.description !== undefined) patch.description = input.description;
  if (input.icon !== undefined) patch.icon = input.icon;
  if (input.color !== undefined) patch.color = input.color;
  if (input.goalType !== undefined) patch.goalType = input.goalType;
  if (input.goalTarget !== undefined) patch.goalTarget = Math.max(0.0001, input.goalTarget);
  if (input.unit !== undefined) patch.unit = input.unit;
  if (input.frequency !== undefined) patch.frequency = input.frequency;
  if (input.weekDays !== undefined) patch.weekDays = input.weekDays?.length ? input.weekDays.join(',') : null;
  if (input.timesPerPeriod !== undefined) patch.timesPerPeriod = Math.max(1, input.timesPerPeriod);
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.archived !== undefined) patch.archived = input.archived;
  if (input.reminders !== undefined) {
    patch.reminders = normalizeReminderMinutes(input.reminders);
  }

  await db.update(habits).set(patch).where(and(eq(habits.id, id), eq(habits.userId, userId)));
  const row = await db
    .select()
    .from(habits)
    .where(and(eq(habits.id, id), eq(habits.userId, userId)))
    .limit(1);
  return row.length ? rowToHabit(row[0]) : null;
}

export async function deleteHabit(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: habits.id })
    .from(habits)
    .where(and(eq(habits.id, id), eq(habits.userId, userId)))
    .limit(1);
  if (!existing) return false;

  await db.delete(habitEntries).where(and(eq(habitEntries.habitId, id), eq(habitEntries.userId, userId)));
  await db.delete(habits).where(and(eq(habits.id, id), eq(habits.userId, userId)));
  return true;
}

export async function reorderHabits(userId: string, orderedIds: string[]): Promise<void> {
  const db = getDb();
  const keys = spreadKeys(orderedIds.length);
  for (let i = 0; i < orderedIds.length; i++) {
    await db
      .update(habits)
      .set({ sortOrder: keys[i], updatedAt: Date.now() })
      .where(and(eq(habits.id, orderedIds[i]), eq(habits.userId, userId)));
  }
}

export interface CheckInInput {
  date?: DateOnly;
  /** Set to null to clear the entry (untick). */
  count?: number | null;
  value?: number | null;
  note?: string | null;
}

/**
 * Upserts (or clears) the entry for one habit on one day.
 *
 * Unticking deletes the row rather than storing a zero, so "no entry" and
 * "logged zero" stay distinguishable and the heatmap does not light up for a
 * day the user explicitly did nothing.
 */
export async function checkIn(
  userId: string,
  habitId: string,
  input: CheckInInput,
  zone: string,
): Promise<{ entries: Record<DateOnly, number>; doneToday: boolean } | null> {
  const db = getDb();
  const date = input.date ?? todayIn(zone);

  const [habitRow] = await db
    .select()
    .from(habits)
    .where(and(eq(habits.id, habitId), eq(habits.userId, userId), isNull(habits.deletedAtMs)))
    .limit(1);
  if (!habitRow) return null;

  const cleared = input.count === null || input.count === 0;

  if (cleared) {
    await db
      .delete(habitEntries)
      .where(and(eq(habitEntries.habitId, habitId), eq(habitEntries.userId, userId), eq(habitEntries.date, date)));
  } else {
    const [existing] = await db
      .select()
      .from(habitEntries)
      .where(and(eq(habitEntries.habitId, habitId), eq(habitEntries.userId, userId), eq(habitEntries.date, date)))
      .limit(1);

    const count = input.count ?? (habitRow.goalType === 'boolean' ? 1 : 1);
    const value = input.value ?? existing?.value ?? null;

    if (existing) {
      await db
        .update(habitEntries)
        .set({ count, value, note: input.note ?? existing.note, updatedAt: Date.now() })
        .where(eq(habitEntries.id, existing.id));
    } else {
      await db.insert(habitEntries).values({
        id: newId(),
        userId,
        habitId,
        date,
        count,
        value,
        note: input.note ?? null,
      });
    }
  }

  const habit = rowToHabit(habitRow);
  const entries = await listHabits({
    userId,
    zone,
    weekStartsOn: 1,
    from: addDaysToDateOnly(date, -400, zone),
    to: date > todayIn(zone) ? date : todayIn(zone),
    includeArchived: true,
  });

  const updated = entries.find((h) => h.id === habitId);
  void habit;

  return {
    entries: updated?.entries ?? {},
    doneToday: updated?.doneToday ?? false,
  };
}

/** Increments the count for a `count`/`duration` habit by `delta`. */
export async function incrementHabit(
  userId: string,
  habitId: string,
  delta: number,
  date: DateOnly | undefined,
  zone: string,
): Promise<{ entries: Record<DateOnly, number>; doneToday: boolean } | null> {
  const db = getDb();
  const day = date ?? todayIn(zone);

  const [existing] = await db
    .select()
    .from(habitEntries)
    .where(and(eq(habitEntries.habitId, habitId), eq(habitEntries.userId, userId), eq(habitEntries.date, day)))
    .limit(1);

  const next = Math.max(0, (existing?.count ?? 0) + delta);
  return checkIn(userId, habitId, { date: day, count: next, value: existing?.value ?? null }, zone);
}

export { DATE_FORMAT, fromDateOnly, startOfWeekDate };
