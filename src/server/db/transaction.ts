/**
 * A single write transaction that both supported drivers can run.
 *
 * The import path is the only place in the app that needs one: a half-applied
 * import is worse than no import, so every list, task and provenance row must
 * land together or not at all.
 *
 * ## Why this is not just `db.transaction(async (tx) => …)`
 *
 * `better-sqlite3` refuses a transaction callback that returns a promise
 * ("Transaction function cannot return a promise"), and the repository functions
 * this module drives are all async. The SQLite handle is a single shared
 * connection, so an explicit `BEGIN IMMEDIATE` / `COMMIT` around the awaited
 * work is both correct and atomic. Postgres has no such restriction — and its
 * pool *does* need a transaction to pin one connection — so it uses Drizzle's
 * own transaction there.
 *
 * Nested use is not supported: nothing nests, and a savepoint layer would be
 * untested code.
 */
import { sql } from 'drizzle-orm';
import { currentDialect } from './dialect';
import { getDb, type Db } from './index';

/**
 * Runs `work` inside a transaction and rolls back on any thrown error.
 *
 * The callback receives the executor that repositories must be given, so queries
 * issued by them participate in the transaction on both dialects.
 */
export async function withTransaction<T>(work: (db: Db) => Promise<T>): Promise<T> {
  const db = getDb();

  if (currentDialect() === 'postgres') {
    // `db` is typed as the SQLite handle; the runtime object is the Postgres one
    // (see the cast in db/index.ts) and its transaction hands back a matching tx.
    return db.transaction(async (tx) => work(tx as unknown as Db));
  }

  db.run(sql`begin immediate`);
  try {
    const result = await work(db);
    db.run(sql`commit`);
    return result;
  } catch (error) {
    try {
      db.run(sql`rollback`);
    } catch {
      // The connection may already have unwound the transaction; the original
      // error is the one worth surfacing.
    }
    throw error;
  }
}
