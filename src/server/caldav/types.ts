/**
 * Public contract of the CalDAV protocol layer.
 *
 * Two independent implementation units compile against this file:
 *   1. `src/server/caldav/**`  — HTTP + XML + iCalendar codec (transport)
 *   2. `src/server/sync/**`    — diff/merge/orchestration (policy)
 *
 * Keeping the boundary here is what lets the merge heuristics be unit-tested
 * against an in-memory fake without a live server.
 */
import type { CalendarEvent, Task } from '@/lib/types';

export interface CalDavCredentials {
  /** Base URL the user typed, e.g. `https://caldav.icloud.com`. */
  serverUrl: string;
  username: string;
  password: string;
}

export interface RemoteCalendar {
  /** Absolute collection URL, e.g. `https://host/1234/calendars/home/`. */
  href: string;
  displayName: string;
  color: string | null;
  description: string | null;
  /** Advertised `supported-calendar-component-set`, e.g. `['VEVENT','VTODO']`. */
  supportedComponents: string[];
  readOnly: boolean;
  timezone: string | null;
  /** Collection tag — changes if and only if something inside changed. */
  ctag: string | null;
  /** RFC 6578 sync token; `null` when the server does not support delta sync. */
  syncToken: string | null;
}

export interface RemoteObject {
  href: string;
  etag: string | null;
  /** Raw iCalendar text. */
  data: string;
}

export interface SyncCollectionDelta {
  /** Token to persist and pass next time. */
  syncToken: string | null;
  /** Objects created or modified since the token, including their bodies. */
  changed: RemoteObject[];
  /** Absolute hrefs removed since the token. */
  deleted: string[];
  /**
   * True when the server signalled `507 Insufficient Storage` / a truncated
   * result set, meaning the caller must fall back to a full enumeration.
   */
  truncated: boolean;
}

export interface PrincipalInfo {
  principalUrl: string;
  calendarHomeUrl: string;
  displayName: string | null;
}

export interface PutOptions {
  /** Optimistic locking: send `If-Match`. Omit for a create. */
  etag?: string | null;
  /** Send `If-None-Match: *` so a create fails if the object already exists. */
  ifNoneMatch?: boolean;
}

export interface PutResult {
  href: string;
  etag: string | null;
}

export interface CalDavClient {
  /** Resolves `.well-known`, the principal and the calendar home. Throws on auth failure. */
  testConnection(): Promise<PrincipalInfo>;
  listCalendars(): Promise<RemoteCalendar[]>;
  /** RFC 6578 REPORT. Servers without support should be detected here. */
  syncCollection(href: string, syncToken: string | null): Promise<SyncCollectionDelta>;
  /** Full PROPFIND + calendar-query fallback for servers lacking sync-collection. */
  listObjects(href: string): Promise<RemoteObject[]>;
  /** `null` when the object is gone (404). */
  getObject(href: string): Promise<RemoteObject | null>;
  /** Time-bounded `calendar-query` REPORT; used for the first sync of huge calendars. */
  queryObjects(href: string, range: { start: Date; end: Date }): Promise<RemoteObject[]>;
  getCtag(href: string): Promise<string | null>;
  putObject(href: string, ics: string, options?: PutOptions): Promise<PutResult>;
  deleteObject(href: string, etag?: string | null): Promise<void>;
  /** MKCALENDAR; used by "create a new remote calendar" in Settings. */
  createCalendar(href: string, displayName: string, components: string[], color?: string | null): Promise<void>;
}

/** Injected so tests (and the scheduler) can supply a deterministic clock. */
export interface Clock {
  now(): number;
}

/* -------------------------------------------------------------------------- */
/* iCalendar codec                                                            */
/* -------------------------------------------------------------------------- */

export interface ParsedObjectBase {
  uid: string;
  sequence: number | null;
  /** iCalendar LAST-MODIFIED / DTSTAMP, as epoch ms when parseable. */
  lastModifiedMs: number | null;
  /** iCalendar DTSTAMP, as epoch ms when parseable. */
  dtstampMs: number | null;
}

/**
 * Partial because a remote VCALENDAR legitimately omits most fields. Only `uid`
 * is guaranteed; everything else is `undefined` when absent remotely, which the
 * merge layer treats as "no opinion" rather than "set to null".
 */
export interface ParsedEvent extends ParsedObjectBase {
  kind: 'event';
  event: Partial<CalendarEvent>;
}

export interface ParsedTodo extends ParsedObjectBase {
  kind: 'todo';
  task: Partial<Task>;
}

export type ParsedObject = ParsedEvent | ParsedTodo;

export interface IcsCalendarMeta {
  /** `PRODID` of the payload that produced this object — used for diagnostics. */
  prodId: string | null;
  /** Calendar-level `X-WR-CALNAME`. */
  name: string | null;
  /** Calendar-level `X-WR-TIMEZONE`. */
  timezone: string | null;
}

/** One VCALENDAR may carry several components; the codec returns them all. */
export function isParsedEvent(o: ParsedObject): o is ParsedEvent {
  return o.kind === 'event';
}

export function isParsedTodo(o: ParsedObject): o is ParsedTodo {
  return o.kind === 'todo';
}

/**
 * Options accepted by both client implementations. `fetchImpl` is what makes
 * the whole CalDAV layer testable without a network.
 */
export interface CalDavClientOptions {
  /** Only for self-signed certs on a trusted LAN. Mirrors CALDAV_ALLOW_INSECURE_TLS. */
  allowInsecureTls?: boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  userAgent?: string;
  clock?: Clock;
}

/**
 * A single recurrence expansion request. `rrule` is a bare RRULE body such as
 * `FREQ=WEEKLY;BYDAY=MO`, not a full `RRULE:` line.
 */
export interface RecurrenceExpansionInput {
  rrule: string | null;
  /** Start of the first occurrence, epoch ms. */
  startMs: number;
  /** Duration applied to every generated occurrence. */
  durationMs?: number | null;
  timezone: string;
  exdates?: string[] | null;
  rdates?: string[] | null;
  /** Window to expand within (half-open). */
  range: { startMs: number; endMs: number };
  /** Safety valve against pathological rules such as `FREQ=SECONDLY`. */
  maxOccurrences?: number;
}

export interface RecurrenceOccurrence {
  startMs: number;
  endMs: number | null;
}

export interface SerializeOptions {
  prodId?: string;
  /** Overrides the emitted `SEQUENCE`. */
  sequence?: number;
  /** Emitted as `DTSTAMP`. Defaults to now. */
  dtstamp?: Date;
}
