/**
 * The second line of a task row.
 *
 * Everything shown here is derived: priority, repeat, subtask progress and tags.
 * The glyphs are the row's only signal that a task is not a plain one-liner. The
 * pin is not here — it is a deliberate mark on the task itself, so it sits beside
 * the title (see `TaskRow`).
 *
 * The list name used to lead this line. It is gone: the card's coloured edge
 * already says which list a row belongs to, so naming it again was duplication —
 * and it was the one item that could shrink a tag chip to make room for itself.
 *
 * The due date used to lead this line. It now lives at the row's trailing edge
 * (see `DueDateLabel`), because it is the one datum that has to keep its
 * position while the title and this line take whatever width is left.
 *
 * ## One line, one glyph size
 *
 * The line is a single non-wrapping row: it never grows to two lines, so every
 * row's meta is the same height and the list keeps a steady rhythm. When it runs
 * out of room the *meta* ellipsises — the tag chips are the only items that may
 * shrink — because the title above it always outranks it.
 *
 * Every glyph is the same 12px, drawn against the 13px caption it sits in. The
 * icons used to be a mix of 14px lucide defaults, which made the priority flag
 * louder than the words beside it; the flag is now a small filled mark whose
 * height matches the text's cap height rather than a full-size outline icon.
 */
import { Flag, ListChecks, Repeat } from 'lucide-react';
import { Chip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatTime, isOverdue, relativeDayLabel, taskDay, todayIn } from '@/lib/dates';
import type { Task } from '@/lib/types';
import { priorityLabel, priorityTextClass } from './priority';

/** The one icon size for the whole meta line, and the stroke that suits it. */
const META_ICON = 'size-3';
const META_ICON_STROKE = 2.25;

export type DueTone = 'danger' | 'tint' | 'secondary';

export interface DueLabel {
  label: string;
  tone: DueTone;
  /** The floating day the label refers to. */
  day: string;
}

const TONE_CLASS: Record<DueTone, string> = {
  danger: 'text-danger',
  tint: 'text-tint',
  secondary: 'text-secondary',
};

/**
 * "Today 17:00", "Yesterday", "Thu 22 May" — plus the colour that tells the user
 * whether it is late, due now, or simply scheduled.
 */
export function dueLabel(
  task: Pick<Task, 'dueAtMs' | 'dueDate' | 'startAtMs' | 'startDate' | 'status' | 'isAllDay'>,
  zone: string,
  timeFormat: '12h' | '24h',
): DueLabel | null {
  const day = taskDay(task, zone);
  if (!day) return null;

  const overdue = isOverdue(task, zone);
  const today = !overdue && day === todayIn(zone);
  const withTime = task.dueAtMs !== null && !task.isAllDay;
  const time = withTime
    ? ` ${formatTime(task.dueAtMs as number, { zone, timeFormat, weekStartsOn: 0 })}`
    : '';

  return {
    label: `${relativeDayLabel(day, zone)}${time}`,
    tone: overdue ? 'danger' : today ? 'tint' : 'secondary',
    day,
  };
}

export interface DueDateLabelProps {
  task: Task;
  zone: string;
  timeFormat: '12h' | '24h';
  className?: string;
}

/**
 * The due date, as the row's right-aligned trailing label.
 *
 * Fixed-width and non-shrinking on purpose: keeping its exact position is what
 * lets the title and the meta line claim the remaining width, so the title never
 * ellipsises to make room for a date. `whitespace-nowrap` matters because the
 * label carries a space ("Today 13:00") that must not become a line break.
 *
 * The tone is unchanged from when it led the meta line, so an overdue date is
 * still red and today's is still tinted.
 */
export function DueDateLabel({ task, zone, timeFormat, className }: DueDateLabelProps) {
  const due = dueLabel(task, zone, timeFormat);
  if (!due) return null;

  return (
    <span
      className={cn('tnum shrink-0 whitespace-nowrap text-footnote', TONE_CLASS[due.tone], className)}
    >
      {due.label}
    </span>
  );
}

export interface TaskMetaProps {
  task: Task;
  className?: string;
}

export function TaskMeta({ task, className }: TaskMetaProps) {
  const subtasks = task.subtasks ?? [];
  const doneSubtasks = subtasks.filter((subtask) => subtask.status === 'completed').length;
  const tags = task.tags ?? [];

  const hasAnything = Boolean(
    task.priority !== 'none' || tags.length || task.recurrenceRule || subtasks.length,
  );
  if (!hasAnything) return null;

  return (
    <span
      className={cn(
        'mt-0.5 flex h-5 w-full min-w-0 items-center gap-x-2 overflow-hidden whitespace-nowrap text-footnote',
        className,
      )}
    >
      {task.priority !== 'none' ? (
        <span className={cn('inline-flex shrink-0 items-center', priorityTextClass(task.priority))}>
          <Flag className={cn(META_ICON, 'fill-current')} strokeWidth={META_ICON_STROKE} aria-hidden />
          <span className="sr-only">{priorityLabel(task.priority)} priority</span>
        </span>
      ) : null}

      {task.recurrenceRule ? (
        <span className="inline-flex shrink-0 items-center text-secondary">
          <Repeat className={META_ICON} strokeWidth={META_ICON_STROKE} aria-hidden />
          <span className="sr-only">Repeating</span>
        </span>
      ) : null}

      {subtasks.length ? (
        <span className="tnum inline-flex shrink-0 items-center gap-1 text-secondary">
          <ListChecks className={META_ICON} strokeWidth={META_ICON_STROKE} aria-hidden />
          {doneSubtasks}/{subtasks.length}
          <span className="sr-only">subtasks done</span>
        </span>
      ) : null}

      {tags.map((tag) => (
        <Chip key={tag.id} color={tag.color} size="sm" className="h-5 min-w-0">
          #{tag.name}
        </Chip>
      ))}
    </span>
  );
}
