/**
 * Section building for the Today screen and the grouped task list.
 */
import { describe, expect, it } from 'vitest';
import type { AgendaBuckets } from '@/lib/agenda-types';
import type { CalendarItem, Task } from '@/lib/types';
import {
  buildListSections,
  buildTodaySections,
  countRemaining,
  SECTION_BUCKET,
  todayProgress,
} from '@/components/tasks/sections';

function task(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    userId: 'u1',
    listId: null,
    parentId: null,
    title: `Task ${id}`,
    notes: null,
    url: null,
    status: 'todo',
    priority: 'none',
    dueAtMs: null,
    dueDate: null,
    startAtMs: null,
    startDate: null,
    isAllDay: true,
    timezone: null,
    completedAtMs: null,
    recurrenceRule: null,
    recurrenceMode: 'due',
    recurrenceId: null,
    estimateMinutes: null,
    spentMinutes: 0,
    sortOrder: '00000001',
    isPinned: false,
    calendarId: null,
    syncProvider: 'local',
    syncState: 'synced',
    externalUid: null,
    externalHref: null,
    externalEtag: null,
    lastSyncedAtMs: null,
    createdAt: 0,
    updatedAt: 0,
    deletedAtMs: null,
    ...patch,
  };
}

function agenda(patch: Partial<AgendaBuckets> = {}): AgendaBuckets {
  return {
    overdue: [],
    today: [],
    tomorrow: [],
    thisWeek: [],
    later: [],
    noDate: [],
    completedToday: [],
    ...patch,
  };
}

describe('buildTodaySections', () => {
  it('renders the buckets in the documented order and skips empty ones', () => {
    const sections = buildTodaySections(
      agenda({
        overdue: [task('o1')],
        today: [task('t1')],
        later: [task('l1')],
        noDate: [task('n1')],
      }),
    );

    expect(sections.map((section) => section.id)).toEqual(['overdue', 'today', 'later', 'noDate']);
    expect(sections.map((section) => section.title)).toEqual(['Overdue', 'Today', 'Later', 'No date']);
  });

  it('titles the thisWeek bucket "Next 7 days"', () => {
    const sections = buildTodaySections(agenda({ thisWeek: [task('w1')] }));
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBe('Next 7 days');
    expect(SECTION_BUCKET.next7days).toBe('thisWeek');
  });

  it('marks only Overdue as danger', () => {
    const sections = buildTodaySections(agenda({ overdue: [task('o1')], today: [task('t1')] }));
    expect(sections.find((s) => s.id === 'overdue')?.tone).toBe('danger');
    expect(sections.find((s) => s.id === 'today')?.tone).toBe('default');
  });

  it('puts completed work last, expanded, and never reorderable', () => {
    const sections = buildTodaySections(
      agenda({ today: [task('t1')], completedToday: [task('c1', { status: 'completed' })] }),
    );

    const completed = sections[sections.length - 1];
    expect(completed.id).toBe('completed');
    expect(completed.title).toBe('Completed today');
    // Expanded: the toggle reveals the group and its work must be visible at once.
    expect(completed.defaultCollapsed).toBe(false);
    expect(completed.reorderable).toBe(false);
  });

  it('is safe with no agenda at all', () => {
    expect(buildTodaySections(undefined)).toEqual([]);
    expect(buildTodaySections(null)).toEqual([]);
  });
});

describe('countRemaining / todayProgress', () => {
  it('counts everything that is not completed', () => {
    const sections = buildTodaySections(
      agenda({ today: [task('t1'), task('t2')], noDate: [task('n1')], completedToday: [task('c1')] }),
    );
    expect(countRemaining(sections)).toBe(3);
  });

  it('measures today as today + overdue work plus what is already ticked off', () => {
    const progress = todayProgress(
      agenda({
        today: [task('t1'), task('t2'), task('t3')],
        overdue: [task('o1')],
        completedToday: [task('c1', { status: 'completed' })],
      }),
    );

    expect(progress).toEqual({ completed: 1, total: 5, value: 0.2 });
  });

  it('reports zero progress instead of NaN on an empty day', () => {
    expect(todayProgress(agenda())).toEqual({ completed: 0, total: 0, value: 0 });
  });
});

