/**
 * Period-tracking repository: cycles, day logs, contraception history, settings
 * and the assembled prediction.
 *
 * The *maths* lives in `src/lib/period-math.ts` and the CSV in
 * `src/lib/period-csv.ts`; this module only reads rows, maps them to the domain
 * types in `src/lib/period-types.ts`, and hands them to those pure functions.
 * That is what keeps every rule unit-testable without a database.
 *
 * ## Ordering
 *
 * Cycles come back oldest-first, because the cycle-length maths is directional
 * and re-sorting in three places is how the two orders drift apart. A UI that
 * wants newest-first reverses the array it was given.
 */
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { getDb } from '../db';
import {
  contraceptionDays,
  contraceptionMethods,
  periodCycles,
  periodDayLogs,
  periodSettings,
} from '../db/schema';
import { newId } from '../crypto';
import {
  buildContraceptionSchedule,
  buildPeriodPrediction,
  cycleIntervals,
  MAX_PLAUSIBLE_CYCLE_DAYS,
  type PeriodPredictionInput,
} from '@/lib/period-math';
import type {
  ContraceptionDayLog,
  ContraceptionDayLogInput,
  ContraceptionMethodInput,
  ContraceptionMethodRecord,
  ContraceptionMethodUpdate,
  ContraceptionScheduleDay,
  PeriodCycle,
  PeriodCycleInput,
  PeriodCycleUpdate,
  PeriodDayLog,
  PeriodDayLogInput,
  PeriodFlow,
  PeriodOverview,
  PeriodPrediction,
  PeriodSettings,
  PeriodSettingsUpdate,
  PeriodStats,
} from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';

/* -------------------------------------------------------------------------- */
/* mappers                                                                    */
/* -------------------------------------------------------------------------- */

type CycleRow = typeof periodCycles.$inferSelect;
type DayLogRow = typeof periodDayLogs.$inferSelect;
type MethodRow = typeof contraceptionMethods.$inferSelect;
type ContraceptionDayRow = typeof contraceptionDays.$inferSelect;

