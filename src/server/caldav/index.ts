/**
 * CalDAV transport layer — the only module `src/server/sync/**` imports.
 *
 * `types.ts` is the frozen contract shared with the sync policy layer; every
 * name below is part of the public surface, so changes here are breaking.
 */
export { createCalDavClient } from './client';
export {
  CalDavAuthError,
  CalDavError,
  CalDavNotFoundError,
  CalDavPreconditionFailedError,
  CalDavUnsupportedError,
} from './errors';
export { parseIcsObject, serializeEvent, serializeTodo, expandRecurrence, newUid } from './ical';
export * from './types';
