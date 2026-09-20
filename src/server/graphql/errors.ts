/**
 * Typed GraphQL errors.
 *
 * A public API must say *what* went wrong, and a machine must be able to branch
 * on it without parsing prose. Every error raised by the resolvers therefore
 * carries a stable `extensions.code` (the same codes the REST layer already uses
 * where they overlap) so a client can distinguish an expired token from a
 * validation failure from a missing row.
 *
 * The HTTP status is decided in the route from the code on the *first* error:
 * `UNAUTHENTICATED` -> 401, `FORBIDDEN` -> 403, `BAD_USER_INPUT` -> 422,
 * anything else -> 200 with the error in the GraphQL envelope. A 500 is never
 * used for a condition the caller can act on.
 */
import { GraphQLError } from 'graphql';

export type GraphQLCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_USER_INPUT'
  | 'CONFLICT'
  | 'QUERY_TOO_DEEP'
  | 'INTERNAL';

export function gqlError(message: string, code: GraphQLCode, extra?: Record<string, unknown>): GraphQLError {
  return new GraphQLError(message, { extensions: { code, ...extra } });
}

export const unauthenticated = (message = 'A valid API token is required.') => gqlError(message, 'UNAUTHENTICATED');
export const forbidden = (message = 'You do not have access to that.') => gqlError(message, 'FORBIDDEN');
export const notFound = (message = 'Not found.') => gqlError(message, 'NOT_FOUND');
export const conflict = (message: string) => gqlError(message, 'CONFLICT');
export const badInput = (message: string, issues?: unknown) =>
  gqlError(message, 'BAD_USER_INPUT', issues === undefined ? undefined : { issues });

/**
 * Maps a repository error whose `message` is a known sentinel to a typed GraphQL
 * error, and rethrows anything else unchanged.
 *
 * The repositories signal "not found" by throwing `Error('not-found')` because
 * they predate this API. Translating at the boundary keeps the sentinels out of
 * the public surface and means a new sentinel is a compile-time-visible change
 * here rather than a leaked 500.
 */
export function fromRepoError(error: unknown, messages: Record<string, string> = {}): never {
  const sentinel = error instanceof Error ? error.message : '';
  if (sentinel in messages) {
    const mapped = messages[sentinel];
    if (sentinel === 'not-found') throw notFound(mapped);
    if (sentinel === 'read-only') throw forbidden(mapped);
    if (sentinel === 'exists') throw conflict(mapped);
    throw badInput(mapped);
  }
  throw error;
}