function rowToCycle(row: CycleRow): PeriodCycle {
  return {
    id: row.id,
    userId: row.userId,
    startDate: row.startDate,
    endDate: row.endDate,
    flowIntensity: row.flowIntensity,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToDayLog(row: DayLogRow): PeriodDayLog {
  return {
    id: row.id,
    userId: row.userId,
    date: row.date,
    flow: row.flow ?? null,
    // The JSON columns can be null in a row written before the field existed.
    symptoms: row.symptoms ?? [],
    mood: row.mood ?? [],
    temperatureC: row.temperatureC ?? null,
    lhTest: row.lhTest ?? null,
    mucus: row.mucus ?? null,
    intimacy: row.intimacy,
    ovulationPain: row.ovulationPain,
    weightKg: row.weightKg ?? null,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToMethod(row: MethodRow): ContraceptionMethodRecord {
  return {
    id: row.id,
    userId: row.userId,
    method: row.method,
    label: row.label,
    startDate: row.startDate,
    endDate: row.endDate,
    schedule: row.schedule ?? null,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToContraceptionDay(row: ContraceptionDayRow): ContraceptionDayLog {
  return {
    id: row.id,
    userId: row.userId,
    methodId: row.methodId,
    date: row.date,
    status: row.status,
    notes: row.notes,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/* -------------------------------------------------------------------------- */
/* settings                                                                   */
/* -------------------------------------------------------------------------- */

export const DEFAULT_PERIOD_SETTINGS: PeriodSettings = {
  enabled: false,
  predictionCycleCount: null,
  lutealPhaseDays: 14,
  contraceptionInUse: false,
};

/** Settings always exist; a missing row is created from the defaults. */
export async function getPeriodSettings(userId: string): Promise<PeriodSettings> {
  const db = getDb();
  const [row] = await db.select().from(periodSettings).where(eq(periodSettings.userId, userId)).limit(1);
  if (row) {
    return {
      enabled: row.enabled,
      predictionCycleCount: row.predictionCycleCount ?? null,
      lutealPhaseDays: row.lutealPhaseDays,
      contraceptionInUse: row.contraceptionInUse,
    };
  }
  await db.insert(periodSettings).values({ userId, ...DEFAULT_PERIOD_SETTINGS }).onConflictDoNothing();
  return { ...DEFAULT_PERIOD_SETTINGS };
}

export async function updatePeriodSettings(userId: string, input: PeriodSettingsUpdate): Promise<PeriodSettings> {
  const db = getDb();
  await getPeriodSettings(userId); // guarantees the row exists

  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.enabled !== undefined) patch.enabled = input.enabled;
  if (input.predictionCycleCount !== undefined) {
    patch.predictionCycleCount =
      input.predictionCycleCount === null ? null : Math.min(36, Math.max(2, Math.trunc(input.predictionCycleCount)));
  }
  if (input.lutealPhaseDays !== undefined) {
    patch.lutealPhaseDays = Math.min(17, Math.max(9, Math.trunc(input.lutealPhaseDays)));
  }
  if (input.contraceptionInUse !== undefined) patch.contraceptionInUse = input.contraceptionInUse;

  await db.update(periodSettings).set(patch).where(eq(periodSettings.userId, userId));
  return getPeriodSettings(userId);
}

/* -------------------------------------------------------------------------- */
/* cycles                                                                     */
/* -------------------------------------------------------------------------- */

export interface PeriodRangeOptions {
  from?: DateOnly | null;
  to?: DateOnly | null;
}

export async function listPeriodCycles(userId: string, options: PeriodRangeOptions = {}): Promise<PeriodCycle[]> {
  const db = getDb();
  const conditions = [eq(periodCycles.userId, userId)];
  if (options.from) conditions.push(gte(periodCycles.startDate, options.from));
  if (options.to) conditions.push(lte(periodCycles.startDate, options.to));

  const rows = await db
    .select()
    .from(periodCycles)
    .where(and(...conditions))
    .orderBy(asc(periodCycles.startDate));
  return rows.map(rowToCycle);
}

export async function getPeriodCycle(userId: string, id: string): Promise<PeriodCycle | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(periodCycles)
    .where(and(eq(periodCycles.id, id), eq(periodCycles.userId, userId)))
    .limit(1);
  return row ? rowToCycle(row) : null;
}

/** Looked up before a create/update so a duplicate start date is a clear 409. */
export async function getPeriodCycleByStart(userId: string, startDate: DateOnly): Promise<PeriodCycle | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(periodCycles)
    .where(and(eq(periodCycles.userId, userId), eq(periodCycles.startDate, startDate)))
    .limit(1);
  return row ? rowToCycle(row) : null;
}

export async function createPeriodCycle(userId: string, input: PeriodCycleInput): Promise<PeriodCycle> {
  const db = getDb();
  const id = newId();
  await db.insert(periodCycles).values({
    id,
    userId,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    flowIntensity: input.flowIntensity ?? 'medium',
    notes: input.notes ?? null,
  });
  const created = await getPeriodCycle(userId, id);
  if (!created) throw new Error('Cycle insert did not persist');
  return created;
}

export async function updatePeriodCycle(
  userId: string,
  id: string,
  input: PeriodCycleUpdate,
): Promise<PeriodCycle | null> {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  // `undefined` means "leave it"; an explicit `null` clears the end date, which
  // is how a user un-does an end date they entered by mistake.
  if (input.endDate !== undefined) patch.endDate = input.endDate;
  if (input.flowIntensity !== undefined) patch.flowIntensity = input.flowIntensity;
  if (input.notes !== undefined) patch.notes = input.notes;

  await db.update(periodCycles).set(patch).where(and(eq(periodCycles.id, id), eq(periodCycles.userId, userId)));
  return getPeriodCycle(userId, id);
}

export async function deletePeriodCycle(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: periodCycles.id })
    .from(periodCycles)
    .where(and(eq(periodCycles.id, id), eq(periodCycles.userId, userId)))
    .limit(1);
  if (!existing) return false;
  await db.delete(periodCycles).where(and(eq(periodCycles.id, id), eq(periodCycles.userId, userId)));
  return true;
}

/* -------------------------------------------------------------------------- */
/* day logs                                                                   */
/* -------------------------------------------------------------------------- */

export async function listPeriodDayLogs(userId: string, options: PeriodRangeOptions = {}): Promise<PeriodDayLog[]> {
  const db = getDb();
  const conditions = [eq(periodDayLogs.userId, userId)];
  if (options.from) conditions.push(gte(periodDayLogs.date, options.from));
  if (options.to) conditions.push(lte(periodDayLogs.date, options.to));

  const rows = await db
    .select()
    .from(periodDayLogs)
    .where(and(...conditions))
    .orderBy(asc(periodDayLogs.date));
  return rows.map(rowToDayLog);
}

export async function getPeriodDayLog(userId: string, date: DateOnly): Promise<PeriodDayLog | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(periodDayLogs)
    .where(and(eq(periodDayLogs.userId, userId), eq(periodDayLogs.date, date)))
    .limit(1);
  return row ? rowToDayLog(row) : null;
}

/**
 * Creates or replaces the log for one day.
 *
 * Upsert-by-date is the right shape for the UI: toggling a symptom on a day is a
 * POST of the whole day, and there is exactly one of those per user per day.
 * Absent fields keep their stored value; explicit `null` clears them.
 */
export async function upsertPeriodDayLog(userId: string, input: PeriodDayLogInput): Promise<PeriodDayLog> {
  const db = getDb();
  const existing = await getPeriodDayLog(userId, input.date);

  const values = {
    flow: input.flow === undefined ? (existing?.flow ?? null) : input.flow,
    symptoms: input.symptoms === undefined ? (existing?.symptoms ?? null) : input.symptoms,
    mood: input.mood === undefined ? (existing?.mood ?? null) : input.mood,
    temperatureC: input.temperatureC === undefined ? (existing?.temperatureC ?? null) : input.temperatureC,
    lhTest: input.lhTest === undefined ? (existing?.lhTest ?? null) : input.lhTest,
    mucus: input.mucus === undefined ? (existing?.mucus ?? null) : input.mucus,
    intimacy: input.intimacy === undefined ? (existing?.intimacy ?? false) : input.intimacy,
    ovulationPain: input.ovulationPain === undefined ? (existing?.ovulationPain ?? false) : input.ovulationPain,
    weightKg: input.weightKg === undefined ? (existing?.weightKg ?? null) : input.weightKg,
    notes: input.notes === undefined ? (existing?.notes ?? null) : input.notes,
  };

  if (existing) {
    await db
      .update(periodDayLogs)
      .set({ ...values, updatedAt: Date.now() })
      .where(and(eq(periodDayLogs.id, existing.id), eq(periodDayLogs.userId, userId)));
  } else {
    await db.insert(periodDayLogs).values({
      id: newId(),
      userId,
      date: input.date,
      ...values,
      // An untouched boolean column has no meaningful "unset"; false is the
      // absence of the observation, unlike flow/temperature which are nullable.
      symptoms: values.symptoms ?? null,
      mood: values.mood ?? null,
    });
  }

  const saved = await getPeriodDayLog(userId, input.date);
  if (!saved) throw new Error('Day log upsert did not persist');
  return saved;
}

export type PeriodDayLogPatch = Omit<Partial<PeriodDayLogInput>, 'date'>;

export async function updatePeriodDayLog(
  userId: string,
  date: DateOnly,
  patch: PeriodDayLogPatch,
): Promise<PeriodDayLog> {
  return upsertPeriodDayLog(userId, { ...patch, date });
}

export async function deletePeriodDayLog(userId: string, date: DateOnly): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: periodDayLogs.id })
    .from(periodDayLogs)
    .where(and(eq(periodDayLogs.userId, userId), eq(periodDayLogs.date, date)))
    .limit(1);
  if (!existing) return false;
  await db.delete(periodDayLogs).where(and(eq(periodDayLogs.id, existing.id), eq(periodDayLogs.userId, userId)));
  return true;
}

