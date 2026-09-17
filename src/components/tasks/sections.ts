/**
 * Section building for the Today screen and for the grouped task list.
 *
 * Pure on purpose: every ordering decision a user can see (which bucket wins,
 * which sections are skipped, which one is collapsed by default) is decided
 * here and unit-tested, so the view components stay presentational.
 */
import type { AgendaBuckets } from '@/lib/agenda-types';
import { addDaysToDateOnly, taskDay } from '@/lib/dates';
import type { DateOnly, Task } from '@/lib/types';

export type TaskSectionTone = 'default' | 'danger';

export interface TaskSection {
  /**
   * Stable key. Also the collapse-state key and, for the Today screen, the
   * agenda bucket id used by the optimistic reorder.
   */
  id: string;
  title: string;
  tasks: Task[];
  /** `danger` renders the header in red — used for Overdue. */
  tone: TaskSectionTone;
  /** Starts collapsed; the user can still expand it. */
  defaultCollapsed: boolean;
  /** False when a manual order would fight the server's sort. */
  reorderable: boolean;
}

interface TodaySectionSpec {
  id: string;
  bucket: keyof AgendaBuckets;
  title: string;
  tone: TaskSectionTone;
  defaultCollapsed: boolean;
}

/**
 * The Today screen's sections, in render order. `thisWeek` is titled
 * "Next 7 days" because that is what the server bucket actually holds.
 */
export const TODAY_SECTIONS: readonly TodaySectionSpec[] = [
  { id: 'overdue', bucket: 'overdue', title: 'Overdue', tone: 'danger', defaultCollapsed: false },
  { id: 'today', bucket: 'today', title: 'Today', tone: 'default', defaultCollapsed: false },
  { id: 'tomorrow', bucket: 'tomorrow', title: 'Tomorrow', tone: 'default', defaultCollapsed: false },
  { id: 'next7days', bucket: 'thisWeek', title: 'Next 7 days', tone: 'default', defaultCollapsed: false },
  { id: 'later', bucket: 'later', title: 'Later', tone: 'default', defaultCollapsed: false },
  { id: 'noDate', bucket: 'noDate', title: 'No date', tone: 'default', defaultCollapsed: false },
  { id: 'completed', bucket: 'completedToday', title: 'Completed today', tone: 'default', defaultCollapsed: true },
];

/** Today section id → the agenda bucket it renders. */
export const SECTION_BUCKET: Record<string, keyof AgendaBuckets> = Object.fromEntries(
  TODAY_SECTIONS.map((spec) => [spec.id, spec.bucket]),
) as Record<string, keyof AgendaBuckets>;

const EMPTY_AGENDA: AgendaBuckets = {
  overdue: [],
  today: [],
  tomorrow: [],
  thisWeek: [],
  later: [],
  noDate: [],
  completedToday: [],
};

function section(spec: TodaySectionSpec, tasks: Task[]): TaskSection {
  return {
    id: spec.id,
    title: spec.title,
    tasks,
    tone: spec.tone,
    defaultCollapsed: spec.defaultCollapsed,
    // Completed rows are never draggable, but the open sections are: a user who
    // drags deliberately means it, whatever the server-side sort.
    reorderable: spec.id !== 'completed',
  };
}

/** Today's sections, skipping any empty bucket, with completed work last. */
export function buildTodaySections(agenda: AgendaBuckets | null | undefined): TaskSection[] {
  const buckets = agenda ?? EMPTY_AGENDA;
  const out: TaskSection[] = [];

  for (const spec of TODAY_SECTIONS) {
    const tasks = buckets[spec.bucket] ?? [];
    if (tasks.length === 0) continue;
    out.push(section(spec, tasks));
  }

  return out;
}

/** Open (not completed) tasks across every section — the navbar counter. */
export function countRemaining(sections: readonly TaskSection[]): number {
  return sections.reduce(
    (total, item) => total + (item.id === 'completed' ? 0 : item.tasks.length),
    0,
  );
}

