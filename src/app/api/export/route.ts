/**
 * Full data export.
 *
 * Deliberately a JSON dump rather than only ICS: a user must be able to leave
 * with everything, including habits and completion history, which iCalendar
 * cannot represent. `?format=ics` is available for calendar-only export.
 */
import { route } from '@/server/http';
import { NextResponse } from 'next/server';
import { getDb } from '@/server/db';
import { caldavAccounts, calendarEvents, calendars, habitEntries, habits, lists, tags, taskCompletions, tasks } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { getSettings } from '@/server/repos/settings';
import { buildIcsFeed } from '@/server/services/ics-feed';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export const GET = route(async ({ user, req }) => {
  const format = new URL(req.url).searchParams.get('format');
  const settings = await getSettings(user.id);
  const zone = settings.timezone || user.timezone;

  if (format === 'ics') {
    const now = Date.now();
    const ics = await buildIcsFeed({
      userId: user.id,
      zone,
      calendarName: 'TaskTick export',
      startMs: now - 1000 * 60 * 60 * 24 * 365 * 5,
      endMs: now + 1000 * 60 * 60 * 24 * 365 * 5,
      includeTasks: true,
      includeEvents: true,
    });

    return new NextResponse(ics, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Content-Disposition': `attachment; filename="tasktick-${new Date().toISOString().slice(0, 10)}.ics"`,
        'Cache-Control': 'no-store',
      },
    });
  }

  const db = getDb();
  const [listRows, tagRows, taskRows, calendarRows, eventRows, habitRows, habitEntryRows, completionRows, accountRows] =
    await Promise.all([
      db.select().from(lists).where(eq(lists.userId, user.id)),
      db.select().from(tags).where(eq(tags.userId, user.id)),
      db.select().from(tasks).where(eq(tasks.userId, user.id)),
      db.select().from(calendars).where(eq(calendars.userId, user.id)),
      db.select().from(calendarEvents).where(eq(calendarEvents.userId, user.id)),
      db.select().from(habits).where(eq(habits.userId, user.id)),
      db.select().from(habitEntries).where(eq(habitEntries.userId, user.id)),
      db.select().from(taskCompletions).where(eq(taskCompletions.userId, user.id)),
      db
        .select({
          id: caldavAccounts.id,
          name: caldavAccounts.name,
          serverUrl: caldavAccounts.serverUrl,
          username: caldavAccounts.username,
          enabled: caldavAccounts.enabled,
        })
        .from(caldavAccounts)
        .where(eq(caldavAccounts.userId, user.id)),
    ]);

  // The encrypted CalDAV password is deliberately NOT exported: it is useless
  // without the server's secret key and would be a leak if the file were shared.
  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      schemaVersion: 1,
      user: { id: user.id, email: user.email, name: user.name },
      settings,
      lists: listRows,
      tags: tagRows,
      tasks: taskRows,
      calendars: calendarRows,
      events: eventRows,
      habits: habitRows,
      habitEntries: habitEntryRows,
      taskCompletions: completionRows,
      caldavAccounts: accountRows,
    },
    {
      headers: {
        'Content-Disposition': `attachment; filename="tasktick-${new Date().toISOString().slice(0, 10)}.json"`,
        'Cache-Control': 'no-store',
      },
    },
  );
});
