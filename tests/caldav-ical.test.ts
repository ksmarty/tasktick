/**
 * iCalendar codec tests: parse → serialise → parse must be lossless for the
 * shapes the sync layer actually round-trips.
 */
import { describe, expect, it } from 'vitest';
import { parseIcsObject, newUid, serializeEvent, serializeTodo } from '@/server/caldav';
import type { ParsedEvent, ParsedTodo } from '@/server/caldav';

const ics = (lines: string[]): string => `${lines.join('\r\n')}\r\n`;

const CALENDAR_HEAD = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Apple Inc.//iOS 17.0//EN', 'CALSCALE:GREGORIAN'];
const CALENDAR_TAIL = ['END:VCALENDAR'];

/** A timed event with a TZID, an alarm, attendees and escaped text. */
const TIMED_EVENT = ics([
  ...CALENDAR_HEAD,
  'BEGIN:VEVENT',
  'UID:timed@example.com',
  'DTSTAMP:20240301T120000Z',
  'SEQUENCE:3',
  'DTSTART;TZID=America/New_York:20240309T090000',
  'DTEND;TZID=America/New_York:20240309T100000',
  'SUMMARY:Dentist\\, downtown',
  'DESCRIPTION:Line one\\nLine two\\; still description',
  'LOCATION:123 Main St',
  'URL:https://example.com/appt',
  'STATUS:CONFIRMED',
  'TRANSP:OPAQUE',
  'ORGANIZER;CN=Ada Lovelace:mailto:ada@example.com',
  'ATTENDEE;CN=Grace;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:grace@example.com',
  'CATEGORIES:Health,Personal',
  'BEGIN:VALARM',
  'ACTION:DISPLAY',
  'TRIGGER:-PT15M',
  'DESCRIPTION:Reminder',
  'END:VALARM',
  'END:VEVENT',
  ...CALENDAR_TAIL,
]);

const ALL_DAY_EVENT = ics([
  ...CALENDAR_HEAD,
  'BEGIN:VEVENT',
  'UID:allday@example.com',
  'DTSTAMP:20240301T120000Z',
  'DTSTART;VALUE=DATE:20240309',
  'DTEND;VALUE=DATE:20240310',
  'SUMMARY:Vacation',
  'END:VEVENT',
  ...CALENDAR_TAIL,
]);

const RECURRING_EVENT = ics([
  ...CALENDAR_HEAD,
  'BEGIN:VEVENT',
  'UID:weekly@example.com',
  'DTSTAMP:20240301T120000Z',
  'DTSTART;TZID=America/New_York:20240304T090000',
  'DTEND;TZID=America/New_York:20240304T093000',
  'RRULE:FREQ=WEEKLY;BYDAY=MO;COUNT=5',
  'EXDATE;TZID=America/New_York:20240318T090000',
  'RDATE;TZID=America/New_York:20240320T090000',
  'SUMMARY:Standup',
  'END:VEVENT',
  ...CALENDAR_TAIL,
]);

/** A parent task with a subtask, priority and due dates. */
const TASK_PAYLOAD = ics([
  ...CALENDAR_HEAD,
  'BEGIN:VTODO',
  'UID:parent@example.com',
  'DTSTAMP:20240301T120000Z',
  'SUMMARY:Plan the move',
  'DESCRIPTION:Book a van',
  'PRIORITY:1',
  'STATUS:NEEDS-ACTION',
  'DUE;VALUE=DATE:20240315',
  'PERCENT-COMPLETE:0',
  'END:VTODO',
  'BEGIN:VTODO',
  'UID:child@example.com',
  'DTSTAMP:20240301T120000Z',
  'SUMMARY:Pack the kitchen',
  'PRIORITY:5',
  'STATUS:IN-PROCESS',
  'DUE:20240314T170000Z',
  'RELATED-TO;RELTYPE=PARENT:parent@example.com',
  'END:VTODO',
  ...CALENDAR_TAIL,
]);

function firstEvent(payload: string): ParsedEvent {
  const { objects } = parseIcsObject(payload);
  const object = objects[0];
  if (!object || object.kind !== 'event') throw new Error('expected a VEVENT');
  return object;
}

function todoWithUid(payload: string, uid: string): ParsedTodo {
  const { objects } = parseIcsObject(payload);
  const object = objects.find((candidate) => candidate.kind === 'todo' && candidate.uid === uid);
  if (!object || object.kind !== 'todo') throw new Error(`expected VTODO ${uid}`);
  return object;
}

