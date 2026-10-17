/**
 * What a reminder notification opens and offers to do.
 *
 * Three screens have to agree about this: the notification the worker shows, the
 * tap that navigates, and the button that writes a check-in. All three read this
 * module, so the pinning here is about the agreement — the exact route the
 * screens already parse, the identity a button reports back, and an event's day
 * read in the user's zone rather than the server's.
 */
import { describe, expect, it } from 'vitest';
import { COMPLETE_ACTION, habitOccurrenceDate, reminderLink } from '@/lib/reminder-notification';

const REMINDER = { source: 'task' as const, sourceId: 'task-1', occurrenceKey: '2', title: 'Pay rent' };

describe('reminderLink', () => {
  it('opens the task detail sheet and offers to complete it', () => {
    expect(reminderLink(REMINDER, 'UTC')).toEqual({
      url: '/tasks?task=task-1',
      tag: 'task-task-1',
      actions: [{ action: COMPLETE_ACTION, title: 'Complete' }],
      data: { source: 'task', sourceId: 'task-1', occurrenceKey: '2' },
    });
  });

  it('escapes the id so an odd one still lands on the screen', () => {
    const link = reminderLink({ ...REMINDER, sourceId: 'task/2 things' }, 'UTC');

    expect(link.url).toBe('/tasks?task=task%2F2%20things');
    expect(link.data.sourceId).toBe('task/2 things');
  });

  it('opens the habit editor for the day the occurrence names', () => {
    expect(reminderLink({ ...REMINDER, source: 'habit', sourceId: 'habit-1', occurrenceKey: '2026-03-14:480' }, 'UTC')).toEqual({
      url: '/habits?habit=habit-1',
      // Dated: this morning's reminder and tonight's are about the same habit.
      tag: 'habit-habit-1-2026-03-14',
      actions: [{ action: COMPLETE_ACTION, title: 'Check in' }],
      data: { source: 'habit', sourceId: 'habit-1', occurrenceKey: '2026-03-14:480' },
    });
  });

  it('falls back to the raw occurrence key when a habit key names no day', () => {
    const link = reminderLink({ ...REMINDER, source: 'habit', sourceId: 'habit-1', occurrenceKey: 'nonsense' }, 'UTC');

    expect(link.tag).toBe('habit-habit-1-nonsense');
    expect(link.url).toBe('/habits?habit=habit-1');
  });

  it('opens the event card on the event day, and offers no button', () => {
    const startMs = Date.UTC(2026, 2, 14, 23, 30);
    const link = reminderLink(
      { ...REMINDER, source: 'event', sourceId: 'event-1', occurrenceKey: `${startMs}:10` },
      'America/New_York',
    );

    expect(link.url).toBe('/calendar?date=2026-03-14&event=event-1');
    expect(link.tag).toBe(`event-event-1-${startMs}`);
    // An event has nothing to tick off: the tap is the whole action.
    expect(link.actions).toEqual([]);
  });

  it('reads the event day in the user zone, not the server hour', () => {
    const startMs = Date.UTC(2026, 2, 14, 23, 30);
    const reminder = { ...REMINDER, source: 'event' as const, sourceId: 'event-1', occurrenceKey: `${startMs}:0` };

    expect(reminderLink(reminder, 'America/New_York').url).toBe('/calendar?date=2026-03-14&event=event-1');
    expect(reminderLink(reminder, 'Asia/Tokyo').url).toBe('/calendar?date=2026-03-15&event=event-1');
  });

  it('still opens the calendar when an event key names no instant', () => {
    const link = reminderLink({ ...REMINDER, source: 'event', sourceId: 'event-1', occurrenceKey: 'later' }, 'UTC');

    expect(link.url).toBe('/calendar?event=event-1');
    expect(link.tag).toBe('event-event-1-later');
  });
});

describe('habitOccurrenceDate', () => {
  it('reads the day out of a habit occurrence key', () => {
    expect(habitOccurrenceDate('2026-03-14:480')).toBe('2026-03-14');
    expect(habitOccurrenceDate('2026-03-14')).toBe('2026-03-14');
  });

  it('refuses anything that is not a day', () => {
    expect(habitOccurrenceDate('')).toBeNull();
    expect(habitOccurrenceDate('2026-13-40:0')).toBeNull();
    expect(habitOccurrenceDate('later')).toBeNull();
  });
});
