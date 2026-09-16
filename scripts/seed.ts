/**
 * Development seed.
 *
 * Creates a demo account with a realistic spread of data — lists, tags, tasks
 * across every due window, a recurring task, subtasks, scheduled events, habits
 * with check-in history — so the UI can be exercised without hand-entering
 * anything. Refuses to run in production.
 *
 *   npm run db:seed
 *   SEED_EMAIL=me@example.com SEED_PASSWORD=... npm run db:seed
 */
import { getDb, closeDb } from '@/server/db';
import {
  calendarEvents,
  calendars,
  habitEntries,
  habits,
  lists,
  tags,
  taskTags,
  tasks,
  user,
} from '@/server/db/schema';
import { newId } from '@/server/crypto';
import { eq, sql } from 'drizzle-orm';
import { addDaysToDateOnly, combineDateAndTime, todayIn } from '@/lib/dates';
import { buildRRule } from '@/lib/rrule';
import { spreadKeys } from '@/lib/fractional';
import { getAuth } from '@/server/auth';
import { ensureUserBootstrap } from '@/server/bootstrap';

const ZONE = process.env.SEED_TIMEZONE ?? 'Europe/Berlin';
const EMAIL = process.env.SEED_EMAIL ?? 'demo@tasktick.local';
const PASSWORD = process.env.SEED_PASSWORD ?? 'tasktick-demo-1234';

function assertNotProduction() {
  if (process.env.NODE_ENV === 'production' && process.env.SEED_FORCE !== '1') {
    console.error('[seed] refusing to run with NODE_ENV=production. Set SEED_FORCE=1 to override.');
    process.exit(1);
  }
}

async function findOrCreateUser(): Promise<string> {
  const db = getDb();

  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, EMAIL)).limit(1);
  if (existing) {
    console.log(`[seed] reusing existing account ${EMAIL}`);
    return existing.id;
  }

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(user);
  const isFirst = Number(count) === 0;

  // Creating through better-auth means the demo account gets a real scrypt hash
  // and the same provisioning hooks a normal signup would get.
  const result = await getAuth().api.signUpEmail({
    body: { email: EMAIL, password: PASSWORD, name: 'Demo User' },
  });

  const userId = String((result as { user?: { id?: string } })?.user?.id ?? '');
  if (!userId) throw new Error('Could not create the demo account');

  if (isFirst) {
    await db.update(user).set({ isAdmin: true }).where(eq(user.id, userId));
  }

  await ensureUserBootstrap(userId, ZONE, 1);
  console.log(`[seed] created account ${EMAIL}`);
  return userId;
}

