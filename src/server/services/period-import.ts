/**
 * Applies a parsed period CSV.
 *
 * ## Safety
 *
 * The whole write runs inside one {@link withTransaction}, so a failure at row
 * 900 leaves the database exactly as it was. Parsing happens before this is
 * called, which is why a malformed file never reaches the database.
 *
 * ## Idempotency
 *
 * Every record has a natural key — a cycle by its start date, a day log by its
 * date, a method by (method, start date), a method day by (method, date). A
 * re-import therefore *updates* what is already there instead of duplicating it,
 * which is what makes re-importing a corrected export safe. This is the opposite
 * of the TickTick importer's skip-if-seen rule, and deliberately so: that
 * importer must not undo edits made after the first import, while a period CSV
 * is the user's own data being restored, so the file is authoritative.
 *
 * ## Method resolution
 *
 * A CSV cannot know our row ids, so a `contraception-day` row names its method
 * (and a date) and the method active on that date is used — the most recently
 * started one if two overlap. A row whose method was never defined is skipped
 * and reported rather than guessed at.
 */
import { and, eq } from 'drizzle-orm';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db';
import { contraceptionDays, contraceptionMethods, periodCycles, periodDayLogs } from '../db/schema';
import { newId } from '../crypto';
import { activeMethodOn } from '@/lib/period-math';
import type { PeriodCsvPlan } from '@/lib/period-csv';
import type { ContraceptionMethod, PeriodImportIssue, PeriodImportSummary } from '@/lib/period-types';
import type { DateOnly } from '@/lib/types';

export interface ApplyPeriodImportOptions {
  userId: string;
  plan: PeriodCsvPlan;
  /** Issues already found by the parser, carried into the summary. */
  parseIssues: PeriodImportIssue[];
  parseIssueCount: number;
  notes: string[];
}

const MAX_REPORTED_ISSUES = 100;

export async function applyPeriodImport(options: ApplyPeriodImportOptions): Promise<PeriodImportSummary> {
  const { userId, plan, parseIssues, parseIssueCount, notes } = options;

  return withTransaction(async (db) => {
    const issues: PeriodImportIssue[] = [...parseIssues];
    let issueCount = parseIssueCount;
    const report = (issue: PeriodImportIssue) => {
      issueCount += 1;
      if (issues.length < MAX_REPORTED_ISSUES) issues.push(issue);
    };

    const summary: PeriodImportSummary = {
      mode: 'commit',
      cyclesCreated: 0,
      cyclesUpdated: 0,
      daysCreated: 0,
      daysUpdated: 0,
      methodsCreated: 0,
      methodsUpdated: 0,
      contraceptionDaysCreated: 0,
      contraceptionDaysUpdated: 0,
      skipped: 0,
      issues,
      issueCount: 0,
      notes: [...notes],
    };

    await writeCycles(db, userId, plan, summary);
    await writeDays(db, userId, plan, summary);
    const methods = await writeMethods(db, userId, plan, summary);
    await writeContraceptionDays(db, userId, plan, methods, summary, report);

    summary.issueCount = issueCount;
    return summary;
  });
}

/* -------------------------------------------------------------------------- */
/* cycles                                                                     */
/* -------------------------------------------------------------------------- */

async function writeCycles(
  db: Db,
  userId: string,
  plan: PeriodCsvPlan,
  summary: PeriodImportSummary,
): Promise<void> {
  if (plan.cycles.length === 0) return;
  const existing = await db.select().from(periodCycles).where(eq(periodCycles.userId, userId));
  const byStart = new Map(existing.map((row) => [row.startDate, row]));
  const now = Date.now();

  for (const cycle of plan.cycles) {
    const row = byStart.get(cycle.startDate);
    if (row) {
      await db
        .update(periodCycles)
        .set({
          endDate: cycle.endDate ?? null,
          flowIntensity: cycle.flowIntensity ?? 'medium',
          notes: cycle.notes ?? null,
          updatedAt: now,
        })
        .where(and(eq(periodCycles.id, row.id), eq(periodCycles.userId, userId)));
      summary.cyclesUpdated += 1;
      continue;
    }
    await db.insert(periodCycles).values({
      id: newId(),
      userId,
      startDate: cycle.startDate,
      endDate: cycle.endDate ?? null,
      flowIntensity: cycle.flowIntensity ?? 'medium',
      notes: cycle.notes ?? null,
    });
    summary.cyclesCreated += 1;
  }
}

/* -------------------------------------------------------------------------- */
/* day logs                                                                   */
/* -------------------------------------------------------------------------- */