/** Raw octets per line, to prove RFC 5545 folding at 75 octets. */
function lineByteLengths(text: string): number[] {
  return text.split('\r\n').map((line) => new TextEncoder().encode(line).length);
}

/** Undoes RFC 5545 folding so long properties can be asserted as one line. */
function unfold(text: string): string {
  return text.replace(/\r\n /g, '');
}

describe('parseIcsObject', () => {
  it('reads calendar metadata and the timed event fields', () => {
    const { meta, objects } = parseIcsObject(TIMED_EVENT);

    expect(meta).toEqual({ prodId: '-//Apple Inc.//iOS 17.0//EN', name: null, timezone: null });
    expect(objects).toHaveLength(1);

    const { event, sequence, dtstampMs, lastModifiedMs } = firstEvent(TIMED_EVENT);
    expect(sequence).toBe(3);
    expect(dtstampMs).toBe(Date.UTC(2024, 2, 1, 12, 0, 0));
    expect(lastModifiedMs).toBeNull();
    expect(event.startMs).toBe(Date.UTC(2024, 2, 9, 14, 0, 0)); // 09:00 EST = 14:00Z
    expect(event.endMs).toBe(Date.UTC(2024, 2, 9, 15, 0, 0));
    expect(event.timezone).toBe('America/New_York');
    expect(event.isAllDay).toBe(false);
    expect(event.summary).toBe('Dentist, downtown');
    expect(event.description).toBe('Line one\nLine two; still description');
    expect(event.location).toBe('123 Main St');
    expect(event.organizer).toEqual({ name: 'Ada Lovelace', email: 'ada@example.com' });
    expect(event.attendees).toEqual([
      { email: 'grace@example.com', name: 'Grace', status: 'ACCEPTED', role: 'REQ-PARTICIPANT' },
    ]);
    expect(event.categories).toEqual(['Health', 'Personal']);
    expect(event.reminders).toEqual([15]);
    expect(event.status).toBe('confirmed');
    expect(event.transparency).toBe('opaque');
  });

  it('keeps all-day events floating: dates stay dates and carry no instant', () => {
    const { event } = firstEvent(ALL_DAY_EVENT);

    expect(event.startDate).toBe('2024-03-09');
    expect(event.endDate).toBe('2024-03-10');
    expect(event.isAllDay).toBe(true);
    expect('startMs' in event).toBe(false);
    expect('endMs' in event).toBe(false);
  });

  it('reads RRULE, EXDATE and RDATE in iCalendar lexical form', () => {
    const { event } = firstEvent(RECURRING_EVENT);

    // `ical.js` prints the rule in canonical clause order.
    expect(event.rrule).toBe('FREQ=WEEKLY;COUNT=5;BYDAY=MO');
    expect(event.exdates).toEqual(['20240318T090000']);
    expect(event.rdates).toEqual(['20240320T090000']);
  });

  it('reads a VTODO with priority, due date and a parent/subtask pair', () => {
    const { objects } = parseIcsObject(TASK_PAYLOAD);
    expect(objects).toHaveLength(2);

    const parent = todoWithUid(TASK_PAYLOAD, 'parent@example.com');
    expect(parent.task).toMatchObject({
      externalUid: 'parent@example.com',
      title: 'Plan the move',
      notes: 'Book a van',
      priority: 'high',
      status: 'todo',
      dueDate: '2024-03-15',
      isAllDay: true,
    });

    // Subtasks are their own resources; the codec must not lose the child.
    const child = todoWithUid(TASK_PAYLOAD, 'child@example.com');
    expect(child.task).toMatchObject({
      externalUid: 'child@example.com',
      title: 'Pack the kitchen',
      priority: 'medium',
      isAllDay: false,
    });
    expect(child.task.dueAtMs).toBe(Date.UTC(2024, 2, 14, 17, 0, 0));
  });

  it('rejects a payload without UID and unparseable text instead of guessing', () => {
    expect(() => parseIcsObject(ics([...CALENDAR_HEAD, 'BEGIN:VEVENT', 'SUMMARY:No uid', 'END:VEVENT', ...CALENDAR_TAIL]))).toThrow(
      /UID/,
    );
    expect(() => parseIcsObject('not an ics file at all')).toThrow(/iCalendar/i);
  });
});

