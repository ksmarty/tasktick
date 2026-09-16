/**
 * The second line of a task row.
 *
 * Everything shown here is derived: the due date only appears when the task has
 * one, its colour carries the urgency, and the glyphs (repeat, pin, subtask
 * progress) are the row's only signal that a task is not a plain one-liner.
 */
import { Flag, ListChecks, Pin, Repeat } from 'lucide-react';
import { Chip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatTime, isOverdue, relativeDayLabel, taskDay, todayIn } from '@/lib/dates';
import type { Task } from '@/lib/types';
import { priorityLabel, priorityTextClass } from './priority';

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

export interface TaskMetaProps {
  task: Task;
  zone: string;
  timeFormat: '12h' | '24h';
  /** Shown when the row is not already scoped to one list. */
  listName?: string | null;
  className?: string;
}

export function TaskMeta({ task, zone, timeFormat, listName, className }: TaskMetaProps) {
  const due = dueLabel(task, zone, timeFormat);
  const subtasks = task.subtasks ?? [];
  const doneSubtasks = subtasks.filter((subtask) => subtask.status === 'completed').length;
  const tags = task.tags ?? [];

  const hasAnything = Boolean(
    due || task.priority !== 'none' || tags.length || task.recurrenceRule || subtasks.length || task.isPinned || listName,
  );
  if (!hasAnything) return null;

  return (
    <span className={cn('mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-footnote', className)}>
      {due ? <span className={cn('tnum shrink-0', TONE_CLASS[due.tone])}>{due.label}</span> : null}

      {task.priority !== 'none' ? (
        <span className={cn('inline-flex shrink-0 items-center', priorityTextClass(task.priority))}>
          <Flag className="size-3.5" aria-hidden />
          <span className="sr-only">{priorityLabel(task.priority)} priority</span>
        </span>
      ) : null}

      {listName ? <span className="max-w-32 shrink-0 truncate text-secondary">{listName}</span> : null}

      {task.recurrenceRule ? (
        <span className="inline-flex shrink-0 items-center text-secondary">
          <Repeat className="size-3.5" aria-hidden />
          <span className="sr-only">Repeating</span>
        </span>
      ) : null}

      {subtasks.length ? (
        <span className="tnum inline-flex shrink-0 items-center gap-1 text-secondary">
          <ListChecks className="size-3.5" aria-hidden />
          {doneSubtasks}/{subtasks.length}
          <span className="sr-only">subtasks done</span>
        </span>
      ) : null}

      {tags.map((tag) => (
        <Chip key={tag.id} color={tag.color} size="sm">
          #{tag.name}
        </Chip>
      ))}

      {task.isPinned ? (
        <span className="inline-flex shrink-0 items-center text-tint">
          <Pin className="size-3.5" aria-hidden />
          <span className="sr-only">Pinned</span>
        </span>
      ) : null}
    </span>
  );
}
