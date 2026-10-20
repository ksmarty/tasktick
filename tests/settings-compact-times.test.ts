/**
 * `compactTimes` — a whole hour's minutes dropped from the times on the task
 * list — and the five-minute choices every time picker offers.
 *
 * Both are small, and both are the kind of thing that decays quietly: a label
 * that stops compacting still renders, and a picker that steps by a minute still
 * works, so neither shows up as a failure anywhere. The pure half is checked
 * directly; the half that is only wiring is pinned as source.
 *
 * The setting is on by default and lives on `user_settings.compact_times`, so
 * the chain below is the one every user setting walks: the type, the zod patch,
 * both dialect schemas, a migration per dialect, the repo's defaults and patch,
 * the GraphQL SDL, and the settings row.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dropZeroMinutes, TIME_INPUT_STEP_SECONDS } from '@/lib/dates';
import { clockLabel, dueLabel, taskClockLabel } from '@/components/tasks/due-label';

const ROOT = new URL('..', import.meta.url);
const source = (relative: string): string => readFileSync(new URL(relative, ROOT), 'utf8');

const DATES = source('src/lib/dates.ts');
const TYPES = source('src/lib/types.ts');
const SCHEMAS = source('src/lib/schemas.ts');
const SQLITE = source('src/server/db/schema.sqlite.ts');
const PG = source('src/server/db/schema.pg.ts');
const REPO = source('src/server/repos/settings.ts');
const GRAPHQL = source('src/server/graphql/schema.ts');
const SETTINGS_UI = source('src/components/settings/DateTimeSettings.tsx');
const SECTION = source('src/components/tasks/TaskListSection.tsx');
const ROW = source('src/components/tasks/TaskRow.tsx');
const EVENT_ROW = source('src/components/tasks/EventRow.tsx');
const META = source('src/components/tasks/TaskMeta.tsx');
const TASKS_VIEW = source('src/components/tasks/TasksView.tsx');
const TODAY_VIEW = source('src/components/tasks/TodayView.tsx');
const EVENT_EDITOR = source('src/components/calendar/EventEditorSheet.tsx');
const TASK_EDITOR = source('src/components/tasks/TaskEditorSheet.tsx');
const MATRIX_SHEET = source('src/app/(app)/matrix/MatrixTaskSheet.tsx');
const HABIT_EDITOR = source('src/components/habits/HabitEditorSheet.tsx');
const PICKER = source('src/components/time/TimeField.tsx');

/** Every `.sql` migration in a dialect's directory, concatenated. */
const migrations = (dialect: 'sqlite' | 'pg'): string =>
  readdirSync(new URL(`drizzle/${dialect}`, ROOT))
    .filter((name) => name.endsWith('.sql'))
    .map((name) => readFileSync(new URL(`drizzle/${dialect}/${name}`, ROOT), 'utf8'))
    .join('\n');

const ZONE = 'utc';
const PREFS = { zone: ZONE, timeFormat: '24h', weekStartsOn: 0 } as const;

type DueTask = Parameters<typeof dueLabel>[0];

function task(patch: Partial<DueTask> = {}): DueTask {
  return {
    dueAtMs: null,
    dueDate: null,
    startAtMs: null,
    startDate: null,
    status: 'todo',
    isAllDay: true,
    ...patch,
  };
}

describe('dropZeroMinutes', () => {
  it('drops the minutes from a time that is on the hour', () => {
    expect(dropZeroMinutes('09:00')).toBe('09');
    expect(dropZeroMinutes('17:00')).toBe('17');
  });

  it('keeps the minutes of a time that has any', () => {
    expect(dropZeroMinutes('09:30')).toBe('09:30');
    expect(dropZeroMinutes('17:05')).toBe('17:05');
  });

  it('handles the 12-hour form, where the hour is followed by a space', () => {
    expect(dropZeroMinutes('5:00 PM')).toBe('5 PM');
    expect(dropZeroMinutes('5:30 PM')).toBe('5:30 PM');
    expect(dropZeroMinutes('12:00 AM')).toBe('12 AM');
  });

  it('leaves anything that is not a clock time alone', () => {
    expect(dropZeroMinutes('All day')).toBe('All day');
    expect(dropZeroMinutes('')).toBe('');
  });
});

