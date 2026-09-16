/**
 * Section building for the Today screen and for the grouped task list.
 *
 * Pure on purpose: every ordering decision a user can see (which bucket wins,
 * which sections are skipped, which one is collapsed by default) is decided
 * here and unit-tested, so the view components stay presentational.
 */
import type { AgendaBuckets } from '@/lib/agenda-types';
import { fromDateOnly, relativeDayLabel, taskDay } from '@/lib/dates';
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
  /** Group by due day. Off for sorts where a day grouping would fight the order. */
  groupByDay: boolean;
  /** Title of the single section used when `groupByDay` is false. */
  title?: string;
}

/**
 * The list screen's grouping.
 *
 * Overdue first (in red), then one section per day with the same relative
 * labels the rows use, then "No date", then "Completed" — which starts
 * collapsed because it is history, not work.
 */
export function buildListSections(tasks: readonly Task[], options: ListSectionOptions): TaskSection[] {
  const { zone, today, groupByDay, title = 'All tasks' } = options;
  const open = tasks.filter((task) => task.status === 'todo');
  const closed = tasks.filter((task) => task.status !== 'todo');

  if (!groupByDay) {
    const sections: TaskSection[] = [];
    if (open.length) {
      sections.push({ id: 'all', title, tasks: open.slice(), tone: 'default', defaultCollapsed: false, reorderable: true });
    }
    if (closed.length) {
      sections.push({
        id: 'completed',
        title: 'Completed',
        tasks: closed.slice(),
        tone: 'default',
        defaultCollapsed: true,
        reorderable: false,
      });
    }
    return sections;
  }

  const overdue: Task[] = [];
  const noDate: Task[] = [];
  const byDay = new Map<DateOnly, Task[]>();

  for (const task of open) {
    const day = taskDay(task, zone);
    if (!day) {
      noDate.push(task);
      continue;
    }
    if (day < today) {
      overdue.push(task);
      continue;
    }
    const bucket = byDay.get(day);
    if (bucket) bucket.push(task);
    else byDay.set(day, [task]);
  }

  const sections: TaskSection[] = [];
  if (overdue.length) {
    sections.push({ id: 'overdue', title: 'Overdue', tasks: overdue, tone: 'danger', defaultCollapsed: false, reorderable: true });
  }

  // The caller's notion of "today" drives the labels, not the wall clock.
  const anchor = fromDateOnly(today, zone);

  for (const day of [...byDay.keys()].sort()) {
    sections.push({
      id: `day:${day}`,
      title: relativeDayLabel(day, zone, anchor),
      tasks: byDay.get(day) ?? [],
      tone: 'default',
      defaultCollapsed: false,
      reorderable: true,
    });
  }

  if (noDate.length) {
    sections.push({ id: 'noDate', title: 'No date', tasks: noDate, tone: 'default', defaultCollapsed: false, reorderable: true });
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
