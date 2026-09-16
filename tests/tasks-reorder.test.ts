/**
 * The optimistic maths behind dragging a task and behind bulking a selection.
 */
import { describe, expect, it } from 'vitest';
import type { AgendaBuckets } from '@/lib/agenda-types';
import type { Task } from '@/lib/types';
import {
  applyOrder,
  canReorder,
  moveId,
  patchById,
  patchByIds,
  removeByIds,
  reorderAgendaSection,
  reorderIds,
  reorderList,
  reorderableIds,
  setAgendaStatus,
  setPriorityByIds,
  setStatusById,
  setStatusByIds,
} from '@/components/tasks/optimistic';

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

const ids = ['a', 'b', 'c', 'd'];

describe('canReorder', () => {
  it('allows open, non-projected rows only', () => {
    expect(canReorder(task('a'))).toBe(true);
    expect(canReorder(task('a', { status: 'completed' }))).toBe(false);
    expect(canReorder(task('a', { status: 'wont_do' }))).toBe(false);
    expect(canReorder({ status: 'todo', isProjection: true })).toBe(false);
  });

  it('filters a mixed list down to the draggable ids', () => {
    const ids = reorderableIds([task('a'), task('b', { status: 'completed' }), task('c')]);
    expect(ids).toEqual(['a', 'c']);
  });
});

describe('moveId', () => {
  it('moves an entry and shifts the rest', () => {
    expect(moveId(ids, 0, 2)).toEqual(['b', 'c', 'a', 'd']);
    expect(moveId(ids, 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('clamps a destination that fell off the end', () => {
    expect(moveId(ids, 0, 99)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('returns a copy for an index that does not exist', () => {
    const result = moveId(ids, 9, 0);
    expect(result).toEqual(ids);
    expect(result).not.toBe(ids);
  });
});

describe('reorderIds', () => {
  it('drops before and after the row under the finger', () => {
    expect(reorderIds(ids, 'd', 'b', 'before')).toEqual(['a', 'd', 'b', 'c']);
    expect(reorderIds(ids, 'd', 'b', 'after')).toEqual(['a', 'b', 'd', 'c']);
  });

  it('moves a row upwards too', () => {
    expect(reorderIds(ids, 'a', 'c', 'after')).toEqual(['b', 'c', 'a', 'd']);
  });

  it('is a no-op when the row is dropped on itself or an unknown id', () => {
    expect(reorderIds(ids, 'b', 'b', 'before')).toEqual(ids);
    expect(reorderIds(ids, 'b', 'zz', 'after')).toEqual(ids);
    expect(reorderIds(ids, 'zz', 'b', 'after')).toEqual(ids);
  });

  it('does not mutate its input', () => {
    const input = [...ids];
    reorderIds(input, 'd', 'a', 'before');
    expect(input).toEqual(ids);
  });
});

describe('applyOrder', () => {
  it('reorders into the supplied id order', () => {
    const items = [task('a'), task('b'), task('c')];
    expect(applyOrder(items, ['c', 'a', 'b']).map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('keeps rows the payload did not mention, and ignores unknown ids', () => {
    const items = [task('a'), task('b'), task('c')];
    expect(applyOrder(items, ['c', 'ghost']).map((t) => t.id)).toEqual(['c', 'a', 'b']);
  });

  it('returns a new array', () => {
    const items = [task('a')];
    expect(applyOrder(items, ['a'])).not.toBe(items);
  });
});

describe('row patches', () => {
  it('replaces one row without touching the others', () => {
    const items = [task('a'), task('b')];
    const next = patchById(items, 'b', { title: 'Renamed' });
    expect(next[1].title).toBe('Renamed');
    expect(next[0]).toBe(items[0]);
    expect(items[1].title).toBe('Task b');
  });

  it('ticks a task complete and stamps the completion instant', () => {
    const next = setStatusById([task('a')], 'a', 'completed', 1234);
    expect(next[0].status).toBe('completed');
    expect(next[0].completedAtMs).toBe(1234);
  });

  it('clears the completion instant when un-ticking', () => {
    const next = setStatusById([task('a', { status: 'completed', completedAtMs: 1 })], 'a', 'todo', 999);
    expect(next[0].status).toBe('todo');
    expect(next[0].completedAtMs).toBeNull();
  });

  it('applies a bulk patch and a bulk removal to a selection', () => {
    const items = [task('a'), task('b'), task('c')];
    const selection = new Set(['a', 'c']);

    expect(setStatusByIds(items, selection, 'completed', 5).map((t) => t.status)).toEqual([
      'completed',
      'todo',
      'completed',
    ]);
    expect(setPriorityByIds(items, selection, 'high').map((t) => t.priority)).toEqual(['high', 'none', 'high']);
    expect(removeByIds(items, selection).map((t) => t.id)).toEqual(['b']);
    expect(patchByIds(items, new Set<string>(), { priority: 'low' })).toEqual(items);
  });
});

describe('agenda patches', () => {
  it('ticking a task moves it out of its bucket into Completed today', () => {
    const before = agenda({ today: [task('a'), task('b')] });
    const after = setAgendaStatus(before, 'a', 'completed', 42);

    expect(after.today.map((t) => t.id)).toEqual(['b']);
    expect(after.completedToday.map((t) => t.id)).toEqual(['a']);
    expect(after.completedToday[0].completedAtMs).toBe(42);
    // The input is untouched: `mutate` publishes a fresh object.
    expect(before.today).toHaveLength(2);
    expect(before.completedToday).toHaveLength(0);
  });

  it('un-ticking removes the row from Completed today', () => {
    const before = agenda({ completedToday: [task('a', { status: 'completed' })] });
    const after = setAgendaStatus(before, 'a', 'todo', 42);

    expect(after.completedToday).toEqual([]);
    expect(after.today).toEqual([]);
  });

  it('leaves the agenda alone for a task it does not show', () => {
    const before = agenda({ today: [task('a')] });
    expect(setAgendaStatus(before, 'ghost', 'completed', 42)).toBe(before);
  });

  it('reorders a section via its agenda bucket', () => {
    const before = agenda({ thisWeek: [task('a'), task('b'), task('c')] });
    const after = reorderAgendaSection(before, 'next7days', ['c', 'a', 'b']);

    expect(after.thisWeek.map((t) => t.id)).toEqual(['c', 'a', 'b']);
    expect(before.thisWeek.map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });

  it('ignores an unknown section id', () => {
    const before = agenda({ today: [task('a')] });
    expect(reorderAgendaSection(before, 'nope', ['a'])).toBe(before);
  });
});

describe('reorderList', () => {
  it('publishes the dropped order for a flat list screen', () => {
    const items = [task('a'), task('b'), task('c')];
    expect(reorderList(items, ['b', 'c', 'a']).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
});