async function writeDays(
  db: Db,
  userId: string,
  plan: PeriodCsvPlan,
  summary: PeriodImportSummary,
): Promise<void> {
  if (plan.days.length === 0) return;
  const existing = await db.select().from(periodDayLogs).where(eq(periodDayLogs.userId, userId));
  const byDate = new Map(existing.map((row) => [row.date, row]));
  const now = Date.now();

  for (const day of plan.days) {
    const values = {
      flow: day.flow ?? null,
      symptoms: day.symptoms && day.symptoms.length ? day.symptoms : null,
      mood: day.mood && day.mood.length ? day.mood : null,
      temperatureC: day.temperatureC ?? null,
      lhTest: day.lhTest ?? null,
      mucus: day.mucus ?? null,
      intimacy: day.intimacy ?? false,
      ovulationPain: day.ovulationPain ?? false,
      weightKg: day.weightKg ?? null,
      notes: day.notes ?? null,
    };
    const row = byDate.get(day.date);
    if (row) {
      await db
        .update(periodDayLogs)
        .set({ ...values, updatedAt: now })
        .where(and(eq(periodDayLogs.id, row.id), eq(periodDayLogs.userId, userId)));
      summary.daysUpdated += 1;
      continue;
    }
    await db.insert(periodDayLogs).values({ id: newId(), userId, date: day.date, ...values });
    summary.daysCreated += 1;
  }
}

/* -------------------------------------------------------------------------- */
/* contraception                                                              */
/* -------------------------------------------------------------------------- */

interface KnownMethod {
  id: string;
  method: ContraceptionMethod;
  startDate: DateOnly;
  endDate: DateOnly | null;
}

/** Natural key for a method: the method plus the day it started. */
function methodKey(method: string, startDate: DateOnly): string {
  return `${method}|${startDate}`;
}

/**
 * Writes method history and returns every known method, so a subsequent
 * `contraception-day` row can resolve its method whether it was just created or
 * already existed.
 */
async function writeMethods(
  db: Db,
  userId: string,
  plan: PeriodCsvPlan,
  summary: PeriodImportSummary,
): Promise<KnownMethod[]> {
  const existing = await db.select().from(contraceptionMethods).where(eq(contraceptionMethods.userId, userId));
  const byKey = new Map(existing.map((row) => [methodKey(row.method, row.startDate), row.id]));
  const all: KnownMethod[] = existing.map((row) => ({
    id: row.id,
    method: row.method,
    startDate: row.startDate,
    endDate: row.endDate,
  }));
  const now = Date.now();

  for (const method of plan.methods) {
    const key = methodKey(method.method, method.startDate);
    const rowId = byKey.get(key);
    if (rowId) {
      await db
        .update(contraceptionMethods)
        .set({
          label: method.label ?? null,
          endDate: method.endDate ?? null,
          schedule: method.schedule ?? null,
          notes: method.notes ?? null,
          updatedAt: now,
        })
        .where(and(eq(contraceptionMethods.id, rowId), eq(contraceptionMethods.userId, userId)));
      summary.methodsUpdated += 1;
      const entry = all.find((item) => item.id === rowId);
      if (entry) entry.endDate = method.endDate ?? null;
      continue;
    }
    const id = newId();
    await db.insert(contraceptionMethods).values({
      id,
      userId,
      method: method.method,
      label: method.label ?? null,
      startDate: method.startDate,
      endDate: method.endDate ?? null,
      schedule: method.schedule ?? null,
      notes: method.notes ?? null,
    });
    byKey.set(key, id);
    all.push({ id, method: method.method, startDate: method.startDate, endDate: method.endDate ?? null });
    summary.methodsCreated += 1;
  }

  return all;
}

async function writeContraceptionDays(
  db: Db,
  userId: string,
  plan: PeriodCsvPlan,
  methods: KnownMethod[],
  summary: PeriodImportSummary,
  report: (issue: PeriodImportIssue) => void,
): Promise<void> {
  if (plan.contraceptionDays.length === 0) return;
  const existing = await db.select().from(contraceptionDays).where(eq(contraceptionDays.userId, userId));
  const byKey = new Map(existing.map((row) => [`${row.methodId}|${row.date}`, row.id]));

  // Resolve each row's method first: a name that matches nothing is a reported
  // skip, never a guess.
  const resolution = plan.contraceptionDays.map((day) => {
    const active = activeMethodOn(methods, day.date);
    return { day, methodId: active?.id ?? null };
  });

  for (const { day, methodId } of resolution) {
    if (!methodId) {
      summary.skipped += 1;
      report({
        row: day.row,
        column: 'method',
        value: day.method,
        message: `No “${day.method}” record covers ${day.date}; log the method first. Row skipped.`,
      });
      continue;
    }
    const key = `${methodId}|${day.date}`;
    const rowId = byKey.get(key);
    if (rowId) {
      await db
        .update(contraceptionDays)
        .set({ status: day.status, notes: day.notes ?? null, updatedAt: Date.now() })
        .where(and(eq(contraceptionDays.id, rowId), eq(contraceptionDays.userId, userId)));
      summary.contraceptionDaysUpdated += 1;
      continue;
    }
    await db.insert(contraceptionDays).values({
      id: newId(),
      userId,
      methodId,
      date: day.date,
      status: day.status,
      notes: day.notes ?? null,
    });
    summary.contraceptionDaysCreated += 1;
  }
}
