/**
 * TickTick CSV → TaskTick mapping.
 *
 * The header used here is the one two independent third-party importers agree on
 * (see `src/lib/ticktick-import.ts`). These tests pin the field mapping rules and
 * — just as importantly — that an unrecognised column or value is *reported*
 * rather than dropped.
 */
import { describe, expect, it } from 'vitest';
import {
  MAX_IMPORT_ROWS,
  mapTickTickPriority,
  mapTickTickRecurrence,
  mapTickTickStatus,
  mapTickTickTags,
  parseTickTickCsv,
  splitTickTickChecklist,
} from '@/lib/ticktick-import';

const HEADER = [
  'Folder Name',
  'List Name',
  'Title',
  'Kind',
  'Tags',
  'Content',
  'Is Check list',
  'Start Date',
  'Due Date',
  'Reminder',
  'Repeat',
  'Priority',
  'Status',
  'Created Time',
  'Completed Time',
  'Order',
  'Timezone',
  'Is All Day',
  'Is Floating',
  'Column Name',
  'Column Order',
  'View Mode',
  'taskId',
  'parentId',
];

const CSV_ROW = (cells: string[]) => cells.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',');

interface RowOverrides {
  [index: number]: string;
}

/** Builds a row from the real 24-column shape, applying index overrides. */
function tickTickRow(overrides: RowOverrides = {}): string {
  const cells = new Array<string>(HEADER.length).fill('');
  cells[0] = 'Work';
  cells[1] = 'Launch';
  cells[2] = 'A task';
  cells[3] = 'TEXT';
  for (const [index, value] of Object.entries(overrides)) cells[Number(index)] = value;
  return CSV_ROW(cells);
}

/** Three metadata lines, then the header, then the rows — the common export. */
function buildCsv(rows: string[], preamble: string[] = defaultPreamble()): string {
  return [...preamble, CSV_ROW(HEADER), ...rows].join('\n');
}

function defaultPreamble(): string[] {
  return ['"Date: 2026-06-17+0000"', '"Version: 7.1"', '"Status:\n0 Normal\n1 Completed\n2 Archived"'];
}

describe('TickTick header handling', () => {
  it('finds the header after a three-line preamble', () => {
    const result = parseTickTickCsv(buildCsv([tickTickRow()]));
    expect(result.ok).toBe(true);
  });

  it('finds the header after a six-line preamble (sources disagree on the offset)', () => {
    const preamble = ['"a"', '"b"', '"c"', '"d"', '"e"', '"f"'];
    const result = parseTickTickCsv(buildCsv([tickTickRow()], preamble));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan.preview.tasks).toBe(1);
  });

  it('refuses a CSV without the required columns', () => {
    const result = parseTickTickCsv('"Foo","Bar"\n"a","b"');
    expect(result).toMatchObject({ ok: false, code: 'not_ticktick' });
  });

  it('refuses an empty file and a header-only file', () => {
    expect(parseTickTickCsv('')).toMatchObject({ ok: false, code: 'empty' });
    expect(parseTickTickCsv(buildCsv([]))).toMatchObject({ ok: false, code: 'empty' });
  });

  it('refuses a truncated file', () => {
    const result = parseTickTickCsv('"Title","List Name"\n"unterminated,Inbox');
    expect(result).toMatchObject({ ok: false, code: 'truncated' });
  });

  it('refuses a file past the row cap with an explicit limit', () => {
    const rows = Array.from({ length: 5 }, (_, i) => tickTickRow({ 2: `Task ${i}`, 22: String(i) }));
    const result = parseTickTickCsv(buildCsv(rows), { maxRows: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('too_large');
      expect(result.error).toContain('3');
    }
    expect(MAX_IMPORT_ROWS).toBe(10_000);
  });
});

