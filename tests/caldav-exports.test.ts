/**
 * Contract test for the public surface: `src/server/sync/**` is written against
 * these exact names, so a rename here is a breaking change somewhere else.
 */
import { describe, expect, it } from 'vitest';
import * as caldav from '@/server/caldav';
import * as ical from '@/server/caldav/ical';
import {
  CalDavAuthError,
  CalDavError,
  CalDavNotFoundError,
  CalDavPreconditionFailedError,
  CalDavUnsupportedError,
  createCalDavClient,
} from '@/server/caldav';

describe('public surface', () => {
  it('exports the frozen barrel names', () => {
    expect(Object.keys(caldav).sort()).toEqual([
      'CalDavAuthError',
      'CalDavError',
      'CalDavNotFoundError',
      'CalDavPreconditionFailedError',
      'CalDavUnsupportedError',
      'createCalDavClient',
      'expandRecurrence',
      'isParsedEvent',
      'isParsedTodo',
      'newUid',
      'parseIcsObject',
      'serializeEvent',
      'serializeTodo',
    ]);
  });

  it('keeps the iCalendar codec to the five agreed entry points', () => {
    expect(Object.keys(ical).sort()).toEqual([
      'expandRecurrence',
      'newUid',
      'parseIcsObject',
      'serializeEvent',
      'serializeTodo',
    ]);
  });

  it('exposes a client with every CalDavClient method and a working error hierarchy', () => {
    const client = createCalDavClient(
      { serverUrl: 'https://caldav.example.com', username: 'u', password: 'p' },
      { fetchImpl: (() => Promise.reject(new Error('unused'))) as unknown as typeof fetch },
    );

    for (const method of [
      'testConnection',
      'listCalendars',
      'syncCollection',
      'listObjects',
      'getObject',
      'queryObjects',
      'getCtag',
      'putObject',
      'deleteObject',
      'createCalendar',
    ] as const) {
      expect(typeof client[method]).toBe('function');
    }

    const auth = new CalDavAuthError('nope', { status: 401, method: 'PROPFIND', url: 'https://x/' });
    expect(auth).toBeInstanceOf(CalDavError);
    expect(new CalDavNotFoundError('gone', { status: 404, method: 'GET', url: 'https://x/' })).toBeInstanceOf(CalDavError);
    expect(new CalDavUnsupportedError('no', { status: 405, method: 'PUT', url: 'https://x/' })).toBeInstanceOf(CalDavError);
    expect(
      new CalDavPreconditionFailedError('stale', { status: 412, method: 'PUT', url: 'https://x/' }),
    ).toBeInstanceOf(CalDavError);
    expect(auth).toMatchObject({ status: 401, method: 'PROPFIND', url: 'https://x/', retryable: false });
    expect(auth.name).toBe('CalDavAuthError');
  });
});
