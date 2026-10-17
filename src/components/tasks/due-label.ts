/**
 * The due-date label a task row carries, and the tone that colours it.
 *
 * Pure and separate from `TaskMeta` so the two things that can be wrong — the
 * section-aware format and the overdue/today tone — are unit-tested without a
 * DOM (the repo runs vitest in node with no jsdom, so a `.tsx` module cannot be
 * imported there).
 *
 * The label has three shapes, chosen by the section the row is in:
 *
 *  - **Inside Today** (`relative`): the relative day plus the clock time, e.g.
 *    `Today 17:00` — or the span it occupies when it has two, e.g.
 *    `Today 09:00 – 11:00`. The row is due now, so the time is what the user acts
 *    on, and a task with a start and a due occupies a span exactly as an event
 *    does.
 *  - **Inside Tomorrow** (`clock`): the clock time alone — the span it occupies
 *    when it has two, e.g. `09:00 – 10:00` — or `All day`. The section header has
 *    already named the day, and repeating it in every row spends the row's one
 *    trailing slot on the thing the header gave away. *When* is what is left.
 *  - **Anywhere else** (`absolute`): the absolute day, e.g. `Tue Sep 30`. Under
 *    "Next 7 days" or "Later" the day is the discriminator, and a clock time
 *    three weeks out reads the same as one tomorrow morning.
 *
 * The tone is independent of the format, so an overdue date stays destructive
 * whichever shape it takes.
 */
import {
  dropZeroMinutes,
  formatDayMonth,
  formatTime,
  fromDateOnly,
  isOverdue,
  relativeDayLabel,
  taskDay,
  todayIn,
  type FormatPrefs,
} from '@/lib/dates';
import type { DateOnly, Millis, Task } from '@/lib/types';

export type DueTone = 'danger' | 'tint' | 'secondary';

/**
 * Which shape the trailing label takes.
 *
 * Decided by the section, and derived in one place (`TaskListSection`) rather
 * than passed in by each screen: a screen that forgot would silently show a
 * date under a header that already says it.
 */
export type DueFormat = 'relative' | 'clock' | 'absolute';

export interface DueLabel {
  label: string;
  tone: DueTone;
  /** The floating day the label refers to. */
  day: string;
}

/** The task fields the label derives from. */
export type DueLabelTask = Pick<
  Task,
  'dueAtMs' | 'dueDate' | 'startAtMs' | 'startDate' | 'status' | 'isAllDay'
>;

/**
 * `All day`, a clock time, or the span between two of them.
 *
 * The shape both row kinds share when their section has already named the day,
 * which is why it is here rather than in either row: a task with a start and a
 * due reads as a span exactly as an event does, one with only a due reads as a
 * time, and anything with no clock time at all reads as `All day`.
 *
 * `options.joiner` is the visible en dash by default. The accessible name passes
 * `to`, because a screen reader announces a dash as punctuation and
 * "09:00 to 10:00" is what a person says — the same split `DayAgenda` makes.
 *
 * `options.compact` drops a whole hour's `:00` (the `compactTimes` setting), so
 * a 09:00 task reads `09` and a 09:30 one still reads `09:30`.
 */
export function clockLabel(
  item: { startMs: Millis | null; endMs: Millis | null; isAllDay: boolean },
  prefs: FormatPrefs,
  options: ClockLabelOptions = {},
): string {
  const { joiner = '–', compact = false } = options;
  const clock = (instantMs: Millis): string => {
    const text = formatTime(instantMs, prefs);
    return compact ? dropZeroMinutes(text) : text;
  };

  if (item.isAllDay || item.startMs === null) return 'All day';
  const start = clock(item.startMs);
  // A zero-length item is a time, not a span of no length.
  if (item.endMs === null || item.endMs <= item.startMs) return start;
  return `${start} ${joiner} ${clock(item.endMs)}`;
}

/** How a `clock`-shaped label is spelled. */
export interface ClockLabelOptions {
  /** Separator between two times; `to` for a label a screen reader will speak. */
  joiner?: string;
  /** Drop a whole hour's `:00` — see `dropZeroMinutes`. */
  compact?: boolean;
}

/** The `clock` shape for a task: its own span, its due time, or `All day`. */
export function taskClockLabel(
  task: Pick<DueLabelTask, 'startAtMs' | 'dueAtMs' | 'isAllDay'>,
  prefs: FormatPrefs,
  options: ClockLabelOptions = {},
): string {
  return clockLabel(
    {
      // A task's start is only meaningful next to its due date, so the pair is
      // read as a span when both exist and as a single time otherwise.
      startMs: task.startAtMs ?? task.dueAtMs,
      endMs: task.startAtMs === null ? null : task.dueAtMs,
      isAllDay: task.isAllDay,
    },
    prefs,
    options,
  );
}

/**
 * The clock part of a task's label as a prefixed fragment — ` 09:00 – 11:00` —
 * or nothing at all when the task has no clock time.
 *
 * `taskClockLabel` answers `All day` for that case, which is what the Tomorrow
 * shape wants: its header has already named the day, so "All day" is the only
 * thing left to say. The relative shape reads "Today" already, and "Today All
 * day" would say the same thing twice — so it asks for nothing instead.
 */
function taskClockSuffix(
  task: Pick<DueLabelTask, 'startAtMs' | 'dueAtMs' | 'isAllDay'>,
  prefs: FormatPrefs,
  compact: boolean,
): string {
  if (task.isAllDay || (task.startAtMs === null && task.dueAtMs === null)) return '';
  return ` ${taskClockLabel(task, prefs, { compact })}`;
}

/**
 * The absolute day a row outside the Today section carries: `Tue Sep 30`.
 *
 * The year is added only when it is not the current one (`Tue Sep 30 2026`),
 * so a date that crosses a new year is unambiguous without every ordinary date
 * carrying four extra digits. The spelling itself lives in `formatDayMonth`,
 * next to the rest of the date convention.
 */
export function absoluteDayLabel(day: DateOnly, zone: string): string {
  const target = fromDateOnly(day, zone);
  const today = fromDateOnly(todayIn(zone), zone);
  return formatDayMonth(target, today);
}

/**
 * "Today 17:00", "09:00 – 10:00", "Thu 22 May" — plus the colour that tells the
 * user whether it is late, due now, or simply scheduled.
 *
 * `format` is the shape; see `DueFormat`. The caller passes it from the section
 * it is rendering (`TaskListSection`). `compact` drops a whole hour's `:00` from
 * whichever shape carries a clock time — the `compactTimes` setting.
 */
export function dueLabel(
  task: DueLabelTask,
  zone: string,
  timeFormat: '12h' | '24h',
  format: DueFormat = 'relative',
  compact = false,
): DueLabel | null {
  const day = taskDay(task, zone);
  if (!day) return null;

  const overdue = isOverdue(task, zone);
  const dueToday = !overdue && day === todayIn(zone);
  const prefs: FormatPrefs = { zone, timeFormat, weekStartsOn: 0 };

  return {
    label:
      format === 'absolute'
        ? absoluteDayLabel(day, zone)
        : format === 'clock'
          ? taskClockLabel(task, prefs, { compact })
          : `${relativeDayLabel(day, zone)}${taskClockSuffix(task, prefs, compact)}`,
    tone: overdue ? 'danger' : dueToday ? 'tint' : 'secondary',
    day,
  };
}