describe('TickTick field mapping', () => {
  it('maps title, list, tags, notes, priority, due date, completion and recurrence', () => {
    const row = tickTickRow({
      1: 'Launch',
      2: 'Plan release',
      4: '#work, focus',
      5: 'Write the launch brief',
      8: '2026-06-18T09:30:00+0000',
      10: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
      11: '5',
      12: '2',
      13: '2026-06-11T12:00:00+0000',
      14: '2026-06-15T12:00:00+0000',
      15: '-2',
      16: 'America/New_York',
      22: 't1',
    });
    const result = parseTickTickCsv(buildCsv([row]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [task] = result.plan.tasks;
    expect(task).toMatchObject({
      key: 'task:t1',
      title: 'Plan release',
      listKey: 'list:launch',
      notes: 'Write the launch brief',
      tags: ['work', 'focus'],
      priority: 'high',
      status: 'completed',
      dueDate: '2026-06-18',
      dueTime: '09:30',
      timezone: 'America/New_York',
      recurrenceRule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE',
    });
    expect(task?.completedAtMs).toBe(Date.parse('2026-06-15T12:00:00Z'));
    expect(task?.createdAtMs).toBe(Date.parse('2026-06-11T12:00:00Z'));
    expect(result.plan.preview).toMatchObject({ tasks: 1, completed: 1, recurring: 1, lists: [{ name: 'Launch', folder: 'Work' }] });
  });

  it('maps the priority scale 0/1/3/5 and reports anything else', () => {
    expect(mapTickTickPriority('0')).toEqual({ priority: 'none', unexpected: false });
    expect(mapTickTickPriority('1')).toEqual({ priority: 'low', unexpected: false });
    expect(mapTickTickPriority('3')).toEqual({ priority: 'medium', unexpected: false });
    expect(mapTickTickPriority('5')).toEqual({ priority: 'high', unexpected: false });
    expect(mapTickTickPriority('4')).toEqual({ priority: 'medium', unexpected: true });
    expect(mapTickTickPriority('')).toEqual({ priority: 'none', unexpected: false });
    expect(mapTickTickPriority('urgent')).toEqual({ priority: 'none', unexpected: true });
  });

  it('maps the status codes 0/1/2 and treats a completion time as completed', () => {
    expect(mapTickTickStatus('0', null).status).toBe('todo');
    expect(mapTickTickStatus('1', null).status).toBe('completed');
    expect(mapTickTickStatus('2', null).status).toBe('completed');
    expect(mapTickTickStatus('9', null).unknown).toBe(true);
    expect(mapTickTickStatus('0', Date.parse('2026-01-01T00:00:00Z')).status).toBe('completed');
  });

  it('keeps an all-day due date as a date with no time', () => {
    const row = tickTickRow({ 8: '2026-06-18', 17: 'true', 22: 't2' });
    const result = parseTickTickCsv(buildCsv([row]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0]).toMatchObject({ dueDate: '2026-06-18', dueTime: null });
  });

  it('accepts a bare date in the Due Date column', () => {
    const row = tickTickRow({ 8: '2026-06-18', 22: 't3' });
    const result = parseTickTickCsv(buildCsv([row]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0]).toMatchObject({ dueDate: '2026-06-18', dueTime: null });
  });

  it('splits tags on commas and semicolons and strips the hash', () => {
    expect(mapTickTickTags('#work, focus; #ops')).toEqual(['work', 'focus', 'ops']);
    expect(mapTickTickTags('')).toEqual([]);
  });

  it('only accepts a real RRULE', () => {
    expect(mapTickTickRecurrence('FREQ=DAILY')).toBe('FREQ=DAILY');
    expect(mapTickTickRecurrence('RRULE:FREQ=MONTHLY;BYMONTHDAY=1')).toBe('FREQ=MONTHLY;BYMONTHDAY=1');
    expect(mapTickTickRecurrence('every monday')).toBeNull();
  });

  it('reports an unmappable repeat rule instead of storing it', () => {
    const row = tickTickRow({ 10: 'every other tuesday', 22: 't4' });
    const result = parseTickTickCsv(buildCsv([row]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0]?.recurrenceRule).toBeNull();
    expect(result.plan.preview.issues.some((issue) => issue.column === 'Repeat')).toBe(true);
  });

  it('falls back to the default zone for an unknown IANA name', () => {
    const row = tickTickRow({ 16: 'Mars/Olympus', 22: 't5' });
    const result = parseTickTickCsv(buildCsv([row]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0]?.timezone).toBeNull();
  });
});

describe('TickTick columns and rows we cannot map', () => {
  it('reports every header column it does not consume', () => {
    const result = parseTickTickCsv(buildCsv([tickTickRow({ 22: 't6' })]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.preview.unmappedColumns.sort()).toEqual(
      ['Column Name', 'Column Order', 'Is Floating', 'Reminder', 'View Mode'].sort(),
    );
  });

  it('reports an unknown column the moment TickTick adds one', () => {
    const withExtra = [...HEADER, 'New Fangled Column'];
    const cells = new Array<string>(withExtra.length).fill('');
    cells[1] = 'Inbox';
    cells[2] = 'Hello';
    cells[withExtra.length - 1] = 'surprise';
    const csv = [...defaultPreamble(), CSV_ROW(withExtra), CSV_ROW(cells)].join('\n');
    const result = parseTickTickCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.preview.unmappedColumns).toContain('New Fangled Column');
  });

  it('skips a row with no title and reports it', () => {
    const rows = [tickTickRow({ 2: '', 22: 't7' }), tickTickRow({ 2: 'Keep me', 22: 't8' })];
    const result = parseTickTickCsv(buildCsv(rows));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.preview).toMatchObject({ tasks: 1, skippedRows: 1, issueCount: 1 });
  });

  it('ignores blank lines between records', () => {
    const csv = buildCsv([tickTickRow({ 22: 't9' }), '', tickTickRow({ 2: 'Second', 22: 't10' })]);
    const result = parseTickTickCsv(csv);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.preview.tasks).toBe(2);
    expect(result.plan.preview.skippedRows).toBe(0);
  });
});

