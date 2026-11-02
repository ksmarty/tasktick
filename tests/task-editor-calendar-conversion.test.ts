/**
 * A task's calendar is a move, not a field.
 *
 * Reported: creating something with a calendar destination from the tasks screen
 * landed in the calendar, but every screen drew it as a task and every editor
 * opened it as one — because what was written was a *task* carrying a
 * `calendarId`. The quick-add half of that is `planQuickAddEvent` (tested in
 * `tasks-quick-add.test.ts`); the editing half is the Calendar dropdown in the
 * task editor, which let a task be filed into a collection and stay a task
 * everywhere. It is gone: the editor's only mention of calendars is a "Convert to
 * event" row that MOVES the record onto one, and the choice of destination lives
 * in its own dialog.
 *
 * These are source assertions rather than renders — the alternative is mounting a
 * Radix dialog with the bootstrap resource, a fake store and a fake clock to
 * prove which calendars a list shows, while the mapping and the refusals are
 * covered against a real database in `task-to-event.test.ts`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { selectableCalendars } from '@/components/calendar/selectable';
import type { Calendar } from '@/lib/types';

const source = (relative: string): string => readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

const EDITOR = source('src/components/tasks/TaskEditorSheet.tsx');
const DIALOG = source('src/components/tasks/ConvertToEventDialog.tsx');
const COMBOBOX = source('src/components/calendar/CalendarCombobox.tsx');
const ROUTE = source('src/app/api/tasks/[id]/convert/route.ts');

/** A calendar record with the fields these rules read, and sane defaults. */
function calendar(overrides: Partial<Calendar> & { id: string }): Calendar {
  return {
    userId: 'u1',
    name: overrides.id,
    description: null,
    color: 'blue',
    timezone: 'UTC',
    provider: 'local',
    caldavAccountId: null,
    remoteHref: null,
    remoteCtag: null,
    remoteSyncToken: null,
    supportsVtodo: true,
    isVisible: true,
    showInTasks: false,
    isDefault: false,
    readOnly: false,
    dedupeEvents: false,
    sortOrder: 'a',
    lastSyncedAtMs: null,
    lastSyncError: null,
    colorOverride: null,
    defaultReminders: null,
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  } as Calendar;
}

describe('the task editor no longer files a task into a calendar', () => {
  it('has no calendar combobox at all', () => {
    expect(EDITOR).not.toContain('CalendarCombobox');
    /* And the value it used to write is not patched from this editor either. */
    expect(EDITOR).not.toContain('calendarId: next');
  });

  it('offers "Convert to event" at the bottom, above the destructive row', () => {
    const convert = EDITOR.indexOf('>Convert to event</span>');
    const remove = EDITOR.indexOf('Delete task');
    expect(convert).toBeGreaterThan(0);
    /* Both live past the subtasks: they act on the whole record, not a value. */
    expect(convert).toBeGreaterThan(EDITOR.indexOf('<SubTaskList'));
    expect(remove).toBeGreaterThan(convert);
  });

  it('opens the chooser, and hosts it so it outlives the row', () => {
    expect(EDITOR).toContain('setConvertOpen(true)');
    expect(EDITOR).toContain('<ConvertToEventDialog');
    /* A dialog of its own portals to `body`: without this the editor under it
     * dismissed itself on the first press inside the chooser. */
    expect(EDITOR).toContain('if (picker || confirmOpen || convertOpen || inSubMenu) event.preventDefault();');
  });

  it('closes on a successful conversion, because the task it edited is gone', () => {
    expect(DIALOG).toContain('onConverted?.(result);');
    expect(EDITOR).toMatch(/onConverted=\{\(\) => \{[\s\S]*?onSaved\?\.\(\);/);
  });
});

describe('the conversion dialog offers event destinations, not task ones', () => {
  it('lists every writable, visible calendar', () => {
    expect(DIALOG).toContain('selectableCalendars(calendars)');
    /*
     * The VTODO filter belonged to the field that filed tasks. An event needs no
     * VTODO support at all, and an event-only calendar is a perfectly good
     * destination for the record a task is becoming.
     */
    expect(DIALOG).not.toContain('calendarsThatHoldTasks');
  });

  it('posts the one thing the task cannot supply: where the event goes', () => {
    expect(DIALOG).toContain('api.post<ConversionResult>(`/api/tasks/${task.id}/convert`, { calendarId })');
    expect(ROUTE).toContain('convertTaskToEvent(user.id, params.id, body.calendarId, zone)');
    /* One call, so a half cannot land on its own: the route writes nothing itself. */
    expect(ROUTE).not.toContain('createEvent');
    expect(ROUTE).not.toContain('deleteTask');
  });

  it('refreshes both the task reads and the calendar reads on success', () => {
    expect(DIALOG).toContain("...TASK_WRITE_PREFIXES, ...affectsFor('POST', '/api/events')");
    expect(DIALOG).toContain('await invalidate(CONVERSION_PREFIXES);');
  });

  it('stops the two cases that would lose something, in place', () => {
    expect(DIALOG).toContain('Converting it would delete them, so it cannot be converted.');
    expect(DIALOG).toContain('Give the task a due date first: an event needs to start somewhere.');
    expect(DIALOG).toContain('Boolean(blocker)');
  });
});

describe('the combobox is the event editor’s again', () => {
  it('takes the plain writable-and-visible rule, with no task flag left over', () => {
    expect(COMBOBOX).not.toContain('holdsTasks');
    expect(COMBOBOX).toContain('selectableCalendars(calendars)');
    /* The trigger still names the current calendar even when it is unfiltered. */
    expect(COMBOBOX).toContain('const selected = calendars.find((calendar) => calendar.id === value)');
  });

  it('selectableCalendars keeps writable, visible calendars and nothing else', () => {
    const calendars = [
      calendar({ id: 'local' }),
      calendar({ id: 'events-only', supportsVtodo: false }),
      calendar({ id: 'read-only', readOnly: true }),
      calendar({ id: 'hidden', isVisible: false }),
    ];
    expect(selectableCalendars(calendars).map((entry) => entry.id)).toEqual(['local', 'events-only']);
  });
});