describe('buildListSections', () => {
  const options = { zone: 'utc', today: '2025-05-12' };

  /** A minimal calendar item, so events can be bucketed beside the tasks. */
  function event(id: string, startDate: string, patch: Partial<CalendarItem> = {}): CalendarItem {
    const startMs = Date.parse(`${startDate}T09:00:00Z`);
    return {
      key: `event:${id}:${startMs}`,
      kind: 'event',
      id,
      title: `Event ${id}`,
      startMs,
      endMs: startMs + 60 * 60 * 1000,
      isAllDay: false,
      color: 'blue',
      calendarId: 'cal',
      ...patch,
    };
  }

  it('buckets open work into the six groups, in order', () => {
    const sections = buildListSections(
      [
        task('later', { dueDate: '2025-05-25' }),
        task('now', { dueDate: '2025-05-12' }),
        task('next', { dueDate: '2025-05-13' }),
        task('week', { dueDate: '2025-05-15' }),
        task('pinned', { isPinned: true }),
        task('late', { dueDate: '2025-05-10' }),
      ],
      options,
    );

    expect(sections.map((s) => s.id)).toEqual([
      'pinned',
      'overdue',
      'today',
      'tomorrow',
      'next7days',
      'later',
    ]);
    expect(sections.map((s) => s.title)).toEqual([
      'Pinned',
      'Overdue',
      'Today',
      'Tomorrow',
      'Next 7 days',
      'Later',
    ]);
    expect(sections.find((s) => s.id === 'overdue')?.tone).toBe('danger');
    expect(sections.find((s) => s.id === 'today')?.tone).toBe('default');
    expect(sections.every((s) => s.reorderable)).toBe(true);
  });

  it('keeps a pinned task out of every other group', () => {
    const sections = buildListSections([task('both', { isPinned: true, dueDate: '2025-05-01' })], options);

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('pinned');
    expect(sections[0].tasks.map((t) => t.id)).toEqual(['both']);
  });

  it('moves Pinned to the front without moving any task between groups', () => {
    // The documented rule is that each open task lands in exactly one group — a
    // task that is both pinned and due today is pinned, never listed twice. The
    // group order is a render concern only, so the task→group map must be the
    // same whichever slot Pinned occupies. Build the map from the rendered
    // sections and assert it against the classification the buckets imply.
    const rows = [
      task('pinned-today', { isPinned: true, dueDate: '2025-05-12' }),
      task('pinned-overdue', { isPinned: true, dueDate: '2025-05-01' }),
      task('overdue', { dueDate: '2025-05-10' }),
      task('today', { dueDate: '2025-05-12' }),
      task('tomorrow', { dueDate: '2025-05-13' }),
      task('week', { dueDate: '2025-05-15' }),
      task('later', { dueDate: '2025-05-25' }),
      task('someday'),
    ];
    const sections = buildListSections(rows, options);

    // Pinned is first in render order, and Overdue sits immediately below it:
    // urgency outranks a scheduled day, so the late work is the first thing
    // under the user's own ordering.
    const ids = sections.map((section) => section.id);
    expect(ids[0]).toBe('pinned');
    expect(ids[1]).toBe('overdue');
    expect(ids.indexOf('overdue')).toBeLessThan(ids.indexOf('today'));

    const groupOf = new Map<string, string>();
    for (const section of sections) {
      for (const row of section.tasks) {
        // Exactly one group per task: a duplicate would overwrite the entry.
        expect(groupOf.has(row.id)).toBe(false);
        groupOf.set(row.id, section.id);
      }
    }

    expect(groupOf.get('pinned-today')).toBe('pinned');
    expect(groupOf.get('pinned-overdue')).toBe('pinned');
    expect(groupOf.get('overdue')).toBe('overdue');
    expect(groupOf.get('today')).toBe('today');
    expect(groupOf.get('tomorrow')).toBe('tomorrow');
    expect(groupOf.get('week')).toBe('next7days');
    expect(groupOf.get('later')).toBe('later');
    expect(groupOf.get('someday')).toBe('later');
    expect(groupOf.size).toBe(rows.length);
  });

  it('omits a group with nothing in it', () => {
    const sections = buildListSections([task('a', { dueDate: '2025-05-20' })], options);
    expect(sections.map((s) => s.id)).toEqual(['later']);
  });

  it('reads the horizon as today through today + 7', () => {
    const sections = buildListSections(
      [
        task('today', { dueDate: '2025-05-12' }),
        task('edge', { dueDate: '2025-05-19' }),
        task('past-edge', { dueDate: '2025-05-20' }),
      ],
      options,
    );

    expect(sections.find((s) => s.id === 'today')?.tasks.map((t) => t.id)).toEqual(['today']);
    expect(sections.find((s) => s.id === 'next7days')?.tasks.map((t) => t.id)).toEqual(['edge']);
    expect(sections.find((s) => s.id === 'later')?.tasks.map((t) => t.id)).toEqual(['past-edge']);
  });

  it('pulls today and tomorrow out of the Next 7 days bucket', () => {
    const sections = buildListSections(
      [
        task('t', { dueDate: '2025-05-12' }),
        task('m', { dueDate: '2025-05-13' }),
        task('w', { dueDate: '2025-05-14' }),
      ],
      options,
    );

    expect(sections.find((s) => s.id === 'today')?.tasks.map((t) => t.id)).toEqual(['t']);
    expect(sections.find((s) => s.id === 'tomorrow')?.tasks.map((t) => t.id)).toEqual(['m']);
    expect(sections.find((s) => s.id === 'next7days')?.tasks.map((t) => t.id)).toEqual(['w']);
  });

  it('sends undated work to Later', () => {
    const sections = buildListSections([task('someday')], options);

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('later');
  });

  it('reads an instant-only task through the user zone', () => {
    // 2025-05-12T23:30Z is still the 12th in UTC.
    const sections = buildListSections([task('a', { dueAtMs: Date.UTC(2025, 4, 12, 23, 30) })], options);
    expect(sections[0].id).toBe('today');
  });

  it('keeps the incoming order inside a group', () => {
    const sections = buildListSections(
      [task('b', { dueDate: '2025-05-12' }), task('a', { dueDate: '2025-05-12' })],
      options,
    );
    expect(sections[0].id).toBe('today');
    expect(sections[0].tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('keeps closed work last, expanded and un-reorderable', () => {
    const sections = buildListSections(
      [
        task('a', { dueDate: '2025-05-12' }),
        task('c', { status: 'completed' }),
        task('d', { status: 'wont_do' }),
      ],
      options,
    );

    expect(sections.map((s) => s.title)).toEqual(['Today', 'Completed']);
    const completed = sections[sections.length - 1];
    expect(completed.defaultCollapsed).toBe(false);
    expect(completed.reorderable).toBe(false);
    expect(completed.events).toEqual([]);
    expect(completed.tasks.map((t) => t.id)).toEqual(['c', 'd']);
  });

  it('returns nothing at all for an empty list', () => {
    expect(buildListSections([], options)).toEqual([]);
  });

  it('places events in the day buckets beside the tasks', () => {
    const sections = buildListSections(
      [task('t', { dueDate: '2025-05-12' })],
      options,
      [event('tomorrow', '2025-05-13'), event('today', '2025-05-12')],
    );

    const today = sections.find((s) => s.id === 'today');
    const tomorrow = sections.find((s) => s.id === 'tomorrow');
    expect(today?.tasks.map((t) => t.id)).toEqual(['t']);
    expect(today?.events.map((e) => e.id)).toEqual(['today']);
    expect(tomorrow?.events.map((e) => e.id)).toEqual(['tomorrow']);
  });

  it('orders a group\'s events by start time and drops past events', () => {
    const sections = buildListSections([], options, [
      event('late', '2025-05-12', { startMs: Date.parse('2025-05-12T18:00:00Z') }),
      event('early', '2025-05-12', { startMs: Date.parse('2025-05-12T09:00:00Z') }),
      event('old', '2025-05-11'),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('today');
    expect(sections[0].events.map((e) => e.id)).toEqual(['early', 'late']);
  });

  it('treats a horizon-edge event as Next 7 days and a further one as Later', () => {
    const sections = buildListSections([], options, [
      event('edge', '2025-05-19'),
      event('far', '2025-05-25'),
    ]);

    expect(sections.find((s) => s.id === 'next7days')?.events.map((e) => e.id)).toEqual(['edge']);
    expect(sections.find((s) => s.id === 'later')?.events.map((e) => e.id)).toEqual(['far']);
  });

  it('marks an events-only group as un-reorderable', () => {
    const sections = buildListSections([], options, [event('e', '2025-05-12')]);

    expect(sections).toHaveLength(1);
    expect(sections[0].tasks).toEqual([]);
    expect(sections[0].reorderable).toBe(false);
  });
});

describe('buildListSections — Later shows one occurrence per series', () => {
  const options = { zone: 'utc', today: '2025-05-12' };

  /** An expanded recurring occurrence: one series uid, one instance start. */
  function occurrence(id: string, startDate: string, seriesUid: string): CalendarItem {
    const startMs = Date.parse(`${startDate}T09:00:00Z`);
    return {
      key: `event:${id}:${startMs}`,
      kind: 'event',
      id,
      title: `Event ${id}`,
      startMs,
      endMs: startMs + 60 * 60 * 1000,
      isAllDay: false,
      color: 'blue',
      calendarId: 'cal',
      seriesUid,
      isRecurringInstance: true,
    };
  }

  /** A plain one-off event, so it is not folded into any series. */
  function oneOff(id: string, startDate: string): CalendarItem {
    const startMs = Date.parse(`${startDate}T09:00:00Z`);
    return {
      key: `event:${id}:${startMs}`,
      kind: 'event',
      id,
      title: `Event ${id}`,
      startMs,
      endMs: startMs + 60 * 60 * 1000,
      isAllDay: false,
      color: 'blue',
      calendarId: 'cal',
    };
  }

  it('keeps only the next occurrence of a weekly series in Later', () => {
    const sections = buildListSections([], options, [
      occurrence('w1', '2025-05-25', 'standup'),
      occurrence('w2', '2025-06-01', 'standup'),
      occurrence('w3', '2025-06-08', 'standup'),
    ]);

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('later');
    expect(sections[0].events.map((e) => e.id)).toEqual(['w1']);
  });

  it('picks the earliest Later occurrence even when the input is unsorted', () => {
    // Ordering is not assumed of the caller: the function sorts by start before
    // it de-duplicates, so "next" is the next one however the input arrived.
    const sections = buildListSections([], options, [
      occurrence('late', '2025-06-08', 'standup'),
      occurrence('early', '2025-05-25', 'standup'),
      occurrence('mid', '2025-06-01', 'standup'),
    ]);

    expect(sections.find((s) => s.id === 'later')?.events.map((e) => e.id)).toEqual(['early']);
  });

  it('keeps every occurrence inside the day buckets', () => {
    // Within Next 7 days each occurrence is genuinely relevant, so only Later
    // collapses the series.
    const sections = buildListSections([], options, [
      occurrence('w1', '2025-05-14', 'standup'),
      occurrence('w2', '2025-05-15', 'standup'),
      occurrence('w3', '2025-05-16', 'standup'),
    ]);

    expect(sections.find((s) => s.id === 'next7days')?.events.map((e) => e.id)).toEqual([
      'w1',
      'w2',
      'w3',
    ]);
  });

  it('still shows the Later occurrence when the same series has near ones', () => {
    // The series' first occurrence over the whole window can be in a day bucket;
    // Later then shows the earliest one that actually landed there.
    const sections = buildListSections([], options, [
      occurrence('near', '2025-05-14', 'standup'),
      occurrence('far1', '2025-05-25', 'standup'),
      occurrence('far2', '2025-06-01', 'standup'),
    ]);

    expect(sections.find((s) => s.id === 'next7days')?.events.map((e) => e.id)).toEqual(['near']);
    expect(sections.find((s) => s.id === 'later')?.events.map((e) => e.id)).toEqual(['far1']);
  });

  it('leaves non-recurring events alone in Later', () => {
    const sections = buildListSections([], options, [
      oneOff('x', '2025-05-25'),
      oneOff('y', '2025-06-01'),
    ]);

    expect(sections.find((s) => s.id === 'later')?.events.map((e) => e.id)).toEqual(['x', 'y']);
  });

  it('does not merge two distinct series that share their days', () => {
    const sections = buildListSections([], options, [
      occurrence('a1', '2025-05-25', 'series-a'),
      occurrence('b1', '2025-05-25', 'series-b'),
      occurrence('a2', '2025-06-01', 'series-a'),
      occurrence('b2', '2025-06-01', 'series-b'),
    ]);

    expect(sections.find((s) => s.id === 'later')?.events.map((e) => e.id)).toEqual(['a1', 'b1']);
  });

  it('orders the surviving Later rows by start time', () => {
    const sections = buildListSections([], options, [
      occurrence('b', '2025-05-26', 'series-b'),
      occurrence('a', '2025-05-25', 'series-a'),
      occurrence('b2', '2025-06-02', 'series-b'),
      occurrence('a2', '2025-06-01', 'series-a'),
    ]);

    expect(sections.find((s) => s.id === 'later')?.events.map((e) => e.id)).toEqual(['a', 'b']);
  });
});
