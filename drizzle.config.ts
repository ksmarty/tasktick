import { defineConfig } from 'drizzle-kit';

/**
 * Migration generation for the default SQLite target.
 *   npm run db:generate
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/server/db/schema.sqlite.ts',
  out: './drizzle/sqlite',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'file:./data/tasktick.db',
  },
  strict: true,
  verbose: true,
});
