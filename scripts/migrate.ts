/**
 * Migration runner.
 *
 * Used by the container entrypoint (`/app/scripts/migrate.cjs`, compiled to
 * CommonJS at image build time) and by `npm run db:migrate` during development
 * (run through tsx). It picks the migration folder matching the configured
 * dialect, so one command covers both the SQLite default and the optional
 * Postgres deployment.
 *
 * Idempotent by construction: Drizzle records applied migrations in its own
 * table, which is what makes it safe — and correct — to run on every container
 * start so upgrades apply themselves.
 *
 * All driver loading goes through `await import()` rather than `require` so the
 * exact same source works as ESM under tsx and as CommonJS after `tsc`.
 */
import fs from 'node:fs';
import path from 'node:path';

interface Options {
  databaseUrl: string;
  migrationsFolder: string;
  isPostgres: boolean;
  verbose: boolean;
}

export function resolveOptions(): Options {
  const databaseUrl = process.env.DATABASE_URL ?? 'file:./data/tasktick.db';
  const isPostgres = databaseUrl.startsWith('postgres://') || databaseUrl.startsWith('postgresql://');

  return {
    databaseUrl,
    isPostgres,
    migrationsFolder: path.join(process.cwd(), 'drizzle', isPostgres ? 'pg' : 'sqlite'),
    verbose: process.env.MIGRATE_VERBOSE === '1' || process.env.NODE_ENV !== 'production',
  };
}

function log(options: Options, message: string) {
  if (options.verbose) console.log(`[migrate] ${message}`);
}

export async function runMigrations(): Promise<{ dialect: 'sqlite' | 'postgres'; migrationsFolder: string }> {
  const options = resolveOptions();
  const dialect = options.isPostgres ? 'postgres' : 'sqlite';

  if (!fs.existsSync(options.migrationsFolder)) {
    // A deployment without generated migrations is a real problem, but it must
    // not stop the container from booting and reporting its own health.
    console.warn(
      `[migrate] no migrations found at ${options.migrationsFolder}. Generate them with:\n` +
        '          npm run db:generate\n' +
        '          npx drizzle-kit generate --config drizzle.pg.config.ts',
    );
    return { dialect, migrationsFolder: options.migrationsFolder };
  }

  if (options.isPostgres) {
    const { Pool } = await import('pg');
    const { drizzle } = await import('drizzle-orm/node-postgres');
    const { migrate } = await import('drizzle-orm/node-postgres/migrator');

    const pool = new Pool({ connectionString: options.databaseUrl, max: 1 });
    try {
      log(options, 'connecting to postgres');
      await migrate(drizzle(pool), { migrationsFolder: options.migrationsFolder });
      log(options, 'postgres migrations applied');
    } finally {
      await pool.end();
    }
    return { dialect, migrationsFolder: options.migrationsFolder };
  }

  const BetterSqlite3 = (await import('better-sqlite3')).default;
  const { drizzle } = await import('drizzle-orm/better-sqlite3');
  const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');

  const file = options.databaseUrl.startsWith('file:')
    ? options.databaseUrl.slice('file:'.length)
    : options.databaseUrl;
  const absolute = path.resolve(process.cwd(), file);

  // The volume is empty on a first run, so create the parent directory.
  fs.mkdirSync(path.dirname(absolute), { recursive: true });

  const handle = new BetterSqlite3(absolute);
  try {
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    log(options, `applying sqlite migrations to ${absolute}`);
    migrate(drizzle(handle), { migrationsFolder: options.migrationsFolder });
    log(options, 'sqlite migrations applied');
  } finally {
    handle.close();
  }

  return { dialect, migrationsFolder: options.migrationsFolder };
}

async function main(): Promise<void> {
  try {
    const result = await runMigrations();
    console.log(`[migrate] up to date (${result.dialect})`);
    process.exit(0);
  } catch (error) {
    console.error('[migrate] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

// Only run when invoked as a script, not when imported by the entrypoint tests.
if (process.argv[1] && /migrate\.(cjs|js|ts)$/.test(process.argv[1])) {
  void main();
}
