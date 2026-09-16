/**
 * Global search across tasks, events and habits.
 *
 * Deliberately capped and unranked beyond "most recent first": an instant,
 * predictable result list beats a relevance model nobody can reason about.
 */
import { ok, route, searchParam } from '@/server/http';
import { queryTasks } from '@/server/repos/tasks';
import { eventsInRange } from '@/server/repos/calendars';
import { listHabits } from '@/server/repos/habits';
import { getSettings } from '@/server/repos/settings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = route(async ({ user, req }) => {
  const query = (searchParam(req, 'q') ?? '').trim();
  if (query.length < 2) return ok({ tasks: [], events: [], habits: [] });

  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;
  const needle = query.toLowerCase();

  const [tasks, events, habits] = await Promise.all([
    queryTasks({ userId: user.id, zone, filter: { text: query, includeCompleted: true }, sort: 'updated', limit: 40 }),
    eventsInRange(user.id, Date.now() - 1000 * 60 * 60 * 24 * 365 * 2, Date.now() + 1000 * 60 * 60 * 24 * 365 * 2, zone),
    listHabits({ userId: user.id, zone, weekStartsOn: settings.weekStartsOn, includeArchived: true }),
  ]);

  return ok({
    tasks,
    events: events.filter((e) => e.summary.toLowerCase().includes(needle)).slice(0, 20),
    habits: habits.filter((h) => h.name.toLowerCase().includes(needle)).slice(0, 20),
  });
});