describe('serializeEvent', () => {
  it('round-trips a timed event losslessly', () => {
    const { event } = firstEvent(TIMED_EVENT);
    const input = { ...event, uid: 'timed@example.com', remoteSequence: 3 };
    const payload = serializeEvent(input, { dtstamp: new Date('2024-03-01T12:00:00Z') });

    expect(payload).toContain('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n');
    expect(payload).toContain('PRODID:-//TaskTick//TaskTick CalDAV//EN');
    expect(serializeEvent(input, { prodId: '-//Apple Inc.//iOS 17.0//EN' })).toContain(
      'PRODID:-//Apple Inc.//iOS 17.0//EN',
    );
    expect(payload).toContain('UID:timed@example.com');
    expect(payload).toContain('DTSTAMP:20240301T120000Z');
    expect(payload).toContain('SEQUENCE:3');
    expect(serializeEvent(input, { sequence: 7 })).toContain('SEQUENCE:7');
    expect(payload).toContain('DTSTART;TZID=America/New_York:20240309T090000');
    expect(payload).toContain('DTEND;TZID=America/New_York:20240309T100000');
    expect(payload).toContain('SUMMARY:Dentist\\, downtown');
    expect(payload).toContain('DESCRIPTION:Line one\\nLine two\\; still description');
    expect(unfold(payload)).toContain(
      'ATTENDEE;CN=Grace;PARTSTAT=ACCEPTED;ROLE=REQ-PARTICIPANT:mailto:grace@example.com',
    );
    expect(payload).toContain('BEGIN:VALARM');
    expect(payload).toContain('TRIGGER:-PT15M');
    // CRLF everywhere, never a bare LF.
    expect(payload).not.toMatch(/[^\r]\n/);
    expect(payload.endsWith('END:VCALENDAR\r\n')).toBe(true);

    const reparsed = firstEvent(payload).event;
    expect(reparsed.startMs).toBe(event.startMs);
    expect(reparsed.endMs).toBe(event.endMs);
    expect(reparsed.timezone).toBe('America/New_York');
    expect(reparsed.summary).toBe(event.summary);
    expect(reparsed.description).toBe(event.description);
    expect(reparsed.attendees).toEqual(event.attendees);
    expect(reparsed.reminders).toEqual([15]);
  });

  it('round-trips an all-day event without shifting the date', () => {
    const { event } = firstEvent(ALL_DAY_EVENT);
    const payload = serializeEvent({ ...event, uid: 'allday@example.com' });

    expect(payload).toContain('DTSTART;VALUE=DATE:20240309');
    expect(payload).toContain('DTEND;VALUE=DATE:20240310');
    expect(payload).not.toContain('TZID');

    const reparsed = firstEvent(payload).event;
    expect(reparsed.startDate).toBe('2024-03-09');
    expect(reparsed.endDate).toBe('2024-03-10');
    expect(reparsed.isAllDay).toBe(true);
    expect('startMs' in reparsed).toBe(false);
  });

  it('defaults an all-day event length to one day', () => {
    const payload = serializeEvent({ uid: 'x@example.com', startDate: '2024-03-09', isAllDay: true });
    expect(payload).toContain('DTSTART;VALUE=DATE:20240309');
    expect(payload).toContain('DTEND;VALUE=DATE:20240310');
  });

  it('round-trips RRULE with EXDATE and RDATE, stably', () => {
    const { event } = firstEvent(RECURRING_EVENT);
    const options = { dtstamp: new Date('2024-03-01T12:00:00Z') };
    const payload = serializeEvent({ ...event, uid: 'weekly@example.com' }, options);

    // The rule survives; `ical.js` only normalises clause order.
    expect(payload).toContain('RRULE:FREQ=WEEKLY');
    expect(payload).toContain('BYDAY=MO');
    expect(payload).toContain('COUNT=5');
    expect(payload).toContain('EXDATE;TZID=America/New_York:20240318T090000');
    expect(payload).toContain('RDATE;TZID=America/New_York:20240320T090000');

    const reparsed = firstEvent(payload).event;
    expect(reparsed.exdates).toEqual(event.exdates);
    expect(reparsed.rdates).toEqual(event.rdates);
    // Second pass is byte-identical: the codec does not drift on re-serialisation.
    expect(serializeEvent({ ...reparsed, uid: 'weekly@example.com' }, options)).toBe(payload);
  });

  it('folds at 75 octets without splitting a multi-byte character', () => {
    const summary = 'Ünïcödé party 🎉 '.repeat(12).trim();
    const payload = serializeEvent(
      { uid: 'fold@example.com', summary, startMs: Date.UTC(2024, 2, 9, 14, 0, 0), endMs: Date.UTC(2024, 2, 9, 15, 0, 0), timezone: 'UTC' },
      { dtstamp: new Date('2024-03-01T12:00:00Z') },
    );

    for (const bytes of lineByteLengths(payload)) expect(bytes).toBeLessThanOrEqual(75);
    expect(payload).toMatch(/\r\n /); // a real continuation line exists
    expect(firstEvent(payload).event.summary).toBe(summary);
  });

  it('omits properties it has no value for instead of emitting empty lines', () => {
    const payload = serializeEvent(
      { uid: 'bare@example.com', summary: 'Only a summary', startMs: Date.UTC(2024, 2, 9, 14, 0, 0) },
      { dtstamp: new Date('2024-03-01T12:00:00Z') },
    );
    expect(payload).not.toContain('DESCRIPTION:');
    expect(payload).not.toContain('LOCATION:');
    expect(payload).not.toMatch(/:(\r\n)/); // nothing like `PROPERTY:` followed by EOL
  });
});