/* -------------------------------------------------------------------------- */
/* contraception                                                              */
/* -------------------------------------------------------------------------- */

export async function listContraceptionMethods(
  userId: string,
  options: { activeOn?: DateOnly } = {},
): Promise<ContraceptionMethodRecord[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(contraceptionMethods)
    .where(eq(contraceptionMethods.userId, userId))
    .orderBy(asc(contraceptionMethods.startDate));

  const mapped = rows.map(rowToMethod);
  if (!options.activeOn) return mapped;
  const on = options.activeOn;
  return mapped.filter((method) => method.startDate <= on && (method.endDate === null || method.endDate >= on));
}

export async function getContraceptionMethod(userId: string, id: string): Promise<ContraceptionMethodRecord | null> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(contraceptionMethods)
    .where(and(eq(contraceptionMethods.id, id), eq(contraceptionMethods.userId, userId)))
    .limit(1);
  return row ? rowToMethod(row) : null;
}

export async function createContraceptionMethod(
  userId: string,
  input: ContraceptionMethodInput,
): Promise<ContraceptionMethodRecord> {
  const db = getDb();
  const id = newId();
  await db.insert(contraceptionMethods).values({
    id,
    userId,
    method: input.method,
    label: input.label ?? null,
    startDate: input.startDate,
    endDate: input.endDate ?? null,
    schedule: input.schedule ?? null,
    notes: input.notes ?? null,
  });
  const created = await getContraceptionMethod(userId, id);
  if (!created) throw new Error('Contraception method insert did not persist');
  return created;
}

