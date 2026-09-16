/**
 * `/tasks` URL state: parsing, serialising, the API query it drives, and the
 * chips that describe the active filters.
 */
import { describe, expect, it } from 'vitest';
import {
  activeFilters,
  clearFilter,
  parseTaskView,
  serializeTaskView,
  shouldGroupByDay,
  taskQuery,
  taskViewTitle,
  updateTaskView,
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
    expect(serializeTaskView({ listId: null, tagId: null, window: 'all', q: '  milk  ', sort: 'smart', priority: null })).toBe(
      'q=milk',
    );
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

describe('shouldGroupByDay', () => {
  it('groups only the chronological sorts', () => {
    expect(shouldGroupByDay('smart')).toBe(true);
    expect(shouldGroupByDay('due')).toBe(true);
    expect(shouldGroupByDay('manual')).toBe(false);
    expect(shouldGroupByDay('priority')).toBe(false);
    expect(shouldGroupByDay('title')).toBe(false);
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