describe('serializeTodo', () => {
  it('maps status, priority, due date and completion onto VTODO properties', () => {
    const parent = todoWithUid(TASK_PAYLOAD, 'parent@example.com');
    const payload = serializeTodo({ ...parent.task, externalUid: 'parent@example.com' }, { dtstamp: new Date('2024-03-01T12:00:00Z') });

    expect(payload).toContain('BEGIN:VTODO');
    expect(payload).toContain('UID:parent@example.com');
    expect(payload).toContain('SUMMARY:Plan the move');
    expect(payload).toContain('DESCRIPTION:Book a van');
    expect(payload).toContain('STATUS:NEEDS-ACTION');
    expect(payload).toContain('PERCENT-COMPLETE:0');
    expect(payload).toContain('PRIORITY:1');
    expect(payload).toContain('DUE;VALUE=DATE:20240315');
    expect(payload).not.toContain('COMPLETED:');

    const reparsed = todoWithUid(payload, 'parent@example.com');
    expect(reparsed.task.priority).toBe('high');
    expect(reparsed.task.status).toBe('todo');
    expect(reparsed.task.dueDate).toBe('2024-03-15');
    expect(reparsed.task.title).toBe('Plan the move');
  });

  it('maps a completed task and a cancelled task onto the right VTODO status', () => {
    const completed = serializeTodo({
      externalUid: 'done@example.com',
      title: 'Ship it',
      status: 'completed',
      priority: 'medium',
      completedAtMs: Date.UTC(2024, 2, 10, 8, 30, 0),
      dueAtMs: Date.UTC(2024, 2, 9, 16, 0, 0),
      timezone: 'Europe/Berlin',
    });
    expect(completed).toContain('STATUS:COMPLETED');
    expect(completed).toContain('PERCENT-COMPLETE:100');
    expect(completed).toContain('PRIORITY:5');
    expect(completed).toContain('COMPLETED:20240310T083000Z');
    expect(completed).toContain('DUE;TZID=Europe/Berlin:20240309T170000');

    const cancelled = serializeTodo({ externalUid: 'no@example.com', title: 'Skip', status: 'wont_do', priority: 'low' });
    expect(cancelled).toContain('STATUS:CANCELLED');
    expect(cancelled).toContain('PRIORITY:9');

    const roundTripped = todoWithUid(completed, 'done@example.com');
    expect(roundTripped.task.status).toBe('completed');
    expect(roundTripped.task.priority).toBe('medium');
    expect(roundTripped.task.dueAtMs).toBe(Date.UTC(2024, 2, 9, 16, 0, 0));
    expect(roundTripped.task.completedAtMs).toBe(Date.UTC(2024, 2, 10, 8, 30, 0));
  });

  it('carries the recurrence rule and an empty title safely', () => {
    const payload = serializeTodo({ externalUid: 'r@example.com', title: '', recurrenceRule: 'FREQ=DAILY;INTERVAL=2' });
    expect(payload).toContain('RRULE:FREQ=DAILY;INTERVAL=2');
    expect(payload).not.toContain('SUMMARY:');
    expect(todoWithUid(payload, 'r@example.com').task.recurrenceRule).toBe('FREQ=DAILY;INTERVAL=2');
  });
});

describe('newUid', () => {
  it('generates unique UIDs with a stable domain suffix', () => {
    const a = newUid();
    const b = newUid();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9a-f-]{36}@tasktick$/);
    expect(newUid('example.com')).toMatch(/@example\.com$/);
    expect(newUid('@example.com')).toMatch(/@example\.com$/);
  });
});
