/**
 * iCalendar codec: `VEVENT ⇄ CalendarEvent`, `VTODO ⇄ Task`, plus RRULE
 * expansion.
 *
 * Rules this file deliberately follows:
 *   - **No Node built-ins.** Nothing here imports `fs`/`node:*`, so the codec
 *     stays unit-testable and tree-shakeable.
 *   - **All-day is floating.** `DTSTART;VALUE=DATE` becomes a `YYYY-MM-DD`
 *     `startDate` plus `isAllDay: true` and *no* `startMs`, so a server's
 *     timezone can never shift the day. Timed values get `startMs`/`endMs` and
 *     the IANA `timezone` from `TZID` (UTC when the value ends in `Z` or carries
 *     no `TZID` at all).
 *   - **Dates and EXDATE/RDATE values are handled in iCalendar lexical form**
 *     (`YYYYMMDD`, `YYYYMMDDTHHMMSS`, `YYYYMMDDTHHMMSSZ`) — that is what servers
 *     send, it round-trips losslessly, and it gives {@link expandRecurrence} an
 *     unambiguous input.
 *   - **Never mutate a `Date` in place**; every helper returns a new value.
 *   - Partial input produces partial output: a property is written only when the
 *     codec has a value for it, and no line is ever emitted empty.
 */
import ICAL from 'ical.js';
import { DateTime, IANAZone } from 'luxon';
import type { Attendee, CalendarEvent, DateOnly, EventStatus, EventTransparency, Task, TaskStatus } from '@/lib/types';
import { ICAL_TO_PRIORITY, PRIORITY_TO_ICAL } from '@/lib/types';
import type {
  IcsCalendarMeta,
  ParsedObject,
  RecurrenceExpansionInput,
  RecurrenceOccurrence,
  SerializeOptions,
} from './types';

const DEFAULT_PRODID = '-//TaskTick//TaskTick CalDAV//EN';
const DEFAULT_MAX_OCCURRENCES = 1000;

type ICalTime = InstanceType<typeof ICAL.Time>;
type ICalComponent = InstanceType<typeof ICAL.Component>;
type ICalProperty = InstanceType<typeof ICAL.Property>;
type ICalRecur = InstanceType<typeof ICAL.Recur>;

/* -------------------------------------------------------------------------- */
/* parsing                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Parses one VCALENDAR payload. A payload may legitimately carry several
 * components (a VEVENT plus VTODO siblings, overridden instances, …), so the
 * codec returns every component it understands.
 */
