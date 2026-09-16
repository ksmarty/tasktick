/**
 * Identifier casing helpers.
 *
 * The Drizzle schemas spell every column out explicitly in snake_case, so this
 * module exists purely for the few places where we must derive a name
 * dynamically (Postgres `casing` option, dynamic sort keys, CSV export headers)
 * and must not guess wrong.
 */

export function snakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase();
}

export function camelCase(input: string): string {
  return input.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase());
}

/** Maps a whitelist of API sort keys onto real SQL columns, rejecting anything else. */
export function resolveSortColumn<T extends string>(
  requested: string | null | undefined,
  allowed: readonly T[],
  fallback: T,
): T {
  if (!requested) return fallback;
  return (allowed as readonly string[]).includes(requested) ? (requested as T) : fallback;
}