describe('the compact shape of a label', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-05-12T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('compacts a whole hour and leaves a half hour alone', () => {
    const onTheHour = task({ dueAtMs: Date.parse('2025-05-13T09:00:00Z'), isAllDay: false });
    const halfPast = task({ dueAtMs: Date.parse('2025-05-13T09:30:00Z'), isAllDay: false });

    expect(dueLabel(onTheHour, ZONE, '24h', 'clock', true)?.label).toBe('09');
    expect(dueLabel(halfPast, ZONE, '24h', 'clock', true)?.label).toBe('09:30');
  });

  it('compacts inside Today too, where the relative day stays', () => {
    const today = task({ dueAtMs: Date.parse('2025-05-12T17:00:00Z'), isAllDay: false });

    expect(dueLabel(today, ZONE, '24h', 'relative', true)?.label).toBe('Today 17');
    expect(dueLabel(today, ZONE, '24h', 'relative', false)?.label).toBe('Today 17:00');
  });

  it('compacts both ends of a span inside Today', () => {
    const span = task({
      startAtMs: Date.parse('2025-05-12T09:00:00Z'),
      dueAtMs: Date.parse('2025-05-12T11:30:00Z'),
      isAllDay: false,
    });

    expect(dueLabel(span, ZONE, '24h', 'relative', true)?.label).toBe('Today 09 – 11:30');
    expect(dueLabel(span, ZONE, '24h', 'relative', false)?.label).toBe('Today 09:00 – 11:30');
  });

  it('compacts both ends of a span, and neither when the setting is off', () => {
    const span = { startMs: Date.parse('2025-05-13T09:00:00Z'), endMs: Date.parse('2025-05-13T11:00:00Z'), isAllDay: false };

    expect(clockLabel(span, PREFS, { compact: true })).toBe('09 – 11');
    expect(clockLabel(span, PREFS, { compact: false })).toBe('09:00 – 11:00');
    // A span with minutes at either end keeps them.
    expect(
      clockLabel({ ...span, startMs: Date.parse('2025-05-13T09:15:00Z') }, PREFS, { compact: true }),
    ).toBe('09:15 – 11');
  });

  it('keeps the spoken joiner while compacting', () => {
    const span = { startMs: Date.parse('2025-05-13T09:00:00Z'), endMs: Date.parse('2025-05-13T10:30:00Z'), isAllDay: false };
    expect(clockLabel(span, PREFS, { joiner: 'to', compact: true })).toBe('09 to 10:30');
  });

  it('still reads "All day" for an all-day item', () => {
    expect(clockLabel({ startMs: Date.parse('2025-05-13T00:00:00Z'), endMs: null, isAllDay: true }, PREFS, { compact: true })).toBe(
      'All day',
    );
    expect(taskClockLabel({ startAtMs: null, dueAtMs: null, isAllDay: true }, PREFS, { compact: true })).toBe('All day');
  });

  it('compacts a task’s own span and single time', () => {
    expect(
      taskClockLabel(
        { startAtMs: Date.parse('2025-05-13T09:00:00Z'), dueAtMs: Date.parse('2025-05-13T11:00:00Z'), isAllDay: false },
        PREFS,
        { compact: true },
      ),
    ).toBe('09 – 11');
    expect(taskClockLabel({ startAtMs: null, dueAtMs: Date.parse('2025-05-13T17:00:00Z'), isAllDay: false }, PREFS, { compact: true })).toBe(
      '17',
    );
  });

  it('is off by default, so an ordinary label is unchanged', () => {
    const span = { startMs: Date.parse('2025-05-13T09:00:00Z'), endMs: null, isAllDay: false };
    expect(clockLabel(span, PREFS)).toBe('09:00');
    expect(taskClockLabel({ startAtMs: null, dueAtMs: null, isAllDay: true }, PREFS)).toBe('All day');
  });
});

