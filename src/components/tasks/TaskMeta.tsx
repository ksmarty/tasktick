/**
 * The derived marks of a task row: the inline glyphs, the tag line, and the due
 * date's formatter.
 *
 * ## Why the glyphs and the tags are in different places
 *
 * They were one line under the title. The glyphs left it because priority,
 * repeat and subtask progress are *state* marks — the reader checks them against
 * the date ("this repeats, and it is due Friday"), and on the old layout the
 * repeat icon sat on a second line while the date sat up on the trailing edge,
 * so the eye had to travel between them. `TaskGlyphs` is now rendered inline at
 * the row's trailing edge, immediately before `DueDateLabel`.
 *
 * The tags stayed on the second line on purpose: a tag chip is the widest item
 * here and would push the title's own trailing edge around if it moved inline
 * with it. A row with both therefore reads as glyphs + date on the top line and
 * tag chips below — the date keeps its column, which is the point.
 *
 * The pin is not here either — it is a deliberate mark on the task itself, so it
 * sits beside the title (see `TaskRow`). The list name used to lead this line
 * and is gone: the card's coloured edge already says which list a row belongs
 * to, so naming it again was duplication.
 *
 * ## One line, one glyph size
 *
 * The tag line is a single non-wrapping row: it never grows to two lines, so
 * every row's meta is the same height and the list keeps a steady rhythm. When
 * it runs out of room the *meta* ellipsises — the tag chips are the only items
 * that may shrink — because the title above it always outranks it.
 *
 * ## Sizing and colour without `sx`
 *
 * `@svg-animated-icons/react` sizes each glyph with `width: 1em; height: 1em` in
 * a stylesheet it injects itself, so a `size-*` utility would be fighting that
 * rule. The size is therefore set the way the icon expects — through the font
 * size (`text-sm`, Tailwind's scale) — which is also why one class switches the
 * whole line's glyphs at once.
 *
 * Colours come from the theme's muted foreground. Tag colours are user data
 * rather than theme tokens, so they survive as a small dot inside an otherwise
 * monochrome chip: the tag's name is its identity, and spending a full coloured
 * pill and border on it made the meta line busier than the title above it.
 *
 * Priority has no glyph here at all. It used to — a lightning bolt tinted by
 * `priority.ts` — and it left with the monochrome ramp: the row's checkbox wears
 * the priority's colour now (see `priorityCheckbox`) and the row announces the
 * weight in words, so a second mark on the same line was saying it twice.
 */
import { LoopIcon } from '@svg-animated-icons/react/loop';
import { Half1Icon } from '@svg-animated-icons/react/half-1';
import { accentHex } from '@/lib/colors';
import type { Task } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { dueLabel, type DueFormat, type DueTone } from './due-label';

// The label and its types were defined here before being split into a pure
// module so they could be unit-tested in node; they stay importable from here so
// the feature's public surface is unchanged.
export { absoluteDayLabel, dueLabel } from './due-label';
export type { DueFormat, DueLabel, DueTone } from './due-label';

/** The one glyph size for the whole meta line. */
const META_GLYPH = 'text-sm';

const TONE_CLASS: Record<DueTone, string> = {
  danger: 'text-destructive',
  tint: 'text-primary',
  secondary: 'text-muted-foreground',
};

export interface DueDateLabelProps {
  task: Task;
  zone: string;
  timeFormat: '12h' | '24h';
  /**
   * Which shape the trailing label takes — see `DueFormat`. The row is told its
   * section by `TaskListSection`; Today keeps the relative day and the clock
   * time, Tomorrow the clock time alone, and everything else the date.
   */
  format?: DueFormat;
  /** Drop a whole hour's `:00` from the label — the `compactTimes` setting. */
  compact?: boolean;
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
 *
 * ## Why the label carries a line-height
 *
 * The row aligns the title and this label with `items-start`, so both boxes
 * hang from the top of the first line. `text-xs` alone is a 12px font on a 16px
 * line box, while the title is 16px on a 20px one — so the label's box centred
 * 2px above the title's, and the date read as sitting high in the row. Measured
 * before: label box centre 192.0px, title box centre 194.0px, label −2.0px. A
 * `leading-5` line box (20px, exactly the title's `text-base leading-tight`)
 * puts both centres on the same pixel. It is a line-height, not a margin: the
 * box grows around the text and the baseline never moves.
 */
export function DueDateLabel({ task, zone, timeFormat, format = 'relative', compact = false, className }: DueDateLabelProps) {
  const due = dueLabel(task, zone, timeFormat, format, compact);
  if (!due) return null;

  return (
    <span
      className={cn(
        // `leading-5` matches the title's own line box, so the date is centred
        // on the first line instead of floating 2px above it.
        'shrink-0 text-xs leading-5 whitespace-nowrap tabular-nums',
        TONE_CLASS[due.tone],
        className,
      )}
    >
      {due.label}
    </span>
  );
}

export interface TaskGlyphsProps {
  task: Task;
  className?: string;
}

/**
 * The row's inline state glyphs: repeat, subtask progress.
 *
 * Rendered at the trailing edge, immediately left of the date, so the two things
 * a reader compares — "does it repeat" and "when is it due" — sit next to each
 * other instead of one above the other. Priority is not here: the checkbox at
 * the row's leading edge carries it, in colour.
 *
 * `h-5` matches the date label's own `leading-5` box, so the glyphs share its
 * line box and the row stays optically centred. Returns null for a plain task,
 * which keeps the trailing edge flush against the date.
 */
export function TaskGlyphs({ task, className }: TaskGlyphsProps) {
  const subtasks = task.subtasks ?? [];
  const doneSubtasks = subtasks.filter((subtask) => subtask.status === 'completed').length;

  if (!task.recurrenceRule && !subtasks.length) return null;

  return (
    <span
      className={cn(
        'flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap text-muted-foreground',
        className,
      )}
    >
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
    </span>
  );
}

export interface TaskMetaProps {
  task: Task;
  className?: string;
}

/** The row's second line: the tag chips, and nothing else. */
export function TaskMeta({ task, className }: TaskMetaProps) {
  const tags = task.tags ?? [];
  if (!tags.length) return null;

  return (
    <span
      className={cn(
        'flex h-5 w-full min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-muted-foreground',
        className,
      )}
    >
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
