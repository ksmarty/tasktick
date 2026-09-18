/**
 * The second line of a task row.
 *
 * Everything shown here is derived: priority, repeat, subtask progress and tags.
 * The glyphs are the row's only signal that a task is not a plain one-liner. The
 * pin is not here — it is a deliberate mark on the task itself, so it sits beside
 * the title (see `TaskRow`).
 *
 * The list name used to lead this line. It is gone: the card's coloured edge
 * already says which list a row belongs to, so naming it again was duplication.
 *
 * The due date does not lead this line either: it lives at the row's trailing
 * edge (see `DueDateLabel`), because it is the one datum that has to keep its
 * position while the title and this line take whatever width is left.
 *
 * ## One line, one glyph size
 *
 * The line is a single non-wrapping row: it never grows to two lines, so every
 * row's meta is the same height and the list keeps a steady rhythm. When it runs
 * out of room the *meta* ellipsises — the tag chips are the only items that may
 * shrink — because the title above it always outranks it.
 *
 * ## Sizing and colour without `sx`
 *
 * `@svg-animated-icons/react` sizes each glyph with `width: 1em; height: 1em` in
 * a stylesheet it injects itself, so a `size-*` utility would be fighting that
 * rule. The size is therefore set the way the icon expects — through the font
 * size (`text-sm`, Tailwind's scale) — which is also why one class switches the
 * whole line's glyphs at once.
 *
 * Colours come from `priority.ts` (a monochrome class per priority) and from the
 * theme's muted foreground. Tag colours are user data rather than theme tokens,
 * so they survive as a small dot inside an otherwise monochrome chip: the tag's
 * name is its identity, and spending a full coloured pill and border on it made
 * the meta line busier than the title above it.
 */
import { LightningBoltIcon } from '@svg-animated-icons/react/lightning-bolt';
import { LoopIcon } from '@svg-animated-icons/react/loop';
import { Half1Icon } from '@svg-animated-icons/react/half-1';
import { accentHex } from '@/lib/colors';
import { formatTime, isOverdue, relativeDayLabel, taskDay, todayIn } from '@/lib/dates';
import type { Task } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { priorityColor, priorityLabel } from './priority';

/** The one glyph size for the whole meta line. */
const META_GLYPH = 'text-sm';

export type DueTone = 'danger' | 'tint' | 'secondary';

export interface DueLabel {
  label: string;
  tone: DueTone;
  /** The floating day the label refers to. */
  day: string;
}

const TONE_CLASS: Record<DueTone, string> = {
  danger: 'text-destructive',
  tint: 'text-primary',
  secondary: 'text-muted-foreground',
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
 * ellipsises to make room for a date.
 *
 * The tone is unchanged from when it led the meta line, so an overdue date is
 * still destructive and today's is still tinted.
 */
export function DueDateLabel({ task, zone, timeFormat, className }: DueDateLabelProps) {
  const due = dueLabel(task, zone, timeFormat);
  if (!due) return null;

  return (
    <span
      className={cn(
        'shrink-0 whitespace-nowrap text-xs tabular-nums',
        TONE_CLASS[due.tone],
        className,
      )}
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
        'flex h-5 w-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-muted-foreground',
        className,
      )}
    >
      {task.priority !== 'none' ? (
        <span
          className={cn('inline-flex shrink-0 items-center', priorityColor(task.priority))}
        >
          <LightningBoltIcon className={META_GLYPH} aria-hidden />
          <span className="sr-only">{priorityLabel(task.priority)} priority</span>
        </span>
      ) : null}

      {task.recurrenceRule ? (
        <span className="inline-flex shrink-0 items-center">
          <LoopIcon className={META_GLYPH} aria-hidden />
          <span className="sr-only">Repeating</span>
        </span>
      ) : null}

      {subtasks.length ? (
        <span className="inline-flex shrink-0 items-center gap-0.5 tabular-nums">
          <Half1Icon className={META_GLYPH} aria-hidden />
          {doneSubtasks}/{subtasks.length}
          <span className="sr-only">subtasks done</span>
        </span>
      ) : null}

      {tags.map((tag) => (
        <Badge
          key={tag.id}
          variant="outline"
          className="h-5 shrink-0 gap-1 border-border px-1.5 text-xs text-muted-foreground"
        >
          {/* The one place a tag's colour survives: a dot, not the whole chip. */}
          <span
            aria-hidden
            className="size-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: accentHex(tag.color) }}
          />
          {`#${tag.name}`}
        </Badge>
      ))}
    </span>
  );
}