describe('the setting travels the whole chain', () => {
  it('is declared as a boolean on the settings type and its patch', () => {
    expect(TYPES).toContain('compactTimes: boolean;');
    expect(SCHEMAS).toContain('compactTimes: z.boolean().optional(),');
  });

  it('exists in both dialects, so the parity contract holds', () => {
    expect(SQLITE).toContain("compactTimes: integer('compact_times', { mode: 'boolean' }).notNull().default(true),");
    expect(PG).toContain("compactTimes: boolean('compact_times').notNull().default(true),");
  });

  it('has a migration in each dialect', () => {
    expect(migrations('sqlite')).toContain('compact_times');
    expect(migrations('pg')).toContain('compact_times');
  });

  it('defaults on in the repo, and is patchable', () => {
    expect(REPO).toContain('compactTimes: true,');
    expect(REPO).toContain('compactTimes: row.compactTimes,');
    expect(REPO).toContain('if (input.compactTimes !== undefined) patch.compactTimes = input.compactTimes;');
  });

  it('is exposed over GraphQL, which is what the settings form reads', () => {
    expect(GRAPHQL).toContain('compactTimes: Boolean!');
    expect(GRAPHQL).toContain('compactTimes: Boolean');
  });

  it('has a switch in the date-and-time settings', () => {
    expect(SETTINGS_UI).toContain('id="settings-compact-times"');
    expect(SETTINGS_UI).toContain('compactTimes: next');
    expect(SETTINGS_UI).toContain('<Switch');
  });
});

describe('the rows are told the setting, and default to on', () => {
  it('is read from the bootstrap by the screens that render a section', () => {
    // On unless the user turned it off: `?? true`, not `?? false`. A bootstrap
    // that has not arrived yet must not flip the label's shape.
    for (const view of [TASKS_VIEW, TODAY_VIEW]) {
      expect(view).toContain('const compactTimes = data?.settings.compactTimes ?? true;');
      expect(view).toContain('compactTimes={compactTimes}');
    }
  });

  it('is passed down through the section to both row shapes', () => {
    expect(SECTION).toContain('compactTimes?: boolean;');
    expect(SECTION).toContain('compact={compactTimes}');
    expect(ROW).toContain('compact={compact}');
    expect(EVENT_ROW).toContain('compact');
  });

  it('reaches the pure label through DueDateLabel', () => {
    expect(META).toContain('dueLabel(task, zone, timeFormat, format, compact)');
  });

  it('keeps the accessible name spoken while the visible one is compacted', () => {
    // The event row passes both, and they are independent: "09 to 11" is what a
    // screen reader should say, "09 – 11" is what the row draws.
    expect(EVENT_ROW).toContain("{ joiner: 'to', compact }");
  });
});

describe('every time picker offers five minutes', () => {
  it('is one constant, so the control and the labels cannot disagree', () => {
    expect(TIME_INPUT_STEP_SECONDS).toBe(300);
    expect(DATES).toContain('export const TIME_INPUT_STEP_SECONDS = 300;');
  });

  it('is one native time field, stepped to five minutes', () => {
    /*
     * This control was two selects — an hour and a minute, built from
     * `TIME_INPUT_STEP_SECONDS` — because Safari on iOS ignores `step` on
     * `<input type="time">` and listed all sixty minutes. Two boxes for one time
     * turned out to be the worse trade: they read as two fields, they take two
     * taps, and the native wheel is what people expect under their thumb. So it is
     * one field again, with `step` for the platforms that honour it and the
     * platform's own wheel for the ones that do not. `TIME_INPUT_STEP_SECONDS` is
     * still the single source of the step.
     */
    expect(PICKER).toContain('type="time"');
    expect(PICKER).toContain('step={TIME_INPUT_STEP_SECONDS}');
    expect(PICKER).not.toContain('GRID_MINUTES');
    // One control, so no second one to disagree with it.
    expect(PICKER.match(/<Input\b/g)).toHaveLength(1);
    for (const sheet of [EVENT_EDITOR, TASK_EDITOR, MATRIX_SHEET, HABIT_EDITOR]) {
      expect(sheet).toContain('TimePicker');
    }
  });

  it('passes the stored value straight through, so opening an editor never rewrites a time', () => {
    // An event made before this control existed, or synced from another calendar,
    // can sit on any minute; a controlled field shows it unchanged rather than
    // rounding it to the nearest five.
    expect(PICKER).toContain('value={value}');
    expect(PICKER).not.toContain('includes(current)');
  });

  it('emits `HH:mm`, the string every caller already converted', () => {
    // The browser formats the wheel; the value it reports is already `HH:mm`.
    expect(PICKER).toContain('onChange(event.target.value)');
  });

  it('is no longer the quarter hour the event editor alone used', () => {
    expect(EVENT_EDITOR).not.toContain('step={900}');
  });
});
