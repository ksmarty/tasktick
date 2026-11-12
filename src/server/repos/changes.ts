/**
 * A cheap fingerprint of everything one user's data looks like right now.
 *
 * The client cannot see an API call it did not make. An automation that marks a
 * task complete, a phone that adds an event, a CalDAV push that lands on the
 * server: all of them change rows underneath an open page that has no reason to
 * refetch. Polling the *data* to find out would be a full bootstrap every few
 * seconds; polling this is six small aggregates, and all the client needs is
 * "did anything move at all".
 *
 * So the answer is one opaque string, and equality is the whole contract. It is
 * deliberately not a version number the client could reason about: any change to
 * how it is computed would be a breaking change to that reasoning, and nothing
 * outside this file needs to know what the pieces are.
 *
 * The pieces are per table: how many rows, the newest `updatedAt`, and the newest
 * `deletedAtMs` where the table has one. Rows catch an insert and a hard delete,
 * `updatedAt` catches an edit (and a soft delete, which writes it too), and the
 * tombstone column catches a delete that removed the newest row. `count(*)` is
 * cast to text because Postgres returns it as a string and SQLite as a number —
 * the token must not change shape between the two dialects.
 */
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { calendarEvents, habitEntries, habits, lists, tags, tasks } from '../db/schema';

/** Six aggregates, run in parallel: one round trip each, no joins. */
export async function changeToken(userId: string): Promise<string> {
  const db = getDb();

  const [taskRow] = await db
    .select({
      rows: sql<string>`cast(count(*) as text)`,
      touched: sql<number | null>`max(${tasks.updatedAt})`,
      removed: sql<number | null>`max(${tasks.deletedAtMs})`,
    })
    .from(tasks)
    .where(eq(tasks.userId, userId));

  const [eventRow] = await db
    .select({
      rows: sql<string>`cast(count(*) as text)`,
      touched: sql<number | null>`max(${calendarEvents.updatedAt})`,
    })
    .from(calendarEvents)
    .where(eq(calendarEvents.userId, userId));

  const [habitRow] = await db
    .select({
      rows: sql<string>`cast(count(*) as text)`,
      touched: sql<number | null>`max(${habits.updatedAt})`,
      removed: sql<number | null>`max(${habits.deletedAtMs})`,
    })
    .from(habits)
    .where(eq(habits.userId, userId));

  /*
   * A check-in is the example the feature was asked for: an automation marks a
   * habit done and the open page should show it. An entry has no tombstone —
   * un-checking deletes the row — so its count carries the change.
   */
  const [entryRow] = await db
    .select({
      rows: sql<string>`cast(count(*) as text)`,
      touched: sql<number | null>`max(${habitEntries.updatedAt})`,
    })
    .from(habitEntries)
    .where(eq(habitEntries.userId, userId));

  const [listRow] = await db
    .select({
      rows: sql<string>`cast(count(*) as text)`,
      touched: sql<number | null>`max(${lists.updatedAt})`,
    })
    .from(lists)
    .where(eq(lists.userId, userId));

  const [tagRow] = await db
    .select({
      rows: sql<string>`cast(count(*) as text)`,
      touched: sql<number | null>`max(${tags.updatedAt})`,
    })
    .from(tags)
    .where(eq(tags.userId, userId));

  const part = (row?: { rows: string; touched: number | null; removed?: number | null }) =>
    `${row?.rows ?? '0'}.${row?.touched ?? 0}.${row?.removed ?? 0}`;

  return [part(taskRow), part(eventRow), part(habitRow), part(entryRow), part(listRow), part(tagRow)].join('|');
}