export async function updateContraceptionMethod(
  userId: string,
  id: string,
  input: ContraceptionMethodUpdate,
): Promise<ContraceptionMethodRecord | null> {
  const db = getDb();
  const patch: Record<string, unknown> = { updatedAt: Date.now() };
  if (input.method !== undefined) patch.method = input.method;
  if (input.label !== undefined) patch.label = input.label;
  if (input.startDate !== undefined) patch.startDate = input.startDate;
  if (input.endDate !== undefined) patch.endDate = input.endDate;
  if (input.schedule !== undefined) patch.schedule = input.schedule;
  if (input.notes !== undefined) patch.notes = input.notes;

  await db
    .update(contraceptionMethods)
    .set(patch)
    .where(and(eq(contraceptionMethods.id, id), eq(contraceptionMethods.userId, userId)));
  return getContraceptionMethod(userId, id);
}

/** Deleting a method removes its logged days too (schema-level `cascade`). */
export async function deleteContraceptionMethod(userId: string, id: string): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: contraceptionMethods.id })
    .from(contraceptionMethods)
    .where(and(eq(contraceptionMethods.id, id), eq(contraceptionMethods.userId, userId)))
    .limit(1);
  if (!existing) return false;
  await db
    .delete(contraceptionMethods)
    .where(and(eq(contraceptionMethods.id, id), eq(contraceptionMethods.userId, userId)));
  return true;
}

export async function listContraceptionDays(
  userId: string,
  options: PeriodRangeOptions & { methodId?: string } = {},
): Promise<ContraceptionDayLog[]> {
  const db = getDb();
  const conditions = [eq(contraceptionDays.userId, userId)];
  if (options.from) conditions.push(gte(contraceptionDays.date, options.from));
  if (options.to) conditions.push(lte(contraceptionDays.date, options.to));
  if (options.methodId) conditions.push(eq(contraceptionDays.methodId, options.methodId));

  const rows = await db
    .select()
    .from(contraceptionDays)
    .where(and(...conditions))
    .orderBy(asc(contraceptionDays.date));
  return rows.map(rowToContraceptionDay);
}

