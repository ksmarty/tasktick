/**
 * Which calendars a *task* may be filed into.
 *
 * Reported: creating something with a calendar destination from the tasks screen
 * landed in the calendar, but every screen drew it as a task and every editor
 * opened it as one. Two separate faults produced that, and both are pinned here:
 *
 * 1. the quick-add wrote a TASK carrying a `calendarId` instead of an event
 *    (`planQuickAddEvent` is the fix, tested in `tasks-quick-add.test.ts`), and
 * 2. the task editor offered EVERY calendar as a destination, including ones that
 *    cannot hold a task at all (`supportsVtodo` false — an event-only collection,
 *    an iCal subscription that only publishes VEVENTs).
 *
 * A calendar is an event's home. A collection holds tasks only when it accepts
 * VTODOs, so offering the others is the code telling the user something the
 * calendar will not do.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calendarsThatHoldTasks, selectableCalendars } from '@/components/calendar/selectable';
import type { Calendar } from '@/lib/types';

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

describe('calendarsThatHoldTasks', () => {
  it('keeps a writable collection that accepts tasks', () => {
    const calendars = [calendar({ id: 'local' })];
    expect(calendarsThatHoldTasks(calendars).map((c) => c.id)).toEqual(['local']);
  });

  it('drops a writable calendar that only accepts events', () => {
    // An event-only collection: files an event fine, has no notion of a task.
    const calendars = [calendar({ id: 'events-only', supportsVtodo: false })];
    expect(calendarsThatHoldTasks(calendars)).toEqual([]);
  });

  it('still drops read-only and hidden collections, which are not destinations at all', () => {
    const calendars = [
      calendar({ id: 'ok' }),
      calendar({ id: 'read-only', readOnly: true }),
      calendar({ id: 'hidden', isVisible: false }),
    ];
    expect(calendarsThatHoldTasks(calendars).map((c) => c.id)).toEqual(['ok']);
  });

  it('leaves the event destinations untouched — an event needs no VTODO support', () => {
    const calendars = [calendar({ id: 'events-only', supportsVtodo: false })];
    expect(selectableCalendars(calendars).map((c) => c.id)).toEqual(['events-only']);
  });
});

describe('the task editor offers only those calendars', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  const EDITOR = read('src/components/tasks/TaskEditorSheet.tsx');
  const PICKER = read('src/components/calendar/CalendarCombobox.tsx');

  it('passes the holds-tasks rule at its own call site, and only there', () => {
    expect(EDITOR).toContain('<CalendarCombobox');
    expect(EDITOR).toContain('holdsTasks');
    /*
     * The event editor keeps the plain rule: an event lives in any writable
     * calendar, and filtering it by VTODO support would hide half of them.
     */
    expect(read('src/components/calendar/EventEditorSheet.tsx')).not.toContain('holdsTasks');
  });

  it('applies the rule to the choices inside the combobox, not to its resolved value', () => {
    // The trigger still names the current calendar even when it is event-only.
    expect(PICKER).toContain('const selected = calendars.find((calendar) => calendar.id === value)');
    expect(PICKER).toContain('calendarsThatHoldTasks(calendars)');
  });
});
