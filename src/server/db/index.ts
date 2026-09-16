/**
 * Database handle.
 *
 * Both drivers are imported statically and the instance is built synchronously,
 * because better-auth's Drizzle adapter needs a live database object at module
 * evaluation time. Connection *establishment* is still lazy: better-sqlite3
 * opens the file on construction (cheap, and we want WAL configured up front)
 * while `pg.Pool` does not dial until the first query.
 *
 * The handle is created on first call rather than at import so that `next build`
 * never has the side effect of creating a database file.
 */
import BetterSqlite3 from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { camelCase } from './naming';
import { schema } from './schema';
import { currentDialect, sqliteFilePath } from './dialect';
import { getEnv } from '@/lib/env';

/**
 * The handle is typed as the SQLite database because that gives full query
 * inference throughout the repository layer. The Postgres instance is cast to
 * it: the two share a schema shape (enforced by `tests/schema-parity.test.ts`)
 * and repositories deliberately use only the builder subset that both drivers
 * implement identically. `tests/db-portability.test.ts` proves that claim by
 * replaying the same repository calls against both engines.
 */
export type Db = BetterSQLite3Database<typeof schema>;

let instance: Db | null = null;
let sqliteHandle: BetterSqlite3.Database | null = null;
let pgPool: Pool | null = null;

export function getDb(): Db {
  if (instance) return instance;

  if (currentDialect() === 'postgres') {
    pgPool = new Pool({
      connectionString: getEnv().DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'tasktick',
    });
    instance = drizzlePg(pgPool, { schema, casing: 'snake_case' }) as unknown as Db;
  } else {
    const file = path.resolve(process.cwd(), sqliteFilePath());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    sqliteHandle = new BetterSqlite3(file);
    // WAL lets readers run concurrently with the background sync writer.
    sqliteHandle.pragma('journal_mode = WAL');
    // NORMAL is the standard WAL durability/throughput tradeoff.
    sqliteHandle.pragma('synchronous = NORMAL');
    sqliteHandle.pragma('foreign_keys = ON');
    sqliteHandle.pragma('busy_timeout = 5000');
    // Cap the WAL so a long-running container cannot grow it without bound.
    sqliteHandle.pragma('wal_autocheckpoint = 1000');
    instance = drizzleSqlite(sqliteHandle, { schema }) as unknown as Db;
  }

  return instance;
}

/** Raw handle access for the migration bootstrap and health checks. */
export function getSqliteHandle(): BetterSqlite3.Database | null {
  return sqliteHandle;
}

export function getPgPool(): Pool | null {
  return pgPool;
}

export async function closeDb(): Promise<void> {
  sqliteHandle?.close();
  sqliteHandle = null;
  if (pgPool) {
    await pgPool.end();
    pgPool = null;
  }
  instance = null;
}

/** Cheap liveness probe used by `/healthz`. */
export async function pingDb(): Promise<boolean> {
  try {
    if (currentDialect() === 'postgres') {
      await getDb().select({ one: sql`1` }).from(schema.user).limit(0);
    } else {
      getSqliteHandle()?.prepare('select 1').get();
    }
    return true;
  } catch {
    return false;
  }
}