/** Upsert by (method, date): logging a day again replaces the status. */
export async function upsertContraceptionDay(
  userId: string,
  input: ContraceptionDayLogInput,
): Promise<ContraceptionDayLog | null> {
  const db = getDb();
  const method = await getContraceptionMethod(userId, input.methodId);
  if (!method) return null;

  const [existing] = await db
    .select()
    .from(contraceptionDays)
    .where(
      and(
        eq(contraceptionDays.userId, userId),
        eq(contraceptionDays.methodId, input.methodId),
        eq(contraceptionDays.date, input.date),
      ),
    )
    .limit(1);

  if (existing) {
    await db
      .update(contraceptionDays)
      .set({
        status: input.status,
        notes: input.notes === undefined ? existing.notes : input.notes,
        updatedAt: Date.now(),
      })
      .where(eq(contraceptionDays.id, existing.id));
  } else {
    await db.insert(contraceptionDays).values({
      id: newId(),
      userId,
      methodId: input.methodId,
      date: input.date,
      status: input.status,
      notes: input.notes ?? null,
    });
  }

  const [saved] = await db
    .select()
    .from(contraceptionDays)
    .where(
      and(
        eq(contraceptionDays.userId, userId),
        eq(contraceptionDays.methodId, input.methodId),
        eq(contraceptionDays.date, input.date),
      ),
    )
    .limit(1);
  return saved ? rowToContraceptionDay(saved) : null;
}

export async function deleteContraceptionDay(userId: string, methodId: string, date: DateOnly): Promise<boolean> {
  const db = getDb();
  const [existing] = await db
    .select({ id: contraceptionDays.id })
    .from(contraceptionDays)
    .where(
      and(
        eq(contraceptionDays.userId, userId),
        eq(contraceptionDays.methodId, methodId),
        eq(contraceptionDays.date, date),
      ),
    )
    .limit(1);
  if (!existing) return false;
  await db.delete(contraceptionDays).where(eq(contraceptionDays.id, existing.id));
  return true;
}

/**
 * The generated on/off plan for every day-plan method, merged with what the user
 * actually logged. Nothing here is stored: the schedule is derived from each
 * method's `startDate`, so editing it changes the whole future plan at once.
 */
export async function listContraceptionSchedule(
  userId: string,
  from: DateOnly,
  to: DateOnly,
  zone: string,
): Promise<ContraceptionScheduleDay[]> {
  const methods = await listContraceptionMethods(userId);
  if (methods.length === 0) return [];

  const methodIds = methods.map((method) => method.id);
  const loggedRows = await listContraceptionDays(userId, { from, to });
  const loggedByMethod = new Map<string, Map<DateOnly, ContraceptionDayLog['status']>>();
  for (const row of loggedRows) {
    if (!methodIds.includes(row.methodId)) continue;
    const map = loggedByMethod.get(row.methodId) ?? new Map();
    map.set(row.date, row.status);
    loggedByMethod.set(row.methodId, map);
  }

  const out: ContraceptionScheduleDay[] = [];
  for (const method of methods) {
    out.push(
      ...buildContraceptionSchedule({
        method,
        from,
        to,
        loggedByDate: loggedByMethod.get(method.id),
        zone,
      }),
    );
  }
  return out.sort((a, b) => (a.date === b.date ? a.methodId.localeCompare(b.methodId) : a.date.localeCompare(b.date)));
}

/* -------------------------------------------------------------------------- */
/* prediction + stats                                                         */
/* -------------------------------------------------------------------------- */

/** Reads everything the prediction needs and hands it to the pure maths. */
export async function buildUserPrediction(
  userId: string,
  asOf: DateOnly,
  zone: string,
): Promise<PeriodPrediction> {
  const [settings, cycles, methods] = await Promise.all([
    getPeriodSettings(userId),
    listPeriodCycles(userId),
    listContraceptionMethods(userId),
  ]);

  const input: PeriodPredictionInput = {
    asOf,
    settings,
    cycles: cycles.map((cycle) => ({ startDate: cycle.startDate, endDate: cycle.endDate })),
    contraception: methods.map((method) => ({
      id: method.id,
      method: method.method,
      startDate: method.startDate,
      endDate: method.endDate,
    })),
    zone,
  };
  return buildPeriodPrediction(input);
}