export function parseIcsObject(ics: string): { meta: IcsCalendarMeta; objects: ParsedObject[] } {
  let root: ICalComponent;
  try {
    root = new ICAL.Component(ICAL.parse(ics));
  } catch (cause) {
    throw new Error(`invalid iCalendar payload: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  const calendar = root.name.toLowerCase() === 'vcalendar' ? root : root.getFirstSubcomponent('vcalendar') ?? root;
  const meta: IcsCalendarMeta = {
    prodId: textProperty(calendar, 'prodid'),
    name: textProperty(calendar, 'x-wr-calname'),
    timezone: normalizeTzid(textProperty(calendar, 'x-wr-timezone')),
  };

  const objects: ParsedObject[] = [];
  for (const component of calendar.getAllSubcomponents()) {
    const name = component.name.toLowerCase();
    if (name === 'vevent') objects.push(parseEvent(component));
    else if (name === 'vtodo') objects.push(parseTodo(component));
  }
  return { meta, objects };
}

function parseEvent(component: ICalComponent): ParsedObject {
  const start = readDateProperty(component, 'dtstart');
  const end = readDateProperty(component, 'dtend');
  const duration = readDurationMs(component, 'duration');
  const event: Partial<CalendarEvent> = { uid: requireUid(component, 'VEVENT') };

  if (start?.isDate) {
    event.startDate = start.date;
    event.isAllDay = true;
  } else if (start?.ms != null) {
    event.startMs = start.ms;
    event.isAllDay = false;
    event.timezone = start.zone ?? 'UTC';
  }

  if (end?.isDate) event.endDate = end.date;
  else if (end?.ms != null) event.endMs = end.ms;
  else if (duration !== null && start?.ms != null) event.endMs = start.ms + duration;
  else if (start?.isDate && start.date) event.endDate = addDays(start.date, 1);

  assign(event, 'summary', textProperty(component, 'summary'));
  assign(event, 'description', textProperty(component, 'description'));
  assign(event, 'location', textProperty(component, 'location'));
  assign(event, 'url', textProperty(component, 'url'));
  assign(event, 'color', textProperty(component, 'color'));
  assign(event, 'status', readEventStatus(component));
  assign(event, 'transparency', readTransparency(component));
  assign(event, 'exdates', collectDateList(component, 'exdate'));
  assign(event, 'rdates', collectDateList(component, 'rdate'));
  assign(event, 'organizer', parseOrganizer(component.getFirstProperty('organizer')));
  assign(event, 'attendees', parseAttendees(component));
  assign(event, 'categories', parseCategories(component));
  assign(event, 'reminders', parseReminders(component));
  assign(event, 'rrule', readRule(component));
  assign(event, 'recurrenceId', readRecurrenceId(component));

  return { kind: 'event', ...objectBase(component), event };
}

function parseTodo(component: ICalComponent): ParsedObject {
  const start = readDateProperty(component, 'dtstart');
  const due = readDateProperty(component, 'due');
  const task: Partial<Task> = { externalUid: requireUid(component, 'VTODO') };

  assign(task, 'title', textProperty(component, 'summary'));
  assign(task, 'notes', textProperty(component, 'description'));
  assign(task, 'url', textProperty(component, 'url'));

  if (start?.isDate) {
    task.startDate = start.date;
    task.isAllDay = true;
  } else if (start?.ms != null) {
    task.startAtMs = start.ms;
    task.isAllDay = false;
    task.timezone = start.zone ?? 'UTC';
  }

  if (due?.isDate) {
    task.dueDate = due.date;
    if (task.isAllDay === undefined) task.isAllDay = true;
  } else if (due?.ms != null) {
    task.dueAtMs = due.ms;
    if (task.isAllDay === undefined) task.isAllDay = false;
    task.timezone = task.timezone ?? due.zone ?? 'UTC';
  }

  assign(task, 'status', readTaskStatus(component));
  assign(task, 'priority', readPriority(component));
  assign(task, 'completedAtMs', readDateProperty(component, 'completed')?.ms ?? null);
  assign(task, 'recurrenceRule', readRule(component));
  assign(task, 'recurrenceId', readRecurrenceId(component));

  return { kind: 'todo', ...objectBase(component), task };
}

function objectBase(component: ICalComponent): {
  uid: string;
  sequence: number | null;
  lastModifiedMs: number | null;
  dtstampMs: number | null;
} {
  return {
    uid: requireUid(component, component.name.toUpperCase()),
    sequence: numberProperty(component, 'sequence'),
    lastModifiedMs: readDateProperty(component, 'last-modified')?.ms ?? null,
    dtstampMs: readDateProperty(component, 'dtstamp')?.ms ?? null,
  };
}

function requireUid(component: ICalComponent, kind: string): string {
  const uid = textProperty(component, 'uid');
  if (!uid) throw new Error(`${kind} without UID — a component without a stable identity cannot be synced`);
  return uid;
}

interface ParsedDateValue {
  /** Epoch ms of a date-time value; `null` for a `VALUE=DATE` value. */
  ms: number | null;
  /** `YYYY-MM-DD` for a `VALUE=DATE` value; `null` otherwise. */
  date: DateOnly | null;
  isDate: boolean;
  /** IANA zone used to resolve the wall clock; `null` for a date. */
  zone: string | null;
  /** iCalendar lexical form, e.g. `20240309T090000Z`. */
  lexical: string;
}

function readDateProperty(component: ICalComponent, name: string): ParsedDateValue | null {
  const property = component.getFirstProperty(name);
  if (!property) return null;
  const value = property.getFirstValue();
  if (!isIcalTime(value)) return null;
  return convertTime(value, paramString(property, 'tzid'));
}

/** Duration in ms, or `null` when the property is absent or not a duration. */
function readDurationMs(component: ICalComponent, name: string): number | null {
  const value = component.getFirstPropertyValue(name) as { toSeconds?: () => number } | null;
  if (!value || typeof value.toSeconds !== 'function') return null;
  const seconds = value.toSeconds();
  return Number.isFinite(seconds) ? Math.round(seconds * 1000) : null;
}

function readRule(component: ICalComponent): string | null {
  const value = component.getFirstPropertyValue('rrule') as { toString(): string } | null;
  if (!value) return null;
  // `ical.js` prints the rule in canonical order (`FREQ=WEEKLY;COUNT=5;BYDAY=MO`);
  // the rule itself is preserved exactly, only its clause order is normalised.
  const rule = String(value).trim();
  return rule === '' ? null : rule;
}

function readRecurrenceId(component: ICalComponent): string | null {
  return readDateProperty(component, 'recurrence-id')?.lexical ?? null;
}

/** Converts an `ICAL.Time` without mutating it; DATE stays floating. */
function convertTime(time: ICalTime, tzid: string | null): ParsedDateValue {
  if (time.isDate) {
    const date = formatDateParts(time.year, time.month, time.day);
    return { ms: null, date, isDate: true, zone: null, lexical: date.replace(/-/g, '') };
  }
  const parts = { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second };
  if (timeZoneId(time) === 'UTC') {
    return {
      ms: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
      date: null,
      isDate: false,
      zone: 'UTC',
      lexical: `${formatDateTimeParts(parts)}Z`,
    };
  }
  const zone = resolveZone(tzid);
  const local = DateTime.fromObject(parts, { zone });
  return {
    ms: local.isValid
      ? local.toMillis()
      : Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second),
    date: null,
    isDate: false,
    zone,
    lexical: formatDateTimeParts(parts),
  };
}

/** `ICAL.Time` reports `UTC` in its zone id only for values that ended in `Z`. */
function timeZoneId(time: ICalTime): string {
  const zone = (time as unknown as { zone?: { tzid?: string } }).zone;
  return zone?.tzid ?? 'floating';
}

function collectDateList(component: ICalComponent, name: string): string[] | null {
  const values: string[] = [];
  for (const property of component.getAllProperties(name)) {
    const tzid = paramString(property, 'tzid');
    for (const value of property.getValues()) {
      if (isIcalTime(value)) values.push(convertTime(value, tzid).lexical);
    }
  }
  return values.length > 0 ? values : null;
}

function parseOrganizer(property: ICalProperty | null): { name?: string; email?: string } | null {
  if (!property) return null;
  const raw = property.getFirstValue();
  const email = typeof raw === 'string' ? stripMailto(raw) : '';
  const name = paramString(property, 'cn') ?? undefined;
  if (!email && !name) return null;
  return { ...(name ? { name } : {}), ...(email ? { email } : {}) };
}

function parseAttendees(component: ICalComponent): Attendee[] | null {
  const attendees: Attendee[] = [];
  for (const property of component.getAllProperties('attendee')) {
    const raw = property.getFirstValue();
    const email = typeof raw === 'string' ? stripMailto(raw) : '';
    if (!email) continue;
    const attendee: Attendee = { email };
    const name = paramString(property, 'cn');
    const status = paramString(property, 'partstat');
    const role = paramString(property, 'role');
    if (name) attendee.name = name;
    if (status) attendee.status = status.toUpperCase();
    if (role) attendee.role = role.toUpperCase();
    attendees.push(attendee);
  }
  return attendees.length > 0 ? attendees : null;
}

function parseCategories(component: ICalComponent): string[] | null {
  const categories: string[] = [];
  for (const property of component.getAllProperties('categories')) {
    for (const value of property.getValues()) {
      const text = typeof value === 'string' ? value.trim() : '';
      if (text) categories.push(text);
    }
  }
  return categories.length > 0 ? categories : null;
}

/** Only relative `TRIGGER`s can be expressed as "minutes before"; others are skipped. */
function parseReminders(component: ICalComponent): number[] | null {
  const minutes: number[] = [];
  for (const alarm of component.getAllSubcomponents('valarm')) {
    const trigger = alarm.getFirstPropertyValue('trigger') as { toSeconds?: () => number } | null;
    if (!trigger || typeof trigger.toSeconds !== 'function') continue;
    const seconds = trigger.toSeconds();
    if (!Number.isFinite(seconds) || seconds > 0) continue;
    minutes.push(Math.round(-seconds / 60));
  }
  return minutes.length > 0 ? [...new Set(minutes)].sort((a, b) => a - b) : null;
}

function readEventStatus(component: ICalComponent): EventStatus | null {
  const status = textProperty(component, 'status')?.toUpperCase();
  if (status === 'CONFIRMED' || status === 'TENTATIVE' || status === 'CANCELLED') return status.toLowerCase() as EventStatus;
  return null;
}

function readTaskStatus(component: ICalComponent): TaskStatus | null {
  const status = textProperty(component, 'status')?.toUpperCase();
  if (status === 'COMPLETED') return 'completed';
  if (status === 'CANCELLED') return 'wont_do';
  if (status === 'NEEDS-ACTION' || status === 'IN-PROCESS') return 'todo';
  return null;
}

function readPriority(component: ICalComponent): Task['priority'] | null {
  const priority = numberProperty(component, 'priority');
  if (priority === null) return null;
  return ICAL_TO_PRIORITY[priority] ?? null;
}

function readTransparency(component: ICalComponent): EventTransparency | null {
  const transparency = textProperty(component, 'transp')?.toUpperCase();
  if (transparency === 'TRANSPARENT' || transparency === 'OPAQUE') return transparency.toLowerCase() as EventTransparency;
  return null;
}

function textProperty(component: ICalComponent, name: string): string | null {
  const value = component.getFirstPropertyValue(name);
  if (value === null || value === undefined) return null;
  const text = String(value);
  return text === '' ? null : text;
}

function numberProperty(component: ICalComponent, name: string): number | null {
  const value = component.getFirstPropertyValue(name);
  const parsed = typeof value === 'number' ? value : Number(value);
  return value === null || value === undefined || !Number.isFinite(parsed) ? null : parsed;
}

function isIcalTime(value: unknown): value is ICalTime {
  return value instanceof ICAL.Time;
}

/** `getParameter` is typed `string | any[]` (repeating parameters); flatten it. */
function paramString(property: ICalProperty, name: string): string | null {
  const value = property.getParameter(name);
  if (value === null || value === undefined) return null;
  const text = Array.isArray(value) ? String(value[0] ?? '') : String(value);
  return text.trim() === '' ? null : text;
}

function stripMailto(value: string): string {
  return value.replace(/^mailto:/i, '').trim();
}

/* -------------------------------------------------------------------------- */
/* serialising                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Serialises a `VEVENT`. Only properties this codec understands are written and
 * an absent value never becomes an empty property line.
 */
export function serializeEvent(event: Partial<CalendarEvent> & { uid: string }, options?: SerializeOptions): string {
  const lines: string[] = [
    `UID:${escapeIcsText(event.uid)}`,
    `DTSTAMP:${formatUtc(options?.dtstamp ?? new Date())}`,
    `SEQUENCE:${options?.sequence ?? event.remoteSequence ?? 0}`,
  ];

  const isAllDay = event.isAllDay === true || (event.startDate != null && event.startMs == null);
  if (isAllDay) {
    if (event.startDate) {
      lines.push(renderProperty({ name: 'DTSTART', params: { VALUE: 'DATE' }, value: compactDate(event.startDate) }));
      lines.push(
        renderProperty({
          name: 'DTEND',
          params: { VALUE: 'DATE' },
          value: compactDate(event.endDate ?? addDays(event.startDate, 1)),
        }),
      );
    }
  } else if (event.startMs != null) {
    const zone = resolveZone(event.timezone);
    lines.push(renderProperty(dateTimeProperty('DTSTART', event.startMs, zone)));
    if (event.endMs != null && event.endMs > event.startMs) {
      lines.push(renderProperty(dateTimeProperty('DTEND', event.endMs, zone)));
    }
  }

  const recurrenceId = normalizeRecurrenceId(event.recurrenceId);
  if (recurrenceId) lines.push(recurrenceIdProperty(recurrenceId));

  pushText(lines, 'SUMMARY', event.summary);
  pushText(lines, 'DESCRIPTION', event.description);
  pushText(lines, 'LOCATION', event.location);
  pushText(lines, 'URL', event.url);
  pushText(lines, 'COLOR', event.color);

  const rule = normalizeRule(event.rrule);
  if (rule) lines.push(`RRULE:${rule}`);
  pushDateList(lines, 'EXDATE', event.exdates, event.timezone);
  pushDateList(lines, 'RDATE', event.rdates, event.timezone);

  if (event.status) lines.push(`STATUS:${event.status.toUpperCase()}`);
  if (event.transparency) lines.push(`TRANSP:${event.transparency.toUpperCase()}`);
  if (event.categories && event.categories.length > 0) {
    lines.push(`CATEGORIES:${event.categories.map(escapeIcsText).join(',')}`);
  }
  if (event.organizer?.email || event.organizer?.name) {
    const params: Record<string, string> = {};
    if (event.organizer.name) params.CN = event.organizer.name;
    const value = event.organizer.email ? `mailto:${event.organizer.email}` : '';
    lines.push(renderProperty({ name: 'ORGANIZER', params, value }));
  }
  for (const attendee of event.attendees ?? []) {
    if (!attendee.email) continue;
    const params: Record<string, string> = {};
    if (attendee.name) params.CN = attendee.name;
    if (attendee.status) params.PARTSTAT = attendee.status.toUpperCase();
    if (attendee.role) params.ROLE = attendee.role.toUpperCase();
    lines.push(renderProperty({ name: 'ATTENDEE', params, value: `mailto:${attendee.email}` }));
  }
  for (const minutes of event.reminders ?? []) lines.push(...valarmLines(minutes));

  return wrapCalendar('VEVENT', lines, options);
}

/** Serialises a `VTODO`, mapping app status/priority onto RFC 5545 equivalents. */
export function serializeTodo(task: Partial<Task> & { externalUid: string }, options?: SerializeOptions): string {
  const lines: string[] = [
    `UID:${escapeIcsText(task.externalUid)}`,
    `DTSTAMP:${formatUtc(options?.dtstamp ?? new Date())}`,
    `SEQUENCE:${options?.sequence ?? 0}`,
  ];
  pushText(lines, 'SUMMARY', task.title);

  const zone = resolveZone(task.timezone);
  if (task.startDate) {
    lines.push(renderProperty({ name: 'DTSTART', params: { VALUE: 'DATE' }, value: compactDate(task.startDate) }));
  } else if (task.startAtMs != null) {
    lines.push(renderProperty(dateTimeProperty('DTSTART', task.startAtMs, zone)));
  }
  if (task.dueDate) {
    lines.push(renderProperty({ name: 'DUE', params: { VALUE: 'DATE' }, value: compactDate(task.dueDate) }));
  } else if (task.dueAtMs != null) {
    lines.push(renderProperty(dateTimeProperty('DUE', task.dueAtMs, zone)));
  }

  pushText(lines, 'DESCRIPTION', task.notes);
  pushText(lines, 'URL', task.url);

  const status: TaskStatus = task.status ?? 'todo';
  lines.push(`STATUS:${todoStatus(status)}`);
  lines.push(`PERCENT-COMPLETE:${status === 'completed' ? 100 : 0}`);
  lines.push(`PRIORITY:${PRIORITY_TO_ICAL[task.priority ?? 'none']}`);
  if (status === 'completed') {
    lines.push(`COMPLETED:${formatUtc(options?.dtstamp ?? new Date(task.completedAtMs ?? Date.now()))}`);
  }

  const recurrenceId = normalizeRecurrenceId(task.recurrenceId);
  if (recurrenceId) lines.push(recurrenceIdProperty(recurrenceId));
  const rule = normalizeRule(task.recurrenceRule);
  if (rule) lines.push(`RRULE:${rule}`);

  return wrapCalendar('VTODO', lines, options);
}

/** `NEEDS-ACTION | COMPLETED | CANCELLED` — the VTODO spelling of a task status. */
function todoStatus(status: TaskStatus): string {
  if (status === 'completed') return 'COMPLETED';
  if (status === 'wont_do') return 'CANCELLED';
  return 'NEEDS-ACTION';
}

function wrapCalendar(component: string, lines: string[], options?: SerializeOptions): string {
  const all = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${options?.prodId ?? DEFAULT_PRODID}`,
    'CALSCALE:GREGORIAN',
    `BEGIN:${component}`,
    ...lines,
    `END:${component}`,
    'END:VCALENDAR',
  ];
  return `${all.map(foldLine).join('\r\n')}\r\n`;
}

interface IcsProperty {
  name: string;
  params?: Record<string, string>;
  value: string;
}

function renderProperty(property: IcsProperty): string {
  const params = Object.entries(property.params ?? {})
    .filter(([, value]) => value !== '')
    .map(([key, value]) => `;${key}=${/[:;,]/.test(value) ? `"${value}"` : value}`)
    .join('');
  return `${property.name}${params}:${property.value}`;
}

function pushText(lines: string[], name: string, value: string | null | undefined): void {
  if (value === null || value === undefined) return;
  const text = escapeIcsText(value);
  if (text === '') return; // never emit an empty property
  lines.push(`${name}:${text}`);
}

function dateTimeProperty(name: string, ms: number, zone: string): IcsProperty {
  if (zone === 'UTC') return { name, value: formatUtc(new Date(ms)) };
  const local = DateTime.fromMillis(ms, { zone });
  if (!local.isValid) return { name, value: formatUtc(new Date(ms)) };
  return {
    name,
    params: { TZID: zone },
    value: formatDateTimeParts({
      year: local.year,
      month: local.month,
      day: local.day,
      hour: local.hour,
      minute: local.minute,
      second: local.second,
    }),
  };
}

function recurrenceIdProperty(lexical: string): string {
  if (/^\d{8}$/.test(lexical)) return renderProperty({ name: 'RECURRENCE-ID', params: { VALUE: 'DATE' }, value: lexical });
  return `RECURRENCE-ID:${lexical}`;
}

/** Groups EXDATE/RDATE values by value type, emitting one property per group. */
function pushDateList(
  lines: string[],
  name: string,
  values: string[] | null | undefined,
  timezone: string | null | undefined,
): void {
  if (!values || values.length === 0) return;
  const groups = new Map<string, { params: Record<string, string>; values: string[] }>();
  for (const raw of values) {
    const parsed = parseCompactValue(raw);
    if (!parsed) continue;
    let key: string;
    let params: Record<string, string>;
    if (parsed.isDate) {
      key = 'DATE';
      params = { VALUE: 'DATE' };
    } else if (parsed.utc) {
      key = 'UTC';
      params = {};
    } else {
      const zone = resolveZone(timezone);
      key = zone;
      params = zone === 'UTC' ? {} : { TZID: zone };
    }
    const group = groups.get(key) ?? { params, values: [] };
    group.values.push(parsed.lexical);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    lines.push(renderProperty({ name, params: group.params, value: group.values.join(',') }));
  }
}

function valarmLines(minutes: number): string[] {
  const trigger = minutes <= 0 ? 'PT0M' : `-PT${minutes}M`;
  return ['BEGIN:VALARM', 'ACTION:DISPLAY', `TRIGGER:${trigger}`, 'DESCRIPTION:Reminder', 'END:VALARM'];
}

function normalizeRecurrenceId(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().replace(/[-:]/g, '');
  return /^\d{8}(T\d{6}Z?)?$/.test(trimmed) ? trimmed : null;
}

function normalizeRule(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const stripped = rule.replace(/^RRULE:/i, '').trim();
  return stripped === '' ? null : stripped;
}

/** RFC 5545 §3.1: fold at 75 octets, never splitting a multi-byte character. */
function foldLine(line: string): string {
  const chunks: string[] = [];
  let current = '';
  let bytes = 0;
  for (const char of line) {
    const size = utf8Length(char);
    const limit = chunks.length === 0 ? 75 : 74; // continuation lines start with one space
    if (bytes + size > limit) {
      chunks.push(current);
      current = '';
      bytes = 0;
    }
    current += char;
    bytes += size;
  }
  chunks.push(current);
  return chunks.join('\r\n ');
}

function utf8Length(char: string): number {
  const code = char.codePointAt(0) ?? 0;
  if (code <= 0x7f) return 1;
  if (code <= 0x7ff) return 2;
  if (code <= 0xffff) return 3;
  return 4;
}

/** `\`, `,`, `;` and newlines are escaped; other control characters are dropped. */
function escapeIcsText(value: string): string {
  return (
    value
      .replace(/\\/g, '\\\\')
      .replace(/;/g, '\\;')
      .replace(/,/g, '\\,')
      .replace(/\r\n|\r|\n/g, '\\n')
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  );
}

/* -------------------------------------------------------------------------- */
/* recurrence                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Expands an RRULE (plus RDATEs minus EXDATEs) into concrete instants.
 *
 * Iteration happens on the *floating wall clock* of `timezone`: a weekly 09:00
 * America/New_York series keeps starting at 09:00 after the DST switch, while
 * the returned instants differ by 167/169 hours. `UNTIL`, which RFC 5545
 * mandates in UTC, is converted into the same wall clock before iterating.
 */
export function expandRecurrence(input: RecurrenceExpansionInput): RecurrenceOccurrence[] {
  const zone = resolveZone(input.timezone);
  const durationMs =
    typeof input.durationMs === 'number' && Number.isFinite(input.durationMs) ? input.durationMs : null;
  const max =
    input.maxOccurrences && input.maxOccurrences > 0 ? Math.floor(input.maxOccurrences) : DEFAULT_MAX_OCCURRENCES;
  const rangeStart = input.range.startMs;
  const rangeEnd = input.range.endMs;
  const startMs = input.startMs;
  const starts: number[] = [];

  const localStart = DateTime.fromMillis(startMs, { zone });
  const rule = normalizeRule(input.rrule);

  if (!rule) {
    starts.push(startMs);
  } else {
    const recur = createRecur(rule);
    if (!recur) {
      starts.push(startMs); // unparseable rule: the series is just its DTSTART
    } else {
      alignUntilToZone(recur, zone);
      const iterator = recur.iterator(toIcalTime(localStart));
      const guard = max * 4 + 1000; // safety valve for FREQ=SECONDLY-style rules
      for (let i = 0; i < guard; i += 1) {
        const next = iterator.next();
        if (!next || !isIcalTime(next)) break;
        const occurrenceMs = fromIcalTime(next, zone);
        if (occurrenceMs === null) break;
        if (occurrenceMs >= rangeEnd) break;
        if (occurrenceMs >= rangeStart) starts.push(occurrenceMs);
        if (starts.length >= max) break;
      }
    }
  }

  for (const raw of input.rdates ?? []) {
    const parsed = parseCompactValue(raw);
    if (!parsed) continue;
    const ms = parsed.isDate
      ? localInstant(parsed.year, parsed.month, parsed.day, localStart.hour, localStart.minute, localStart.second, zone)
      : parsed.utc
        ? parsed.ms
        : localInstant(parsed.year, parsed.month, parsed.day, parsed.hour, parsed.minute, parsed.second, zone);
    if (ms !== null) starts.push(ms);
  }

  const excludedWall = new Set<string>();
  const excludedDays = new Set<string>();
  for (const raw of input.exdates ?? []) {
    const parsed = parseCompactValue(raw);
    if (!parsed) continue;
    if (parsed.isDate) {
      excludedDays.add(formatDateParts(parsed.year, parsed.month, parsed.day));
    } else if (parsed.utc) {
      excludedWall.add(wallClockKey(parsed.ms, zone));
    } else {
      excludedWall.add(parsed.lexical);
    }
  }

  const seen = new Set<number>();
  const occurrences: RecurrenceOccurrence[] = [];
  for (const occurrenceMs of [...starts].sort((a, b) => a - b)) {
    if (occurrenceMs < rangeStart || occurrenceMs >= rangeEnd) continue;
    if (seen.has(occurrenceMs)) continue;
    if (excludedWall.has(wallClockKey(occurrenceMs, zone))) continue;
    if (excludedDays.has(dayKey(occurrenceMs, zone))) continue;
    seen.add(occurrenceMs);
    occurrences.push({ startMs: occurrenceMs, endMs: durationMs === null ? null : occurrenceMs + durationMs });
    if (occurrences.length >= max) break;
  }
  return occurrences;
}

function createRecur(rule: string): ICalRecur | null {
  try {
    return ICAL.Recur.fromString(rule);
  } catch {
    return null;
  }
}

/** RFC 5545 says `UNTIL` is UTC; compare it as wall clock in the series' zone. */
function alignUntilToZone(recur: ICalRecur, zone: string): void {
  const recurWithUntil = recur as unknown as { until?: ICalTime | null };
  const until = recurWithUntil.until;
  if (!until || until.isDate || zone === 'UTC' || timeZoneId(until) !== 'UTC') return;
  const instant = Date.UTC(until.year, until.month - 1, until.day, until.hour, until.minute, until.second);
  recurWithUntil.until = toIcalTime(DateTime.fromMillis(instant, { zone }));
}

function toIcalTime(value: DateTime): ICalTime {
  return ICAL.Time.fromData({
    year: value.year,
    month: value.month,
    day: value.day,
    hour: value.hour,
    minute: value.minute,
    second: value.second,
    isDate: false,
  });
}

function fromIcalTime(time: ICalTime, zone: string): number | null {
  const local = DateTime.fromObject(
    { year: time.year, month: time.month, day: time.day, hour: time.hour, minute: time.minute, second: time.second },
    { zone },
  );
  return local.isValid ? local.toMillis() : null;
}

function localInstant(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  zone: string,
): number | null {
  const local = DateTime.fromObject({ year, month, day, hour, minute, second }, { zone });
  if (local.isValid) return local.toMillis();
  const utc = DateTime.fromObject({ year, month, day, hour, minute, second }, { zone: 'utc' });
  return utc.isValid ? utc.toMillis() : null;
}

interface CompactValue {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  isDate: boolean;
  utc: boolean;
  /** Normalised iCalendar lexical form. */
  lexical: string;
  /** Epoch ms of the instant when the value is absolute. */
  ms: number;
}

/**
 * Accepts the compact iCalendar forms (`20240309`, `20240309T090000`,
 * `20240309T140000Z`), the same with dashes/colons, and — as a last resort —
 * anything `Date.parse` understands.
 */
function parseCompactValue(raw: string): CompactValue | null {
  const compact = raw.trim().replace(/[-:]/g, '');
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/.exec(compact);
  if (match) {
    const [, year, month, day, hour, minute, second, zulu] = match;
    const parts = {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour ?? 0),
      minute: Number(minute ?? 0),
      second: Number(second ?? 0),
      isDate: hour === undefined,
      utc: zulu === 'Z',
    };
    const lexical = parts.isDate
      ? `${match[1]}${match[2]}${match[3]}`
      : `${match[1]}${match[2]}${match[3]}T${match[4]}${match[5]}${match[6]}${parts.utc ? 'Z' : ''}`;
    return { ...parts, lexical, ms: Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) };
  }
  const parsed = Date.parse(raw);
  if (!Number.isFinite(parsed)) return null;
  const dt = DateTime.fromMillis(parsed, { zone: 'utc' });
  return {
    year: dt.year,
    month: dt.month,
    day: dt.day,
    hour: dt.hour,
    minute: dt.minute,
    second: dt.second,
    isDate: false,
    utc: true,
    lexical: `${formatDateTimeParts(dt)}Z`,
    ms: parsed,
  };
}

