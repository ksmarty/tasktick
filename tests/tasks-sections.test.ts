/**
 * Section building for the Today screen and the grouped task list.
 */
import { describe, expect, it } from 'vitest';
import type { AgendaBuckets } from '@/lib/agenda-types';
import type { Task } from '@/lib/types';
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

  it('puts completed work last, collapsed, and never reorderable', () => {
    const sections = buildTodaySections(
      agenda({ today: [task('t1')], completedToday: [task('c1', { status: 'completed' })] }),
    );

    const completed = sections[sections.length - 1];
    expect(completed.id).toBe('completed');
    expect(completed.title).toBe('Completed today');
    expect(completed.defaultCollapsed).toBe(true);
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

  it('buckets open work into the four groups, in order', () => {
    const sections = buildListSections(
      [
        task('later', { dueDate: '2025-05-25' }),
        task('now', { dueDate: '2025-05-12' }),
        task('pinned', { isPinned: true }),
        task('late', { dueDate: '2025-05-10' }),
      ],
      options,
    );

    expect(sections.map((s) => s.id)).toEqual(['pinned', 'overdue', 'next7days', 'later']);
    expect(sections.map((s) => s.title)).toEqual(['Pinned', 'Overdue', 'Next 7 days', 'Later']);
    expect(sections.find((s) => s.id === 'overdue')?.tone).toBe('danger');
    expect(sections.every((s) => s.reorderable)).toBe(true);
  });

  it('keeps a pinned task out of every other group', () => {
    const sections = buildListSections([task('both', { isPinned: true, dueDate: '2025-05-01' })], options);

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('pinned');
    expect(sections[0].tasks.map((t) => t.id)).toEqual(['both']);
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

    expect(sections.find((s) => s.id === 'next7days')?.tasks.map((t) => t.id)).toEqual(['today', 'edge']);
    expect(sections.find((s) => s.id === 'later')?.tasks.map((t) => t.id)).toEqual(['past-edge']);
  });

  it('sends undated work to Later', () => {
    const sections = buildListSections([task('someday')], options);

    expect(sections).toHaveLength(1);
    expect(sections[0].id).toBe('later');
  });

  it('reads an instant-only task through the user zone', () => {
    // 2025-05-12T23:30Z is still the 12th in UTC.
    const sections = buildListSections([task('a', { dueAtMs: Date.UTC(2025, 4, 12, 23, 30) })], options);
    expect(sections[0].id).toBe('next7days');
  });

  it('keeps the incoming order inside a group', () => {
    const sections = buildListSections(
      [task('b', { dueDate: '2025-05-12' }), task('a', { dueDate: '2025-05-13' })],
      options,
    );
    expect(sections[0].tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('keeps closed work last, collapsed and un-reorderable', () => {
    const sections = buildListSections(
      [
        task('a', { dueDate: '2025-05-12' }),
        task('c', { status: 'completed' }),
        task('d', { status: 'wont_do' }),
      ],
      options,
    );

    expect(sections.map((s) => s.title)).toEqual(['Next 7 days', 'Completed']);
    const completed = sections[sections.length - 1];
    expect(completed.defaultCollapsed).toBe(true);
    expect(completed.reorderable).toBe(false);
    expect(completed.tasks.map((t) => t.id)).toEqual(['c', 'd']);
  });

  it('returns nothing at all for an empty list', () => {
    expect(buildListSections([], options)).toEqual([]);
  });
});
