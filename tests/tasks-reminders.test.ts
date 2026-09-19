/**
 * Multiple reminders per task.
 *
 * This pins the contract that already ships: reminders are a *list*, end to end.
 * The picker is a multi-select (each offset is a `role="checkbox"`), the editor
 * sends the whole selection as an array, and the API schema accepts an array of
 * up to twenty. The server stores one row per reminder in `task_reminders`, so a
 * task with three reminders has three rows and the read hydrates them back into
 * `task.reminders`.
 *
 * The client components cannot be rendered in node, so the UI side is pinned
 * from source; the schema side is exercised directly.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { createTaskSchema, reminderInput, updateTaskSchema } from '@/lib/schemas';

function source(relative: string): string {
  return readFileSync(new URL(`../src/components/tasks/${relative}`, import.meta.url), 'utf8');
}

const PICKER = source('ReminderPicker.tsx');
const EDITOR = source('TaskEditorSheet.tsx');

describe('the API accepts more than one reminder', () => {
  const three = [
    { offsetMinutes: -60 },
    { offsetMinutes: -15 },
    { offsetMinutes: 0 },
  ];

  it('accepts an array of reminders on create and update', () => {
    expect(createTaskSchema.parse({ title: 'Call', reminders: three }).reminders).toHaveLength(3);
    expect(updateTaskSchema.parse({ reminders: three }).reminders).toHaveLength(3);
  });

  it('accepts an absolute reminder alongside a relative one', () => {
    const parsed = reminderInput.parse({ offsetMinutes: null, absoluteAtMs: 1_700_000_000_000 });
    expect(parsed.absoluteAtMs).toBe(1_700_000_000_000);
  });

  it('has a clear flag so the list can be emptied', () => {
    expect(updateTaskSchema.parse({ clearReminders: true }).clearReminders).toBe(true);
  });

  it('caps the list at twenty rather than accepting an unbounded array', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({ offsetMinutes: -i }));
    expect(createTaskSchema.safeParse({ title: 'Too many', reminders: many }).success).toBe(false);
  });
});

describe('the reminder picker is multi-select', () => {
  it('offers the preset offsets as checkboxes, not radios', () => {
    expect(PICKER).toContain('role="checkbox"');
    expect(PICKER).toContain('aria-checked={selected}');
    expect(PICKER).not.toContain('role="radio"');
  });

  it('adds and removes several offsets at once', () => {
    // A selected offset is filtered out; an unselected one is appended.
    expect(PICKER).toContain('value.filter((item) => item !== offset)');
    expect(PICKER).toContain('[...value, offset]');
    expect(PICKER).toContain('export function ReminderPicker');
  });

  it('summarises every selected offset on the editor row', () => {
    expect(PICKER).toContain('export function describeReminders');
    expect(PICKER).toContain(".join(', ')");
    expect(EDITOR).toContain('describeReminders(reminderOffsets)');
  });
});

describe('the editor round-trips the whole list', () => {
  it('sends every selected offset as an array', () => {
    expect(EDITOR).toContain('reminders: offsets.map((offsetMinutes) => ({ offsetMinutes }))');
  });

  it('clears the list when the last offset is removed', () => {
    expect(EDITOR).toContain('clearReminders: offsets.length === 0');
  });

  it('reads the stored list back into the picker', () => {
    expect(EDITOR).toContain('task?.reminders ?? []');
    expect(EDITOR).toContain('draft.reminders !== undefined');
  });

  it('opens the multi-select picker from the Reminder row', () => {
    expect(EDITOR).toContain("title=\"Reminder\"");
    expect(EDITOR).toContain("onClick={() => setPicker('reminder')}");
    expect(EDITOR).toContain('<ReminderPicker');
  });
});
