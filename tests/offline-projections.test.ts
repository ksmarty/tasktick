/**
 * The placeholder drawn for a queued create.
 *
 * A queued create is the one write the app cannot show out of the box: every
 * optimistic update in this codebase is an *update* the component applies itself,
 * while a create only appears because the server sent the row back. These tests
 * pin the two properties that make the placeholder safe — it renders like a real
 * entity, and it never corrupts a payload it does not recognise.
 */
import { describe, expect, it } from 'vitest';
import { insertProjectedEntity, projectQueuedCreate } from '@/lib/offline-projections';

const NOW = 1_700_000_000_000;

describe('projecting a created task', () => {
  it('carries every field the row renderer reads, with the server’s defaults', () => {
    const projection = projectQueuedCreate('/api/tasks', { title: 'Milk', listId: 'list-1' }, 'temp:1', NOW);
    expect(projection).not.toBeNull();
    expect(projection!.resource).toBe('/api/tasks');
    expect(projection!.entity).toMatchObject({
      id: 'temp:1',
      title: 'Milk',
      listId: 'list-1',
      parentId: null,
      status: 'todo',
      priority: 'none',
      dueAtMs: null,
      dueDate: null,
      startAtMs: null,
      startDate: null,
      isAllDay: false,
      completedAtMs: null,
      recurrenceRule: null,
      recurrenceMode: 'due',
      estimateMinutes: null,
      spentMinutes: 0,
      isPinned: false,
      calendarId: null,
      createdAt: NOW,
      updatedAt: NOW,
      deletedAtMs: null,
      tagIds: [],
    });
  });

  it('keeps the submitted fields and drops non-string tag ids', () => {
    const projection = projectQueuedCreate(
      '/api/tasks?from=quick-add',
      { title: 'Milk', dueDate: '2026-01-05', isAllDay: true, tagIds: ['a', 3, null] },
      'temp:2',
      NOW,
    );
    expect(projection!.entity).toMatchObject({ dueDate: '2026-01-05', isAllDay: true, tagIds: ['a'] });
  });

  it('names an untitled task the way the server would', () => {
    const projection = projectQueuedCreate('/api/tasks', {}, 'temp:3', NOW);
    expect((projection!.entity as { title: string }).title).toBe('Untitled');
  });

  it('refuses a create with no temporary id, which cannot be referenced later', () => {
    expect(projectQueuedCreate('/api/tasks', { title: 'Milk' }, undefined, NOW)).toBeNull();
  });

  it('refuses what it cannot place honestly', () => {
    // An event needs a day bucket and a layout this layer cannot invent.
    expect(projectQueuedCreate('/api/events', { summary: 'Standup' }, 'temp:4', NOW)).toBeNull();
    expect(projectQueuedCreate('/api/tags', { name: 'urgent' }, 'temp:5', NOW)).toBeNull();
  });
});

describe('projecting a created list and habit', () => {
  it('produces a list the sidebar can render', () => {
    const projection = projectQueuedCreate('/api/lists', { name: 'Groceries', color: 'green' }, 'temp:6', NOW);
    expect(projection!.resource).toBe('/api/lists');
    expect(projection!.entity).toMatchObject({ id: 'temp:6', name: 'Groceries', color: 'green', isInbox: false, archived: false });
  });

  it('produces a habit with a usable default goal', () => {
    const projection = projectQueuedCreate('/api/habits', { name: 'Read' }, 'temp:7', NOW);
    expect(projection!.resource).toBe('/api/habits');
    expect(projection!.entity).toMatchObject({
      id: 'temp:7',
      name: 'Read',
      goalType: 'boolean',
      goalTarget: 1,
      frequency: 'daily',
      timesPerPeriod: 1,
      archived: false,
      entries: {},
      streak: 0,
    });
  });
});

describe('inserting a placeholder into a cached read', () => {
  it('appends to a bare array without mutating it', () => {
    const payload = [{ id: 'a' }];
    const next = insertProjectedEntity(payload, { id: 'temp:1' });
    expect(next).toEqual([{ id: 'a' }, { id: 'temp:1' }]);
    expect(payload).toEqual([{ id: 'a' }]);
  });

  it('appends to the `items` envelope the calendar read uses', () => {
    const payload = { items: [{ id: 'a' }], calendars: [], days: {} };
    expect(insertProjectedEntity(payload, { id: 'temp:1' })).toEqual({
      items: [{ id: 'a' }, { id: 'temp:1' }],
      calendars: [],
      days: {},
    });
  });

  it('never inserts the same entity twice', () => {
    const once = insertProjectedEntity([{ id: 'temp:1' }], { id: 'temp:1' });
    expect(insertProjectedEntity(once, { id: 'temp:1' })).toBe(once);
  });

  it('returns an unrecognised payload untouched, by identity', () => {
    const payload = { unexpected: true };
    expect(insertProjectedEntity(payload, { id: 'temp:1' })).toBe(payload);
    expect(insertProjectedEntity(null, { id: 'temp:1' })).toBeNull();
    expect(insertProjectedEntity('a string', { id: 'temp:1' })).toBe('a string');
  });
});