export interface TodayProgress {
  completed: number;
  total: number;
  /** `0..1`, safe to hand to `ProgressRing`. */
  value: number;
}

/**
 * Today's completed-vs-total ratio for the header ring.
 *
 * "Today" means what the user still owes today (today + overdue) plus what they
 * already ticked off, so the ring starts full and empties as the day goes on.
 */
export function todayProgress(agenda: AgendaBuckets | null | undefined): TodayProgress {
  const buckets = agenda ?? EMPTY_AGENDA;
  const completed = buckets.completedToday?.length ?? 0;
  const outstanding = (buckets.today?.length ?? 0) + (buckets.overdue?.length ?? 0);
  const total = completed + outstanding;
  return { completed, total, value: total === 0 ? 0 : completed / total };
}

export interface ListSectionOptions {
  zone: string;
  /** Today's floating day, injected so the grouping is testable. */
  today: DateOnly;
}

/**
 * How far ahead the "Next 7 days" group reaches: today through today + 7.
 *
 * Kept in step with the server's agenda bucket and `dueWindowBounds`, so the
 * group means the same slice of time whichever endpoint built it.
 */
export const NEXT_7_DAYS_SPAN = 7;

/**
 * The open-work groups of the list screen, in render order.
 *
 * These are not filters the user picks — they are the same data bucketed by
 * urgency, so the screen shows one pass over every open task instead of asking
 * which slice to look at first.
 */
export const LIST_GROUPS: readonly { id: string; title: string; tone: TaskSectionTone }[] = [
  { id: 'pinned', title: 'Pinned', tone: 'default' },
  { id: 'overdue', title: 'Overdue', tone: 'danger' },
  { id: 'next7days', title: 'Next 7 days', tone: 'default' },
  { id: 'later', title: 'Later', tone: 'default' },
];

/**
 * The list screen's grouping: Pinned, Overdue, Next 7 days, Later.
 *
 * One pass over the rows, each open task landing in exactly one group — a task
 * that is both pinned and overdue is pinned, and never appears twice. A group
 * with nothing in it is skipped rather than rendered as an empty header.
 *
 * Pinned wins over everything because it is the user's own ordering of their
 * day; Overdue is anything due before today; Next 7 days is today through the
 * end of the week-long horizon; Later is the rest, undated work included, so
 * nothing has a home it does not belong in.
 *
 * Closed rows are kept reachable in a collapsed trailing section: ticking a task
 * off must never make it vanish with no way back.
 */
export function buildListSections(tasks: readonly Task[], options: ListSectionOptions): TaskSection[] {
  const { zone, today } = options;
  const horizon = addDaysToDateOnly(today, NEXT_7_DAYS_SPAN, zone);

  const buckets = new Map<string, Task[]>(LIST_GROUPS.map((group) => [group.id, []]));
  const closed: Task[] = [];

  for (const task of tasks) {
    if (task.status !== 'todo') {
      closed.push(task);
      continue;
    }
    if (task.isPinned) {
      buckets.get('pinned')?.push(task);
      continue;
    }

    const day = taskDay(task, zone);
    if (day && day < today) buckets.get('overdue')?.push(task);
    else if (day && day <= horizon) buckets.get('next7days')?.push(task);
    else buckets.get('later')?.push(task);
  }

  const sections: TaskSection[] = [];

  for (const group of LIST_GROUPS) {
    const grouped = buckets.get(group.id) ?? [];
    if (grouped.length === 0) continue;
    sections.push({
      id: group.id,
      title: group.title,
      tasks: grouped,
      tone: group.tone,
      defaultCollapsed: false,
      reorderable: true,
    });
  }

  if (closed.length) {
    sections.push({
      id: 'completed',
      title: 'Completed',
      tasks: closed,
      tone: 'default',
      defaultCollapsed: true,
      reorderable: false,
    });
  }

  return sections;
}
