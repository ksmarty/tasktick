/**
 * Applies a wearable import (Apple Health, RingConn export, or a CSV) to the
 * period day logs.
 *
 * ## The merge rule: fill what is empty, never overwrite what is not
 *
 * This is the decision the brief asked to be made explicit, so here it is in
 * full:
 *
 *  - **A field the user filled in by hand is authoritative.** If a day log already
 *    has a `temperatureC`, the file's value is *kept out* and counted as
 *    `temperatureKept`. Same for `weightKg`. A wearable gives a passively
 *    recorded number; a hand-entered basal temperature is a deliberate
 *    measurement taken under a method the user chose, and quietly replacing it
 *    would destroy the more trustworthy of the two. This is the same instinct as
 *    the TickTick importer's "never undo a later edit", applied to a field rather
 *    than a row.
 *  - **A field that is empty is filled.** That makes re-importing a longer export
 *    do exactly the right thing: every day already filled is left alone, and only
 *    new dates (or dates the user never recorded a temperature for) change. The
 *    operation is therefore idempotent — running it twice writes nothing the
 *    second time.
 *  - **Nothing else on the row is touched.** Not `flow`, not `symptoms`, not
 *    `mood`, not `notes`, not `lhTest`. A day log the user has written on is only
 *    ever *added to*, and only in a field that was empty.
 *  - **A day with no log at all is created** carrying only what the file had, so an
 *    import of a year of temperatures does not have to be preceded by hand-creating
 *    a year of day logs.
 *
 * The kept counts are returned rather than swallowed, so the card can say
 * "N days you had already recorded were left alone" — a merge rule the user
 * cannot see is indistinguishable from data loss.
 *
 * ## Atomicity
 *
 * The whole write is one {@link withTransaction}: a failure on the last day leaves
 * the database exactly as it was. Parsing happens before this is called, which is
 * why an unreadable file never reaches the database.
 *
 * ## Why no new columns
 *
 * The import reads sleep, resting heart rate and activity too, and deliberately
 * stores none of them: `period_day_logs` has a temperature and a weight because
 * those are what the cycle maths consumes. Adding columns for the rest would mean
 * a schema change in both dialects, two migrations, the meta snapshot and the
 * parity test — to hold numbers no feature reads. They are counted and reported in
 * the preview instead, so nothing is dropped silently.
 */
import { and, eq } from 'drizzle-orm';
import { newId } from '../crypto';
import { withTransaction } from '../db/transaction';
import type { Db } from '../db';
import { periodDayLogs } from '../db/schema';
import type { WearableImportPlan, WearableImportSummary } from '@/lib/ringconn';
import type { PeriodImportIssue } from '@/lib/period-types';

export interface ApplyWearableImportOptions {
  userId: string;
  plan: WearableImportPlan;
  /** Issues already found by the parser, carried into the summary. */
  parseIssues: PeriodImportIssue[];
  parseIssueCount: number;
  notes: string[];
}

export async function applyWearableImport(
  options: ApplyWearableImportOptions,
): Promise<WearableImportSummary> {
  const { userId, plan, parseIssues, parseIssueCount, notes } = options;

  return withTransaction(async (db) => {
    const summary: WearableImportSummary = {
      mode: 'commit',
      daysCreated: 0,
      daysUpdated: 0,
      daysUnchanged: 0,
      temperatureFilled: 0,
      temperatureKept: 0,
      weightFilled: 0,
      weightKept: 0,
      // The parser's issues are carried through; the writer adds none of its own,
      // because "a value was kept" is a note and not a row-level error.
      issues: [...parseIssues],
      issueCount: parseIssueCount,
      notes: [...notes],
    };

    const existing = await db.select().from(periodDayLogs).where(eq(periodDayLogs.userId, userId));
    const byDate = new Map(existing.map((row) => [row.date, row]));
    const now = Date.now();

    for (const day of plan.days) {
      const row = byDate.get(day.date);

      if (!row) {
        // A date with no log at all: create one carrying only what the file had.
        if (!day.temperature && day.weightKg === null) continue;
        await db.insert(periodDayLogs).values({
          id: newId(),
          userId,
          date: day.date,
          temperatureC: day.temperature?.celsius ?? null,
          weightKg: day.weightKg,
        });
        summary.daysCreated += 1;
        if (day.temperature) summary.temperatureFilled += 1;
        if (day.weightKg !== null) summary.weightFilled += 1;
        continue;
      }

      const patch: { temperatureC?: number; weightKg?: number; updatedAt: number } = { updatedAt: now };

      if (day.temperature) {
        if (row.temperatureC === null) {
          patch.temperatureC = day.temperature.celsius;
          summary.temperatureFilled += 1;
        } else {
          summary.temperatureKept += 1;
        }
      }

      if (day.weightKg !== null) {
        if (row.weightKg === null) {
          patch.weightKg = day.weightKg;
          summary.weightFilled += 1;
        } else {
          summary.weightKept += 1;
        }
      }

      if (patch.temperatureC === undefined && patch.weightKg === undefined) {
        summary.daysUnchanged += 1;
        continue;
      }

      await db
        .update(periodDayLogs)
        .set(patch)
        .where(and(eq(periodDayLogs.id, row.id), eq(periodDayLogs.userId, userId)));
      summary.daysUpdated += 1;
    }

    const kept = summary.temperatureKept + summary.weightKept;
    if (kept > 0) {
      // A note, not an issue: nothing went wrong, the user's own reading simply won.
      summary.notes.push(
        `${kept} ${kept === 1 ? 'value' : 'values'} you had already recorded ${kept === 1 ? 'was' : 'were'} left as ${kept === 1 ? 'it was' : 'they were'}; the file's value was not used.`,
      );
    }

    return summary;
  });
}