async function seed(userId: string) {
  const db = getDb();
  const now = Date.now();
  const today = todayIn(ZONE);

  /* ---- lists ---- */

  const inbox = (await db.select().from(lists).where(eq(lists.userId, userId)).limit(1))[0];

  const listSpecs = [
    { name: 'Work', color: 'blue', emoji: '💼' },
    { name: 'Personal', color: 'green', emoji: '🏡' },
    { name: 'Shopping', color: 'orange', emoji: '🛒' },
    { name: 'Reading', color: 'purple', emoji: '📚' },
  ];

  const listKeys = spreadKeys(listSpecs.length + 1, 8);
  const listIds: Record<string, string> = {};

  for (let i = 0; i < listSpecs.length; i++) {
    const spec = listSpecs[i];
    const id = newId();
    listIds[spec.name] = id;
    await db.insert(lists).values({
      id,
      userId,
      name: spec.name,
      color: spec.color,
      emoji: spec.emoji,
      sortOrder: listKeys[i + 1],
      createdAt: now,
      updatedAt: now,
    });
  }
  listIds.Inbox = inbox?.id ?? '';

  /* ---- tags ---- */

  const tagSpecs: { name: string; color: string }[] = [
    { name: 'urgent', color: 'red' },
    { name: 'deep-work', color: 'indigo' },
    { name: 'quick', color: 'teal' },
    { name: 'waiting', color: 'gray' },
  ];

  const tagIds: Record<string, string> = {};
  for (const spec of tagSpecs) {
    const id = newId();
    tagIds[spec.name] = id;
    await db.insert(tags).values({ id, userId, name: spec.name, color: spec.color, createdAt: now, updatedAt: now });
  }

  /* ---- tasks ---- */

  interface SeedTask {
    title: string;
    list: string;
    notes?: string;
    priority?: 'none' | 'low' | 'medium' | 'high';
    /** Offset in days from today; null means no date at all. */
    dueOffset?: number | null;
    dueTime?: string;
    tags?: string[];
    recurrenceRule?: string;
    estimateMinutes?: number;
    subtasks?: string[];
    completed?: boolean;
    pinned?: boolean;
  }

  const seedTasks: SeedTask[] = [
    { title: 'Reply to the design review thread', list: 'Work', priority: 'high', dueOffset: -2, tags: ['urgent'], estimateMinutes: 20 },
    { title: 'Prepare the quarterly numbers', list: 'Work', priority: 'high', dueOffset: -1, dueTime: '17:00', estimateMinutes: 90, subtasks: ['Pull the raw figures', 'Reconcile refunds', 'Draft the summary slide'] },
    { title: 'Stand-up', list: 'Work', dueOffset: 0, dueTime: '09:30', recurrenceRule: buildRRule({ freq: 'WEEKLY', byDay: [1, 2, 3, 4, 5] }), tags: ['quick'] },
    { title: 'Ship the sync engine refactor', list: 'Work', priority: 'high', dueOffset: 0, dueTime: '15:00', tags: ['deep-work'], estimateMinutes: 180, subtasks: ['Extract the conflict policy', 'Cover the tombstone path', 'Update the docs'], pinned: true },
    { title: 'Book the dentist', list: 'Personal', priority: 'medium', dueOffset: 0, tags: ['quick'], estimateMinutes: 5 },
    { title: 'Water the plants', list: 'Personal', dueOffset: 1, recurrenceRule: buildRRule({ freq: 'WEEKLY', byDay: [3] }) },
    { title: 'Renew the passport', list: 'Personal', priority: 'medium', dueOffset: 3, estimateMinutes: 60, tags: ['waiting'] },
    { title: 'Weekly review', list: 'Personal', dueOffset: 5, dueTime: '18:00', recurrenceRule: buildRRule({ freq: 'WEEKLY', byDay: [5] }), estimateMinutes: 45 },
    { title: 'Oat milk', list: 'Shopping', dueOffset: 0 },
    { title: 'Coffee beans', list: 'Shopping', dueOffset: 0 },
    { title: 'Olive oil', list: 'Shopping', dueOffset: 2 },
    { title: 'Finish "The Design of Everyday Things"', list: 'Reading', dueOffset: 14, estimateMinutes: 120, subtasks: ['Chapters 1–3', 'Chapters 4–6', 'Chapters 7–end'] },
    { title: 'Read the CalDAV RFC properly', list: 'Reading', priority: 'low', dueOffset: 21, tags: ['deep-work'] },
    { title: 'Someday: learn to sail', list: 'Personal', dueOffset: null },
    { title: 'Sort out the photo library', list: 'Personal', dueOffset: null, priority: 'low' },
    { title: 'File the tax return', list: 'Personal', priority: 'high', dueOffset: -5, completed: true },
    { title: 'Cancel the old subscription', list: 'Personal', dueOffset: -3, completed: true },
  ];

  const taskKeys = spreadKeys(seedTasks.length, 8);
  const createdTaskIds: string[] = [];

  for (let i = 0; i < seedTasks.length; i++) {
    const spec = seedTasks[i];
    const id = newId();
    const listId = listIds[spec.list] || listIds.Inbox;

    const dueDate = spec.dueOffset === null || spec.dueOffset === undefined ? null : addDaysToDateOnly(today, spec.dueOffset, ZONE);
    const dueAtMs = dueDate && spec.dueTime ? combineDateAndTime(dueDate, spec.dueTime, ZONE) : null;

    await db.insert(tasks).values({
      id,
      userId,
      listId: listId || null,
      title: spec.title,
      notes: spec.notes ?? null,
      status: spec.completed ? 'completed' : 'todo',
      priority: spec.priority ?? 'none',
      dueDate,
      dueAtMs,
      isAllDay: !spec.dueTime,
      timezone: ZONE,
      completedAtMs: spec.completed ? now - 3_600_000 : null,
      recurrenceRule: spec.recurrenceRule ?? null,
      estimateMinutes: spec.estimateMinutes ?? null,
      sortOrder: taskKeys[i],
      isPinned: spec.pinned ?? false,
      createdAt: now - (seedTasks.length - i) * 3_600_000,
      updatedAt: now,
    });

    createdTaskIds.push(id);

    for (const tagName of spec.tags ?? []) {
      if (tagIds[tagName]) await db.insert(taskTags).values({ taskId: id, tagId: tagIds[tagName] });
    }

    // Subtasks are real rows with a parentId, which is what makes the
    // progress counter and the parent-completion rule work.
    for (let s = 0; s < (spec.subtasks?.length ?? 0); s++) {
      await db.insert(tasks).values({
        id: newId(),
        userId,
        listId: listId || null,
        parentId: id,
        title: spec.subtasks![s],
        status: s === 0 && spec.completed ? 'completed' : 'todo',
        priority: 'none',
        isAllDay: true,
        timezone: ZONE,
        sortOrder: spreadKeys(spec.subtasks!.length, 8)[s],
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  /* ---- calendar + events ---- */

  const [existingCalendar] = await db.select().from(calendars).where(eq(calendars.userId, userId)).limit(1);
  const calendarId = existingCalendar?.id ?? newId();

  if (!existingCalendar) {
    await db.insert(calendars).values({
      id: calendarId,
      userId,
      name: 'Personal',
      color: 'blue',
      timezone: ZONE,
      provider: 'local',
      isDefault: true,
      supportsVtodo: true,
      sortOrder: 'a0000000',
      createdAt: now,
      updatedAt: now,
    });
  }

  const eventSpecs = [
    { summary: 'Team sync', offset: 0, start: '10:00', end: '11:00', rrule: buildRRule({ freq: 'WEEKLY', byDay: [1] }), location: 'Meet' },
    { summary: 'Dentist', offset: 2, start: '08:30', end: '09:15', location: 'Zahnarzt am Park' },
    { summary: 'Lunch with Sam', offset: 0, start: '12:30', end: '13:30', location: 'Café Nord' },
    { summary: 'Conference', offset: 7, allDay: true, days: 3, location: 'Berlin' },
    { summary: 'Flight to Lisbon', offset: 21, start: '06:45', end: '09:20', location: 'BER → LIS' },
  ] as const;

  for (const spec of eventSpecs) {
    const date = addDaysToDateOnly(today, spec.offset, ZONE);
    const allDay = 'allDay' in spec && spec.allDay;
    const days = 'days' in spec ? spec.days : 1;

    await db.insert(calendarEvents).values({
      id: newId(),
      userId,
      calendarId,
      uid: newId().replace(/-/g, ''),
      summary: spec.summary,
      location: 'location' in spec ? (spec.location as string) : null,
      startMs: allDay ? null : combineDateAndTime(date, (spec as { start: string }).start, ZONE),
      endMs: allDay ? null : combineDateAndTime(date, (spec as { end: string }).end, ZONE),
      startDate: date,
      endDate: allDay ? addDaysToDateOnly(date, days, ZONE) : date,
      isAllDay: Boolean(allDay),
      timezone: ZONE,
      rrule: 'rrule' in spec ? (spec.rrule as string) : null,
      reminders: [10],
      status: 'confirmed',
      transparency: 'opaque',
      syncProvider: 'local',
      syncState: 'synced',
      createdAt: now,
      updatedAt: now,
    });
  }

  /* ---- habits with history ---- */

  const habitSpecs = [
    { name: 'Drink water', icon: 'Droplets', color: 'cyan', goalType: 'count', goalTarget: 8, unit: 'glasses', frequency: 'daily', timesPerPeriod: 1, weekDays: null, rate: 0.8 },
    { name: 'Read 20 pages', icon: 'BookOpen', color: 'purple', goalType: 'boolean', goalTarget: 1, unit: null, frequency: 'daily', timesPerPeriod: 1, weekDays: null, rate: 0.6 },
    { name: 'Exercise', icon: 'Dumbbell', color: 'green', goalType: 'duration', goalTarget: 30, unit: 'minutes', frequency: 'custom', timesPerPeriod: 1, weekDays: [1, 3, 5], rate: 0.7 },
    { name: 'Meditate', icon: 'Brain', color: 'teal', goalType: 'boolean', goalTarget: 1, unit: null, frequency: 'weekly', timesPerPeriod: 4, weekDays: null, rate: 0.5 },
  ] as const;

  const habitKeys = spreadKeys(habitSpecs.length, 8);

  for (let i = 0; i < habitSpecs.length; i++) {
    const spec = habitSpecs[i];
    const habitId = newId();
    const startDate = addDaysToDateOnly(today, -120, ZONE);

    await db.insert(habits).values({
      id: habitId,
      userId,
      name: spec.name,
      icon: spec.icon,
      color: spec.color,
      goalType: spec.goalType,
      goalTarget: spec.goalTarget,
      unit: spec.unit,
      frequency: spec.frequency,
      weekDays: spec.weekDays ? spec.weekDays.join(',') : null,
      timesPerPeriod: spec.timesPerPeriod,
      startDate,
      sortOrder: habitKeys[i],
      createdAt: now,
      updatedAt: now,
    });

    // A deterministic pseudo-random history so the heatmap and the streak
    // calculations have something meaningful to render (and stay reproducible).
    let seed = i * 7919 + 13;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let back = 119; back >= 0; back--) {
      const date = addDaysToDateOnly(today, -back, ZONE);
      if (rand() > spec.rate) continue;

      const count = spec.goalType === 'boolean' ? 1 : Math.max(1, Math.round(spec.goalTarget * (0.6 + rand() * 0.6)));

      await db
        .insert(habitEntries)
        .values({
          id: newId(),
          userId,
          habitId,
          date,
          count,
          value: spec.goalType === 'duration' ? count : null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing();
    }
  }

  console.log(
    `[seed] ${seedTasks.length} tasks (${createdTaskIds.length} top-level), ${eventSpecs.length} events, ` +
      `${habitSpecs.length} habits with 120 days of history`,
  );
}

async function main() {
  assertNotProduction();
  try {
    const userId = await findOrCreateUser();
    await seed(userId);
    console.log(`\n[seed] done. Sign in with:\n  email:    ${EMAIL}\n  password: ${PASSWORD}\n`);
  } catch (error) {
    console.error('[seed] failed:', error instanceof Error ? error.message : error);
    if (error instanceof Error && error.stack) console.error(error.stack);
    process.exitCode = 1;
  } finally {
    await closeDb();
  }
}

const invokedDirectly = process.argv[1]?.includes('seed');
if (invokedDirectly) {
  void main();
}
