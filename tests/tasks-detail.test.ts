/**
 * The item detail sheet, the section count, and the editor's focus contract.
 *
 * As with the rest of this suite, the client components cannot be rendered in
 * node, so the structural contract is pinned from source. Each pin here stands
 * for a behaviour that was asked for explicitly and would regress silently:
 *
 *  - a section header counts events as well as tasks;
 *  - tapping a row opens the detail sheet, not the editor, and Edit opens the
 *    editor;
 *  - the detail sheet is the shared `ItemDetailSheet` that the calendar can
 *    reuse rather than a per-screen copy;
 *  - the editor does not autofocus its title on the edit path, while quick add
 *    keeps the synchronous focus the iOS keyboard depends on.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/components/tasks/${relative}`, import.meta.url), 'utf8');
}

const ROW = source('TaskRow.tsx');
const EVENT_ROW = source('EventRow.tsx');
const SECTION = source('TaskListSection.tsx');
const VIEW = source('TasksView.tsx');
const TODAY = source('TodayView.tsx');
const EDITOR = source('TaskEditorSheet.tsx');
const QUICK_ADD = source('QuickAddBar.tsx');
const DETAIL = source('ItemDetailSheet.tsx');
const INDEX = source('index.ts');

describe('the section header counts every row', () => {
  it('adds the events to the task count', () => {
    expect(SECTION).toContain('const itemCount = taskCount + eventCount;');
    expect(SECTION).toContain('{itemCount}');
  });

  it('spells the split out for a screen reader', () => {
    expect(SECTION).toContain('${taskCount} task${taskCount === 1 ?');
    expect(SECTION).toContain('${eventCount} event${eventCount === 1 ?');
    expect(SECTION).toContain('{countSummary}');
  });
});

describe('the first row squares its highlight at the section top', () => {
  it('drops the top rounding on both row kinds', () => {
    // Rounding only the left corners would leave the shape lopsided, so the
    // whole top edge is squared instead.
    expect(ROW).toContain("first && 'rounded-t-none'");
    expect(EVENT_ROW).toContain("first && 'rounded-t-none'");
  });
});

describe('a tap opens the detail sheet, and Edit opens the editor', () => {
  it('gives the row an open handler that is not the editor', () => {
    expect(ROW).toContain('onOpen(task)');
    expect(ROW).toContain('onOpen: (task: Task) => void');
    expect(EVENT_ROW).toContain('onOpen?.(event)');
  });

  it('routes the tap to the detail sheet on both task screens', () => {
    expect(VIEW).toContain('onOpen={openTaskDetail}');
    expect(VIEW).toContain('onOpenEvent={openEventDetail}');
    expect(TODAY).toContain('onOpen={setDetail}');
  });

  it('leads from the detail sheet to the editor', () => {
    // A task opens the in-place task editor; an event opens the event editor, the
    // same one the calendar screen mounts, so Edit edits rather than navigates.
    expect(VIEW).toContain('function editDetailItem()');
    expect(VIEW).toContain('setEditor({ open: true, task })');
    expect(VIEW).toContain('<EventEditorSheet');
    expect(VIEW).toContain('setEventEditor({');
    expect(VIEW).toContain('eventEditorDefaults(event, zone)');
    expect(TODAY).toContain('function editDetailTask()');
    expect(TODAY).toContain('setEditor({ open: true, task })');
  });
});

describe('ItemDetailSheet — the reusable overlay', () => {
  it('is the GodUI Drawer, with an Edit action', () => {
    expect(DETAIL).toContain("from '@/components/godui/drawer'");
    expect(DETAIL).toContain('<Drawer');
    expect(DETAIL).toContain('onEdit');
    expect(DETAIL).toContain('<Pencil1Icon');
    expect(DETAIL).toContain('Edit');
  });

  it('shows the task fields the brief asked for', () => {
    for (const label of ['Due', 'List', 'Priority', 'Tags', 'Notes', 'Subtasks']) {
      expect(DETAIL).toContain(label);
    }
    expect(DETAIL).toContain('dueLabel(task, zone, timeFormat)');
    expect(DETAIL).toContain('priorityLabel(task.priority)');
    expect(DETAIL).toContain('task.notes');
    expect(DETAIL).toContain('subtasks.map');
  });

  it('shows the event fields the brief asked for', () => {
    // The date joined the time so an event on another day is not just a clock
    // reading: 09:00 next month and 09:00 today read the same without it.
    for (const label of ['Date', 'Time', 'Calendar', 'Location']) {
      expect(DETAIL).toContain(label);
    }
    expect(DETAIL).toContain('formatTime(event.startMs');
    expect(DETAIL).toContain('relativeDayLabel(toDateOnly(event.startMs, zone), zone)');
    expect(DETAIL).toContain('calendarName');
    expect(DETAIL).toContain('event.location');
  });

  it('is reachable for the calendar to reuse rather than copy', () => {
    expect(INDEX).toContain("export { ItemDetailSheet, type ItemDetailSheetProps } from './ItemDetailSheet'");
  });
});

describe('completing a task offers an inline Undo, not a toast', () => {
  it('shows the left-edge Undo for a one-off task on both task screens', () => {
    for (const view of [VIEW, TODAY]) {
      expect(view).toContain('<CompletionUndo');
      expect(view).toContain('onUndo={undoCompletion}');
      // Undo runs the completion endpoint in reverse on the same task.
      expect(view).toContain('actions.complete(task, true)');
      // A recurring task rolls forward rather than completing, so it gets no
      // Undo — the server cannot cleanly restore its advanced due date. The
      // local rule suppresses it at once, and the payload's `recurred` flag
      // takes it back down if the server rolls it forward anyway.
      expect(view).toContain('if (undo || task.recurrenceRule) return;');
      expect(view).toContain('result?.recurred');
      // The old full toast is gone from the completion path.
      expect(view).not.toContain("title: 'Task completed'");
    }
  });
});

describe('a mirrored item loses its Edit action', () => {
  it('reads the flag off the event projection', () => {
    // The calendar record's `readOnly` is projected onto the `CalendarItem` as
    // `readonly`, so the sheet needs no calendar lookup; the explicit prop from
    // the caller wins when there is one.
    expect(DETAIL).toContain('readOnly ?? (event ? Boolean(event.readonly) : false)');
  });

  it('removes the action rather than disabling it', () => {
    // A dead button that can never be enabled is worse than no button.
    expect(DETAIL).toContain('{isReadOnly ? null : (');
    expect(DETAIL).not.toMatch(/<Button[^>]*disabled/);
    expect(DETAIL).toContain('<Pencil1Icon');
    expect(DETAIL).toContain('Edit');
  });

  it('does not explain the absence with a notice', () => {
    // The muted "Synced from a read-only calendar" line and its lock icon were
    // removed; only the Edit action goes.
    expect(DETAIL).not.toContain('cannot be edited here');
    expect(DETAIL).not.toContain('LockClosedIcon');
    expect(DETAIL).not.toContain('lock-closed');
  });

  it('leaves the task list editable — a task carries no read-only flag', () => {
    // The flag is derived from `event` alone, so a task passed by TasksView or
    // TodayView (no `readOnly` prop) always keeps its Edit action.
    expect(DETAIL).toContain('<TaskDetails');
    expect(DETAIL).toContain('onEdit');
  });
});

describe('a description renders its URLs as anchors', () => {
  it('splits the description through the linkify helper', () => {
    expect(DETAIL).toContain("from '@/lib/linkify'");
    expect(DETAIL).toContain('linkify(text)');
    expect(DETAIL).toContain('<LinkifiedDescription text={detail.description} />');
  });

  it('opens a link safely in a new tab', () => {
    expect(DETAIL).toContain('target="_blank"');
    expect(DETAIL).toContain('rel="noopener noreferrer"');
  });
});

describe('the sheet shows every populated field', () => {
  it('reads the full event for what the thin projection drops', () => {
    expect(DETAIL).toContain('useResource<CalendarEvent>');
    expect(DETAIL).toContain('/api/events/${event.id}');
  });

  it('renders the extra task fields, each conditionally', () => {
    for (const label of ['Starts', 'Status', 'Repeats', 'Reminders', 'Estimate', 'Time spent']) {
      expect(DETAIL).toContain(label);
    }
    expect(DETAIL).toContain('describeRRule');
    expect(DETAIL).toContain('describeReminders');
    expect(DETAIL).toContain('humanDuration');
  });

  it('renders the extra event fields, each conditionally', () => {
    for (const label of ['Attendees', 'Organizer', 'Categories', 'Description', 'Availability']) {
      expect(DETAIL).toContain(label);
    }
    expect(DETAIL).toContain('detail?.attendees');
    expect(DETAIL).toContain('detail?.description');
    expect(DETAIL).toContain('detail?.rrule');
    expect(DETAIL).toContain('attendeeStatusLabel');
  });
});

describe('the editor does not steal focus on the edit path', () => {
  it('cancels the deferred autofocus without removing the focus machinery', () => {
    expect(EDITOR).toContain('onOpenAutoFocus={(event) => event.preventDefault()}');
    // The date popover still focuses its own calendar when it opens.
    expect(EDITOR).toContain('autoFocus');
  });

  it('leaves quick add’s same-task focus alone', () => {
    // Quick add must keep its layout-effect focus and its cancelled Radix
    // autofocus, in the tap's own task.
    expect(QUICK_ADD).toContain('useLayoutEffect');
    expect(QUICK_ADD).toContain('onOpenAutoFocus');
    expect(QUICK_ADD).toContain('event.preventDefault();');
    expect(QUICK_ADD).toContain('inputRef.current?.focus({ preventScroll: true })');
  });
});
