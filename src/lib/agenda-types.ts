/**
 * Agenda buckets, in their own module to avoid a cycle:
 * `view-types.ts` imports this, and `server/repos/tasks.ts` imports the domain
 * types only.
 */
import type { Task } from './types';

/** Open tasks grouped into the sections the Today view renders. */
export interface AgendaBuckets {
  overdue: Task[];
  today: Task[];
  tomorrow: Task[];
  thisWeek: Task[];
  later: Task[];
  noDate: Task[];
  completedToday: Task[];
}