describe('TickTick subtasks and checklists', () => {
  it('maps parentId rows to subtasks, even when the child appears first', () => {
    const child = tickTickRow({ 2: 'Child task', 22: 'c1', 23: 'p1', 15: '1' });
    const parent = tickTickRow({ 2: 'Parent task', 22: 'p1', 15: '0' });
    const result = parseTickTickCsv(buildCsv([child, parent]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.plan.preview).toMatchObject({ tasks: 1, subtasks: 1 });
    const childPlan = result.plan.tasks.find((task) => task.title === 'Child task');
    const parentPlan = result.plan.tasks.find((task) => task.title === 'Parent task');
    expect(childPlan?.parentKey).toBe(parentPlan?.key);
  });

  it('imports an orphaned child as a top-level task and reports it', () => {
    const orphan = tickTickRow({ 2: 'Orphan', 22: 'o1', 23: 'missing' });
    const result = parseTickTickCsv(buildCsv([orphan]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.tasks[0]?.parentKey).toBeNull();
    expect(result.plan.preview.issues.some((issue) => issue.column === 'parentId')).toBe(true);
  });

  it('flattens a third level onto the top-level task and reports it', () => {
    const grandchild = tickTickRow({ 2: 'Grandchild', 22: 'g1', 23: 'c1' });
    const child = tickTickRow({ 2: 'Child', 22: 'c1', 23: 'p1' });
    const parent = tickTickRow({ 2: 'Parent', 22: 'p1' });
    const result = parseTickTickCsv(buildCsv([grandchild, child, parent]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const grandchildPlan = result.plan.tasks.find((task) => task.title === 'Grandchild');
    const parentPlan = result.plan.tasks.find((task) => task.title === 'Parent');
    expect(grandchildPlan?.parentKey).toBe(parentPlan?.key);
    expect(result.plan.preview.issues.some((issue) => issue.message.includes('Nested'))).toBe(true);
  });

  it('turns checklist lines into subtasks and keeps the rest as notes', () => {
    const row = tickTickRow({ 3: 'CHECKLIST', 5: '▫Passport\n▪Tickets\nBring snacks', 6: 'Y', 22: 'ch1' });
    const result = parseTickTickCsv(buildCsv([row]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const parent = result.plan.tasks.find((task) => task.key === 'task:ch1');
    expect(parent?.notes).toBe('Bring snacks');
    const subtasks = result.plan.tasks.filter((task) => task.parentKey === 'task:ch1');
    expect(subtasks.map((task) => [task.title, task.status])).toEqual([
      ['Passport', 'todo'],
      ['Tickets', 'completed'],
    ]);
  });

  it('parses checklist markers directly', () => {
    expect(splitTickTickChecklist('▫one\n▪two\nplain')).toEqual({
      items: [
        { title: 'one', completed: false },
        { title: 'two', completed: true },
      ],
      notes: 'plain',
    });
  });
});

describe('TickTick list identity', () => {
  it('deduplicates lists by name but keeps folders for the report', () => {
    const rows = [
      tickTickRow({ 2: 'A', 22: 'l1' }),
      tickTickRow({ 2: 'B', 22: 'l2' }),
      tickTickRow({ 0: 'Personal', 1: 'Errands', 2: 'C', 22: 'l3' }),
    ];
    const result = parseTickTickCsv(buildCsv(rows));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.lists).toHaveLength(2);
    expect(result.plan.preview.lists.map((list) => list.name)).toEqual(['Launch', 'Errands']);
  });
});
