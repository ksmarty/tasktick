/**
 * Section building for the Today screen and for the grouped task list.
 *
 * Pure on purpose: every ordering decision a user can see (which bucket wins,
 * which sections are skipped, which one is collapsed by default) is decided
 * here and unit-tested, so the view components stay presentational.
 */
import type { AgendaBuckets } from '@/lib/agenda-types';
import { addDaysToDateOnly, taskDay, toDateOnly } from '@/lib/dates';
import type { CalendarItem, DateOnly, Task } from '@/lib/types';

export type TaskSectionTone = 'default' | 'danger';

export interface TaskSection {
  /**
   * Stable key. Also the collapse-state key and, for the Today screen, the
   * agenda bucket id used by the optimistic reorder.
   */
  id: string;
  title: string;
  tasks: Task[];
  /**
   * Calendar events that start in this group.
   *
   * Events render as rows beside the tasks, but they are not tasks: they cannot
   * be completed and are never reordered, so they are carried in their own list
   * rather than forced into a `Task` shape (see `EventRow`).
   */
  events: CalendarItem[];
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
  // Completed work arrives expanded: ticking a task must show where it went, not
  // hide it behind a second tap (`defaultCollapsed` is only read on first mount).
  { id: 'completed', bucket: 'completedToday', title: 'Completed today', tone: 'default', defaultCollapsed: false },
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
    events: [],
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
 * The task rows a list should show, given whether completed work is revealed.
 *
 * Pure and separate from the grouping because it is the one rule the header's
 * completed toggle owns. It only ever *filters tasks*: calendar events are not
 * tasks, never reach this function, and so can never be counted as completed or
 * hidden by the toggle — they are merged in afterwards.
 */
export function visibleTasks(tasks: readonly Task[], includeCompleted: boolean): Task[] {
  if (includeCompleted) return [...tasks];
  return tasks.filter((task) => task.status === 'todo');
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
  { id: 'today', title: 'Today', tone: 'default' },
  { id: 'tomorrow', title: 'Tomorrow', tone: 'default' },
  { id: 'next7days', title: 'Next 7 days', tone: 'default' },
  { id: 'later', title: 'Later', tone: 'default' },
];

/**
 * The list screen's grouping: Pinned, Overdue, Today, Tomorrow, Next 7 days,
 * Later.
 *
 * Pinned leads because it is the user's own ordering of their list — the one
 * group they placed deliberately. Overdue sits immediately below it because
 * urgency is the point of this screen: anything already late outranks anything
 * merely scheduled for today. Today and Tomorrow follow because they are the two
 * days a person actually acts on, and the rest of the horizon follows those.
 *
 * The group order is a render concern only: one pass over the rows, each open
 * task landing in exactly one group — a task that is both pinned and overdue is
 * pinned, and never appears twice — so reordering the groups never moves a task
 * between them. A group with nothing in it is skipped rather than rendered as an
 * empty header.
 *
 * Pinned is tested first, so it wins over every day bucket; Overdue is anything
 * due before today; Next 7 days is the rest of the week-long horizon after
 * tomorrow; Later is everything else, undated work included, so nothing has a
 * home it does not belong in.
 *
 * Events are bucketed by the day they start and never pinned. A past event is
 * dropped: the caller asks the calendar for today onward, and an event that has
 * already happened is not an outstanding item. In Later only the next upcoming
 * occurrence of a recurring series is kept — the rest repeat the same commitment
 * far down a list nobody scrolls; the day groups keep every occurrence because
 * within a few days each one is genuinely relevant. The distinction is made on
 * the already date-ordered stream, not by comparing dates (see the loop).
 *
 * Closed rows are kept reachable in a trailing section that arrives expanded:
 * ticking a task off must never make it vanish with no way back, and hiding the
 * group behind a collapse made the completed toggle look like it did nothing.
 */
export function buildListSections(
  tasks: readonly Task[],
  options: ListSectionOptions,
  events: readonly CalendarItem[] = [],
): TaskSection[] {
  const { zone, today } = options;
  const horizon = addDaysToDateOnly(today, NEXT_7_DAYS_SPAN, zone);
  const tomorrow = addDaysToDateOnly(today, 1, zone);

  const buckets = new Map<string, Task[]>(LIST_GROUPS.map((group) => [group.id, []]));
  const eventBuckets = new Map<string, CalendarItem[]>(LIST_GROUPS.map((group) => [group.id, []]));
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
    else if (day === today) buckets.get('today')?.push(task);
    else if (day === tomorrow) buckets.get('tomorrow')?.push(task);
    else if (day && day <= horizon) buckets.get('next7days')?.push(task);
    else buckets.get('later')?.push(task);
  }

  /*
   * The stream is sorted by start here, so while bucketing it is in ascending
   * date order; the first occurrence of a series to land in Later is therefore
   * its earliest one, with no date arithmetic. `/api/calendar/items` already
   * returns `items` sorted by `startMs` (see `getCalendarItems`), and this sort
   * makes that guarantee local rather than assumed of the caller.
   */
  const laterSeries = new Set<string>();
  for (const event of [...events].sort((a, b) => a.startMs - b.startMs)) {
    const day = toDateOnly(event.startMs, zone);
    if (day < today) continue;
    if (day === today) eventBuckets.get('today')?.push(event);
    else if (day === tomorrow) eventBuckets.get('tomorrow')?.push(event);
    else if (day <= horizon) eventBuckets.get('next7days')?.push(event);
    else {
      // Only the next occurrence of a recurring series is useful this far out;
      // every later one would just repeat the same weekly stand-up. A
      // non-recurring event has no series and keeps appearing as it always has.
      const series = event.isRecurringInstance ? event.seriesUid : null;
      if (series) {
        if (laterSeries.has(series)) continue;
        laterSeries.add(series);
      }
      eventBuckets.get('later')?.push(event);
    }
  }

  const sections: TaskSection[] = [];

  for (const group of LIST_GROUPS) {
    const grouped = buckets.get(group.id) ?? [];
    const groupedEvents = eventBuckets.get(group.id) ?? [];
    if (grouped.length === 0 && groupedEvents.length === 0) continue;
    sections.push({
      id: group.id,
      title: group.title,
      tasks: grouped,
      events: groupedEvents,
      tone: group.tone,
      defaultCollapsed: false,
      // A section carrying only events has nothing to drag.
      reorderable: grouped.length > 0,
    });
  }

  if (closed.length) {
    sections.push({
      id: 'completed',
      title: 'Completed',
      tasks: closed,
      events: [],
      tone: 'default',
      // Expanded, not collapsed: the completed toggle reveals this group and the
      // work must be visible the moment it is asked for.
      defaultCollapsed: false,
      reorderable: false,
    });
  }

  return sections;
}
