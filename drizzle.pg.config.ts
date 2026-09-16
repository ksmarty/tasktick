import { defineConfig } from 'drizzle-kit';

/**
 * Migration generation for the optional Postgres target.
 *   npx drizzle-kit generate --config drizzle.pg.config.ts
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema.pg.ts',
  out: './drizzle/pg',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://tasktick:tasktick@localhost:5432/tasktick',
  },
  strict: true,
  verbose: true,
});
