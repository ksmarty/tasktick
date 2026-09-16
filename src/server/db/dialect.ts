import { getEnv } from '@/lib/env';

export type Dialect = 'sqlite' | 'postgres';

let cached: Dialect | null = null;

export function currentDialect(): Dialect {
  if (cached) return cached;
  const url = getEnv().DATABASE_URL;
  cached = url.startsWith('postgres://') || url.startsWith('postgresql://') ? 'postgres' : 'sqlite';
  return cached;
}

export function resetDialectCache(): void {
  cached = null;
}

/** Absolute on-disk path for the SQLite file, with `file:` stripped. */
export function sqliteFilePath(): string {
  const url = getEnv().DATABASE_URL;
  return url.startsWith('file:') ? url.slice('file:'.length) : url;
}
