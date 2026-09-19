/**
 * `/tasks` URL state: parsing, serialising, the API query it drives, and the
 * active filters the header button reports.
 */
import { describe, expect, it } from 'vitest';
import type { CalendarItem, Task } from '@/lib/types';
import {
  activeFilters,
  clearFilter,
  DEFAULT_TASK_VIEW,
  defaultSortDir,
  DIRECTIONAL_SORTS,
  isDirectionalSort,
  parseTaskView,
  serializeTaskView,
  sortTasks,
  taskQuery,
  taskViewTitle,
  updateTaskView,
  visibleEvents,
} from '@/components/tasks/filters';

const lookups = {
  lists: [
    { id: 'l1', name: 'Work' },
    { id: 'l2', name: 'Groceries' },
  ],
  tags: [{ id: 't1', name: 'urgent' }],
};

describe('parseTaskView / serializeTaskView', () => {
  it('reads every supported parameter', () => {
    expect(parseTaskView('list=l1&tag=t1&window=today&q=milk&sort=due&priority=high')).toEqual({
      listId: 'l1',
      tagId: 't1',
      window: 'today',
      q: 'milk',
      sort: 'due',
      sortDir: 'asc',
      priority: 'high',
    });
  });

  it('accepts a leading question mark and falls back to the defaults', () => {
    expect(parseTaskView('?window=overdue')).toMatchObject({ window: 'overdue', listId: null, sort: 'smart' });
    expect(parseTaskView('')).toMatchObject({ window: 'all', sort: 'smart', q: '' });
  });

  it('ignores values it does not understand', () => {
    expect(parseTaskView('window=whenever&sort=colour&priority=urgent')).toMatchObject({
      window: 'all',
      sort: 'smart',
      priority: null,
    });
  });

  it('round-trips, omitting defaults from the URL', () => {
    const state = parseTaskView('list=l1&window=completed&q=milk&sort=manual');
    expect(parseTaskView(serializeTaskView(state))).toEqual(state);
    expect(serializeTaskView(parseTaskView(''))).toBe('');
  });

  it('trims the free-text query when serialising', () => {
    expect(
      serializeTaskView({ listId: null, tagId: null, window: 'all', q: '  milk  ', sort: 'smart', sortDir: 'asc', priority: null }),
    ).toBe('q=milk');
  });
});

describe('sort direction', () => {
  it('offers a direction only for the sorts that can be reversed', () => {
    expect(DIRECTIONAL_SORTS).toEqual(['due', 'priority', 'title', 'created']);
    for (const sort of DIRECTIONAL_SORTS) expect(isDirectionalSort(sort)).toBe(true);
    for (const sort of ['smart', 'updated', 'manual'] as const) {
      expect(isDirectionalSort(sort)).toBe(false);
    }
  });

  it('starts each sort in the direction the API already used', () => {
    expect(defaultSortDir('due')).toBe('asc');
    expect(defaultSortDir('title')).toBe('asc');
    expect(defaultSortDir('priority')).toBe('asc');
    // The server orders `created` newest-first, so that is its default, not asc.
    expect(defaultSortDir('created')).toBe('desc');
  });

  it('parses an explicit direction additively, and drops it where it cannot apply', () => {
    expect(parseTaskView('sort=title&dir=desc').sortDir).toBe('desc');
    expect(parseTaskView('sort=smart&dir=desc').sortDir).toBe('asc');
    expect(parseTaskView('sort=title&dir=sideways').sortDir).toBe('asc');
    // An old link with no `dir` still reads the way it always did.
    expect(parseTaskView('sort=title').sortDir).toBe('asc');
    expect(parseTaskView('sort=created').sortDir).toBe('desc');
  });

  it('serialises only a non-default direction, so old links stay clean', () => {
    expect(serializeTaskView({ ...DEFAULT_TASK_VIEW, sort: 'due' })).toBe('sort=due');
    expect(serializeTaskView({ ...DEFAULT_TASK_VIEW, sort: 'created', sortDir: 'desc' })).toBe(
      'sort=created',
    );
    expect(serializeTaskView({ ...DEFAULT_TASK_VIEW, sort: 'due', sortDir: 'desc' })).toBe(
      'sort=due&dir=desc',
    );
    // A non-directional sort never writes one, even if the state somehow holds it.
    expect(serializeTaskView({ ...DEFAULT_TASK_VIEW, sort: 'smart', sortDir: 'desc' })).toBe('');
  });

  it('round-trips a reversed sort through the URL', () => {
    const state = parseTaskView('sort=title&dir=desc&window=today');
    expect(parseTaskView(serializeTaskView(state))).toEqual(state);
  });
});

