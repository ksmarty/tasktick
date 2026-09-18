/**
 * The task list's merged rows: events beside tasks, and the completed toggle.
 *
 * The row components are client components, so — as with the rest of this suite —
 * the structural contract is pinned from source where it cannot be rendered. The
 * one piece of behaviour with real logic behind it (`visibleTasks`) is exercised
 * directly.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { visibleTasks } from '@/components/tasks/sections';
import type { Task } from '@/lib/types';

function read(relativeToSrc: string): string {
  return readFileSync(new URL(`../src/${relativeToSrc}`, import.meta.url), 'utf8');
}

function source(relative: string): string {
  return read(`components/tasks/${relative}`);
}

const EVENT_ROW = source('EventRow.tsx');
const ROW = source('TaskRow.tsx');
const SECTION = source('TaskListSection.tsx');
const VIEW = source('TasksView.tsx');

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

describe('visibleTasks — completed hidden by default', () => {
  const rows = [task('todo'), task('done', { status: 'completed' }), task('nope', { status: 'wont_do' })];

  it('drops closed work unless it is asked for', () => {
    expect(visibleTasks(rows, false).map((t) => t.id)).toEqual(['todo']);
  });

  it('keeps every row when completed is shown', () => {
    expect(visibleTasks(rows, true).map((t) => t.id)).toEqual(['todo', 'done', 'nope']);
  });

  it('returns a copy, so the caller can sort it without mutating the cache', () => {
    expect(visibleTasks(rows, true)).not.toBe(rows);
  });
});

describe('EventRow — an event is not a task', () => {
  it('draws the calendar glyph where the checkbox sits', () => {
    expect(EVENT_ROW).toContain("from '@svg-animated-icons/react/calendar'");
    expect(EVENT_ROW).toContain('<CalendarIcon');
    // The same 44px target and the same 20px glyph as the task checkbox.
    expect(EVENT_ROW).toContain('size-5 text-xl');
    expect(EVENT_ROW).toContain('-ml-3 grid size-11 shrink-0 place-items-center');
  });

  it('cannot be completed: no checkbox, no toggle, no swipe-to-complete', () => {
    expect(EVENT_ROW).not.toContain("from '@/components/ui/checkbox'");
    expect(EVENT_ROW).not.toContain('<Checkbox');
    expect(EVENT_ROW).not.toContain('onToggle');
    expect(EVENT_ROW).not.toContain('SWIPE_ACTION_WIDTH');
    expect(EVENT_ROW).not.toContain('>Complete<');
  });

  it('keeps the event title to a single ellipsised line', () => {
    // The task title wraps on purpose; only the event title truncates.
    expect(EVENT_ROW).toContain('min-w-0 flex-1 truncate text-base leading-tight');
  });

  it('carries the per-row colour strip in the calendar colour', () => {
    expect(EVENT_ROW).toContain('absolute inset-y-0 left-0 w-1');
    expect(EVENT_ROW).toContain('accentHex(event.color)');
  });

  it('names the row for a screen reader with the time and the kind', () => {
    expect(EVENT_ROW).toContain("'event'");
    expect(EVENT_ROW).toContain('aria-label={accessibleName}');
  });
});

describe('TaskRow — the strip is added, the wrapping title is not undone', () => {
  it('paints the list colour on the row edge', () => {
    expect(ROW).toContain('absolute inset-y-0 left-0 w-1');
    expect(ROW).toContain('accentHex(accent)');
    expect(ROW).toContain("from '@/lib/colors'");
    // A strip is not a left border, so it must not shift the text axis.
    expect(ROW).not.toContain('border-l-4');
  });

  it('still lets the task title wrap', () => {
    expect(ROW).toContain("'min-w-0 flex-1 text-base leading-tight'");
    // The title span itself must not carry `truncate`.
    const titleBlock = ROW.slice(ROW.indexOf("'min-w-0 flex-1 text-base leading-tight'"), ROW.indexOf('{task.title}'));
    expect(titleBlock).not.toContain('truncate');
  });
});

describe('TaskListSection — events render beside the tasks', () => {
  it('renders an EventRow for each event, after the tasks', () => {
    expect(SECTION).toContain("from './EventRow'");
    expect(SECTION).toContain('<EventRow');
    expect(SECTION).toContain('section.events.map');
    expect(SECTION.indexOf('section.tasks.map')).toBeLessThan(SECTION.indexOf('section.events.map'));
  });

  it('resolves each task row accent through the lookup it was given', () => {
    expect(SECTION).toContain('accent={listColorFor?.(task) ?? null}');
  });
});

describe('TasksView — the completed toggle and the events source', () => {
  it('hides completed rows by default and exposes the state as pressed', () => {
    expect(VIEW).toContain('const [showCompleted, setShowCompleted] = useState(false)');
    expect(VIEW).toContain('aria-pressed={completedVisible}');
    expect(VIEW).toContain("aria-label={completedVisible ? 'Hide completed tasks' : 'Show completed tasks'}");
    // The icon is the eye pair, and it fills while shown.
    expect(VIEW).toContain("from '@svg-animated-icons/react/eye-none'");
    expect(VIEW).toContain("from '@svg-animated-icons/react/eye-open'");
    expect(VIEW).toContain('icon={completedVisible ? EyeOpenIcon : EyeNoneIcon}');
  });

  it('merges events from the one calendar read endpoint', () => {
    expect(VIEW).toContain("'/api/calendar/items'");
    expect(VIEW).toContain("item.kind === 'event'");
    expect(VIEW).toContain('onOpenEvent={openEvent}');
    expect(VIEW).toContain('listColorFor={accentForTask}');
  });

  it('closes the completed view when its toggle is turned off', () => {
    // The explicit Completed filter would otherwise force the toggle to stay on.
    expect(VIEW).toContain("if (state.window === 'completed')");
    expect(VIEW).toContain("applyState({ window: 'all' })");
  });

  it('keeps multi-select reachable after it left the header', () => {
    expect(VIEW).toContain("aria-label={selectionMode ? 'Done selecting' : 'Select tasks'}");
    expect(VIEW).toContain('aria-pressed={selectionMode}');
  });
});
