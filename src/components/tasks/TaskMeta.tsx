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
 * The due date does not lead this line either: it now lives at the row's trailing
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
 * Colours come from the MUI palette (`priority.ts` maps a priority to a palette
 * path) so light and dark are both correct, and data-driven tag colours use
 * `accentHex` because they are user data rather than theme tokens.
 */
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import ChecklistIcon from '@mui/icons-material/Checklist';
import FlagIcon from '@mui/icons-material/Flag';
import RepeatIcon from '@mui/icons-material/Repeat';
import { accentHex } from '@/lib/colors';
import { formatTime, isOverdue, relativeDayLabel, taskDay, todayIn } from '@/lib/dates';
import type { Task } from '@/lib/types';
import { priorityColor, priorityLabel } from './priority';

/** The one icon size for the whole meta line. */
const META_ICON_SX = { fontSize: 13 } as const;

export type DueTone = 'danger' | 'tint' | 'secondary';

export interface DueLabel {
  label: string;
  tone: DueTone;
  /** The floating day the label refers to. */
  day: string;
}

const TONE_COLOR: Record<DueTone, string> = {
  danger: 'error.main',
  tint: 'primary.main',
  secondary: 'text.secondary',
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
  sx?: object;
}

/**
 * The due date, as the row's right-aligned trailing label.
 *
 * Fixed-width and non-shrinking on purpose: keeping its exact position is what
 * lets the title and the meta line claim the remaining width, so the title never
 * ellipsises to make room for a date.
 *
 * The tone is unchanged from when it led the meta line, so an overdue date is
 * still red and today's is still tinted.
 */
export function DueDateLabel({ task, zone, timeFormat, sx }: DueDateLabelProps) {
  const due = dueLabel(task, zone, timeFormat);
  if (!due) return null;

  return (
    <Typography
      component="span"
      variant="caption"
      sx={{
        flexShrink: 0,
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
        color: TONE_COLOR[due.tone],
        ...sx,
      }}
    >
      {due.label}
    </Typography>
  );
}

/** A screen-reader-only mark, without pulling in a helper package. */
const SR_ONLY = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const;

export interface TaskMetaProps {
  task: Task;
  sx?: object;
}

export function TaskMeta({ task, sx }: TaskMetaProps) {
  const subtasks = task.subtasks ?? [];
  const doneSubtasks = subtasks.filter((subtask) => subtask.status === 'completed').length;
  const tags = task.tags ?? [];

  const hasAnything = Boolean(
    task.priority !== 'none' || tags.length || task.recurrenceRule || subtasks.length,
  );
  if (!hasAnything) return null;

  return (
    <Stack
      component="span"
      direction="row"
      spacing={1}
      sx={{
        width: '100%',
        minWidth: 0,
        height: 20,
        alignItems: 'center',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        color: 'text.secondary',
        ...sx,
      }}
    >
      {task.priority !== 'none' ? (
        <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0, color: priorityColor(task.priority) }}>
          <FlagIcon sx={{ ...META_ICON_SX, fill: 'currentColor' }} aria-hidden />
          <Box component="span" sx={SR_ONLY}>
            {priorityLabel(task.priority)} priority
          </Box>
        </Box>
      ) : null}

      {task.recurrenceRule ? (
        <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0 }}>
          <RepeatIcon sx={META_ICON_SX} aria-hidden />
          <Box component="span" sx={SR_ONLY}>
            Repeating
          </Box>
        </Box>
      ) : null}

      {subtasks.length ? (
        <Box
          component="span"
          sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}
        >
          <ChecklistIcon sx={META_ICON_SX} aria-hidden />
          {doneSubtasks}/{subtasks.length}
          <Box component="span" sx={SR_ONLY}>
            subtasks done
          </Box>
        </Box>
      ) : null}

      {tags.map((tag) => (
        <Chip
          key={tag.id}
          label={`#${tag.name}`}
          size="small"
          variant="outlined"
          sx={{
            height: 20,
            minWidth: 0,
            fontSize: 13,
            color: accentHex(tag.color),
            borderColor: accentHex(tag.color),
          }}
        />
      ))}
    </Stack>
  );
}