/* -------------------------------------------------------------------------- */
/* shared helpers                                                             */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` in the given zone — never derived from a shifted `Date`. */
function dayKey(ms: number, zone: string): string {
  const local = DateTime.fromMillis(ms, { zone });
  return formatDateParts(local.year, local.month, local.day);
}

/** `YYYYMMDDTHHMMSS` wall clock in `zone` — the key EXDATE matching uses. */
function wallClockKey(ms: number, zone: string): string {
  return formatDateTimeParts(DateTime.fromMillis(ms, { zone }));
}

/** Valid IANA zone name, or `UTC` when the input is missing or unknown. */
function resolveZone(timezone: string | null | undefined): string {
  if (!timezone) return 'UTC';
  const candidate = normalizeTzid(timezone);
  return candidate && IANAZone.isValidZone(candidate) ? candidate : 'UTC';
}

/** `"America/New_York"` → `America/New_York`; path-style vendor TZIDs lose their prefix. */
function normalizeTzid(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^"|"$/g, '');
  if (trimmed === '') return null;
  const final = trimmed.startsWith('/') ? (trimmed.split('/').pop() ?? trimmed) : trimmed;
  return final === '' ? null : final;
}

function assign<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null | undefined): void {
  if (value !== null && value !== undefined) target[key] = value;
}

function pad(value: number, length: number): string {
  return String(Math.abs(value)).padStart(length, '0');
}

function formatDateParts(year: number, month: number, day: number): DateOnly {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function formatDateTimeParts(parts: {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}): string {
  return `${pad(parts.year, 4)}${pad(parts.month, 2)}${pad(parts.day, 2)}T${pad(parts.hour, 2)}${pad(parts.minute, 2)}${pad(parts.second, 2)}`;
}

function formatUtc(date: Date): string {
  return `${formatDateTimeParts(DateTime.fromJSDate(date, { zone: 'utc' }))}Z`;
}

/** `YYYY-MM-DD` → `YYYYMMDD`; an already compact value is left alone. */
function compactDate(date: DateOnly): string {
  return date.replace(/-/g, '');
}

function addDays(date: DateOnly, days: number): DateOnly {
  const dt = DateTime.fromISO(date, { zone: 'utc' });
  if (!dt.isValid) return date;
  return dt.plus({ days }).toFormat('yyyy-MM-dd');
}

/** RFC 4122 v4, falling back to `getRandomValues` then `Math.random`. */
export function newUid(domain = 'tasktick'): string {
  const cryptoApi = globalThis.crypto;
  let random: string;
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    random = cryptoApi.randomUUID();
  } else {
    const bytes = new Uint8Array(16);
    if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') cryptoApi.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
    random = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  return `${random}@${domain.replace(/^@/, '')}`;
}