function makeTask(id: string, patch: Partial<Task> = {}): Task {
  return {
    id,
    userId: 'u1',
    listId: null,
    parentId: null,
    title: id,
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

describe('sortTasks', () => {
  it('reverses title order', () => {
    const tasks = [makeTask('a', { title: 'Apple' }), makeTask('b', { title: 'Banana' })];
    expect(sortTasks(tasks, 'title', 'asc').map((t) => t.id)).toEqual(['a', 'b']);
    expect(sortTasks(tasks, 'title', 'desc').map((t) => t.id)).toEqual(['b', 'a']);
  });

  it('orders by due date, keeping undated work last whichever way it runs', () => {
    const tasks = [
      makeTask('late', { dueDate: '2025-05-20' }),
      makeTask('none'),
      makeTask('soon', { dueDate: '2025-05-12' }),
    ];
    expect(sortTasks(tasks, 'due', 'asc').map((t) => t.id)).toEqual(['soon', 'late', 'none']);
    expect(sortTasks(tasks, 'due', 'desc').map((t) => t.id)).toEqual(['late', 'soon', 'none']);
  });

  it('orders by priority, keeping unset priority last whichever way it runs', () => {
    const tasks = [
      makeTask('low', { priority: 'low' }),
      makeTask('none'),
      makeTask('high', { priority: 'high' }),
      makeTask('medium', { priority: 'medium' }),
    ];
    expect(sortTasks(tasks, 'priority', 'asc').map((t) => t.id)).toEqual([
      'high',
      'medium',
      'low',
      'none',
    ]);
    expect(sortTasks(tasks, 'priority', 'desc').map((t) => t.id)).toEqual([
      'low',
      'medium',
      'high',
      'none',
    ]);
  });

  it('orders newest-first for created desc and oldest-first for asc', () => {
    const tasks = [makeTask('old', { createdAt: 1 }), makeTask('new', { createdAt: 2 })];
    expect(sortTasks(tasks, 'created', 'desc').map((t) => t.id)).toEqual(['new', 'old']);
    expect(sortTasks(tasks, 'created', 'asc').map((t) => t.id)).toEqual(['old', 'new']);
  });

  it('leaves the server order alone for the sorts with no reverse', () => {
    const tasks = [makeTask('b'), makeTask('a')];
    for (const sort of ['smart', 'updated', 'manual'] as const) {
      expect(sortTasks(tasks, sort, 'desc').map((t) => t.id)).toEqual(['b', 'a']);
    }
  });

  it('does not mutate the input', () => {
    const tasks = [makeTask('b', { title: 'B' }), makeTask('a', { title: 'A' })];
    sortTasks(tasks, 'title', 'asc');
    expect(tasks.map((t) => t.id)).toEqual(['b', 'a']);
  });
});

describe('updateTaskView / clearFilter', () => {
  it('patches one field at a time', () => {
    const state = updateTaskView(parseTaskView('list=l1'), { window: 'today' });
    expect(state).toMatchObject({ listId: 'l1', window: 'today' });
  });

  it('clears a filter back to its default', () => {
    const state = parseTaskView('list=l1&tag=t1&window=completed&q=milk&priority=high');

    expect(clearFilter(state, 'list').listId).toBeNull();
    expect(clearFilter(state, 'tag').tagId).toBeNull();
    expect(clearFilter(state, 'window').window).toBe('all');
    expect(clearFilter(state, 'priority').priority).toBeNull();
    expect(clearFilter(state, 'q').q).toBe('');
    // Everything else survives.
    expect(clearFilter(state, 'list').q).toBe('milk');
  });
});

describe('taskQuery', () => {
  it('sends a plain window as dueWindow', () => {
    expect(taskQuery(parseTaskView('window=today'))).toEqual({ sort: 'smart', dueWindow: 'today' });
  });

  it('sends completed as a status filter, with completed rows included', () => {
    expect(taskQuery(parseTaskView('window=completed'))).toEqual({
      sort: 'smart',
      statuses: 'completed',
      includeCompleted: 1,
    });
  });

  it('asks for completed rows on "All", because the server hides them by default', () => {
    expect(taskQuery(parseTaskView(''))).toEqual({ sort: 'smart', includeCompleted: 1 });
  });

  it('sends arrays comma-separated and forwards every filter', () => {
    expect(taskQuery(parseTaskView('list=l1&tag=t1&priority=high&q=milk&sort=due'))).toEqual({
      sort: 'due',
      text: 'milk',
      listIds: 'l1',
      tagIds: 't1',
      priorities: 'high',
      includeCompleted: 1,
    });
  });
});

describe('activeFilters', () => {
  it('describes only the filters that are narrowing the list', () => {
    expect(activeFilters(parseTaskView(''), lookups)).toEqual([]);

    const chips = activeFilters(parseTaskView('list=l1&tag=t1&window=overdue&priority=high&q=milk'), lookups);
    expect(chips.map((chip) => [chip.key, chip.label])).toEqual([
      ['list', 'Work'],
      ['tag', '#urgent'],
      ['window', 'Overdue'],
      ['priority', 'high'],
      ['q', '“milk”'],
    ]);
  });

  it('falls back to a generic label when the list or tag is gone', () => {
    const chips = activeFilters(parseTaskView('list=gone&tag=gone'), lookups);
    expect(chips.map((chip) => chip.label)).toEqual(['List', '#Tag']);
  });
});

describe('taskViewTitle', () => {
  it('uses the list name when one is selected', () => {
    expect(taskViewTitle(parseTaskView('list=l2'), lookups)).toBe('Groceries');
  });

  it('names the smart list otherwise', () => {
    expect(taskViewTitle(parseTaskView(''), lookups)).toBe('All tasks');
    expect(taskViewTitle(parseTaskView('window=next7days'), lookups)).toBe('Next 7 days');
    expect(taskViewTitle(parseTaskView('window=completed'), lookups)).toBe('Completed');
  });

  it('survives a stale list id', () => {
    expect(taskViewTitle(parseTaskView('list=gone&window=overdue'), lookups)).toBe('Overdue');
  });
});

function makeEvent(id: string, patch: Partial<CalendarItem> = {}): CalendarItem {
  const startMs = Date.parse('2025-05-12T09:00:00Z');
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

describe('visibleEvents — a filter that cannot apply excludes the event', () => {
  const context = { zone: 'utc', today: '2025-05-12' as const };
  const events = [
    makeEvent('today'),
    makeEvent('tomorrow', { startMs: Date.parse('2025-05-13T09:00:00Z'), key: 'event:tomorrow' }),
    makeEvent('dentist', { title: 'Dentist appointment', location: 'Clinic' }),
  ];

  it('keeps every event when nothing is set', () => {
    expect(visibleEvents(events, parseTaskView(''), context).map((e) => e.id)).toEqual([
      'today',
      'tomorrow',
      'dentist',
    ]);
  });

  it('applies the search to an event title and location', () => {
    expect(visibleEvents(events, parseTaskView('q=dentist'), context).map((e) => e.id)).toEqual(['dentist']);
    expect(visibleEvents(events, parseTaskView('q=clinic'), context).map((e) => e.id)).toEqual(['dentist']);
    expect(visibleEvents(events, parseTaskView('q=nothing'), context)).toEqual([]);
  });

  it('trims to today when the window is Today', () => {
    expect(visibleEvents(events, parseTaskView('window=today'), context).map((e) => e.id)).toEqual([
      'today',
      'dentist',
    ]);
  });

  it('keeps a far event for All but trims it out of Next 7 days', () => {
    // The list now reads events out to the Later horizon, so `visibleEvents` is
    // the only thing stopping a far event from leaking into a Next 7 days view
    // and being grouped under Later — a later item in a list that asked for seven
    // days. All is the window that means "everything", Later included.
    const far = makeEvent('far', {
      startMs: Date.parse('2025-06-20T09:00:00Z'),
      key: 'event:far',
    });
    const rows = [...events, far];

    expect(visibleEvents(rows, parseTaskView(''), context).map((e) => e.id)).toContain('far');
    expect(visibleEvents(rows, parseTaskView('window=next7days'), context).map((e) => e.id)).toEqual([
      'today',
      'tomorrow',
      'dentist',
    ]);
  });

  it('excludes events for list, tag and priority filters, which they cannot satisfy', () => {
    // An event belongs to a calendar, not a list; it has no tags and no priority,
    // so a filter naming one must not silently keep it.
    expect(visibleEvents(events, parseTaskView('list=l1'), context)).toEqual([]);
    expect(visibleEvents(events, parseTaskView('tag=t1'), context)).toEqual([]);
    expect(visibleEvents(events, parseTaskView('priority=high'), context)).toEqual([]);
  });

  it('excludes events for windows a dated event can never be in', () => {
    expect(visibleEvents(events, parseTaskView('window=completed'), context)).toEqual([]);
    expect(visibleEvents(events, parseTaskView('window=overdue'), context)).toEqual([]);
    expect(visibleEvents(events, parseTaskView('window=noDate'), context)).toEqual([]);
  });
});