export interface PeriodStatsOptions {
  from?: DateOnly | null;
  to?: DateOnly | null;
  zone: string;
}

/** Descriptive statistics over the recorded history, for the UI's charts. */
export async function buildPeriodStats(userId: string, options: PeriodStatsOptions): Promise<PeriodStats> {
  const [cycles, dayLogs] = await Promise.all([
    listPeriodCycles(userId),
    listPeriodDayLogs(userId, { from: options.from, to: options.to }),
  ]);

  const starts = cycles.map((cycle) => cycle.startDate);
  const measured = cycleIntervals(starts);
  // The same plausibility rule the prediction uses: a 90+ day "cycle" is a gap
  // in logging, and including it would make the summary describe the gap.
  const lengths = measured
    .map((days, index) => ({ from: starts[index]!, to: starts[index + 1]!, days }))
    .filter((entry) => entry.days >= 1 && entry.days <= MAX_PLAUSIBLE_CYCLE_DAYS);
  const values = lengths.map((entry) => entry.days);

  const flowCounts: Record<PeriodFlow, number> = { none: 0, spotting: 0, light: 0, medium: 0, heavy: 0 };
  const symptomTally = new Map<string, number>();
  const temperatureSeries: { date: DateOnly; temperatureC: number }[] = [];

  for (const log of dayLogs) {
    if (log.flow) flowCounts[log.flow] += 1;
    for (const symptom of log.symptoms) {
      symptomTally.set(symptom, (symptomTally.get(symptom) ?? 0) + 1);
    }
    if (log.temperatureC !== null) temperatureSeries.push({ date: log.date, temperatureC: log.temperatureC });
  }

  const average = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const variance =
    average === null ? null : values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;

  return {
    cycleLengths: lengths,
    averageCycleLengthDays: average === null ? null : Math.round(average * 10) / 10,
    shortestCycleDays: values.length ? Math.min(...values) : null,
    longestCycleDays: values.length ? Math.max(...values) : null,
    standardDeviationDays: variance === null ? null : Math.round(Math.sqrt(variance) * 10) / 10,
    flowCounts,
    symptomCounts: [...symptomTally.entries()]
      .map(([symptom, days]) => ({ symptom, days }))
      .sort((a, b) => b.days - a.days || a.symptom.localeCompare(b.symptom)),
    temperatureSeries: temperatureSeries.sort((a, b) => a.date.localeCompare(b.date)),
    loggedDays: dayLogs.length,
  };
}

/* -------------------------------------------------------------------------- */
/* overview                                                                   */
/* -------------------------------------------------------------------------- */

export interface PeriodOverviewOptions {
  from: DateOnly;
  to: DateOnly;
  asOf: DateOnly;
  zone: string;
}

/**
 * Everything the period screen needs, in one round trip.
 *
 * Cycles are returned in full (a lifetime is small and the prediction needs the
 * history); day logs and the contraception schedule are windowed, because those
 * are the parts that can grow without bound.
 */
export async function getPeriodOverview(userId: string, options: PeriodOverviewOptions): Promise<PeriodOverview> {
  const { from, to, asOf, zone } = options;
  const [settings, cycles, dayLogs, contraception, schedule, prediction] = await Promise.all([
    getPeriodSettings(userId),
    listPeriodCycles(userId),
    listPeriodDayLogs(userId, { from, to }),
    listContraceptionMethods(userId),
    listContraceptionSchedule(userId, from, to, zone),
    buildUserPrediction(userId, asOf, zone),
  ]);

  return { settings, cycles, dayLogs, contraception, schedule, prediction };
}
