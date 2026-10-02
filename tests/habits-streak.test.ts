/**
 * A streak reaches back through the habit's whole life, not through the window
 * the screen happens to be showing.
 *
 * The bug this pins: `listHabits` derived `streak` from the same `from`/`to` it
 * read entries with, and that window is a *display* window — the habits screen
 * scopes it to the visible month and never lets it start later than the current
 * week. So a habit checked in three days running, opened on the Monday that
 * followed, reported a **1-day** streak: the read began on the Monday, so the
 * walk back had nothing to see and stopped. The number was a property of the
 * window rather than of the habit, which is why it stayed at 1 no matter which
 * day was selected — and why a habit's own history could disagree with itself
 * between two screens.
 *
 * The first two tests are the same habit read two ways and must agree. That is
 * the whole shape of the bug: the value is not allowed to depend on `from`.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addDaysToDateOnly, todayIn } from '@/lib/dates';
import { checkIn, createHabit, listHabits } from '@/server/repos/habits';
import type { DateOnly, Habit } from '@/lib/types';
import { disposeTempDatabase, seedAccount, useTempDatabase } from './sync-helpers';

const ZONE = 'UTC';
const WEEK_STARTS_ON = 1;

let databaseFile = '';

beforeEach(async () => {
  databaseFile = await useTempDatabase();
});

afterEach(async () => {
  await disposeTempDatabase(databaseFile);
});

/** A daily boolean habit that has existed since `startedOn`. */
async function seedDailyHabit(userId: string, startedOn: DateOnly): Promise<Habit> {
  return createHabit(
    userId,
    {
      name: 'Read 20 pages',
      goalType: 'boolean',
      goalTarget: 1,
      frequency: 'daily',
      startDate: startedOn,
    },
    ZONE,
  );
}

/** Reads the list through an explicit display window, as a screen would. */
async function readThroughWindow(
  userId: string,
  from: DateOnly,
  to: DateOnly,
): Promise<Habit | undefined> {
  const habits = await listHabits({ userId, zone: ZONE, weekStartsOn: WEEK_STARTS_ON, from, to });
  return habits[0];
}

describe('a streak is read from the habit, not from the window', () => {
  it('counts three consecutive days even when the window starts today', async () => {
    const { userId } = await seedAccount();
    const today = todayIn(ZONE);
    const threeDaysAgo = addDaysToDateOnly(today, -2, ZONE);
    const habit = await seedDailyHabit(userId, threeDaysAgo);

    for (const offset of [2, 1, 0]) {
      await checkIn(userId, habit.id, { date: addDaysToDateOnly(today, -offset, ZONE), count: 1 }, ZONE);
    }

    // The window a Monday morning gives you: it starts on the day you look.
    const narrow = await readThroughWindow(userId, today, today);
    expect(narrow?.streak).toBe(3);
  });

  it('reports the same streak through a month-wide window', async () => {
    const { userId } = await seedAccount();
    const today = todayIn(ZONE);
    const threeDaysAgo = addDaysToDateOnly(today, -2, ZONE);
    const habit = await seedDailyHabit(userId, threeDaysAgo);

    for (const offset of [2, 1, 0]) {
      await checkIn(userId, habit.id, { date: addDaysToDateOnly(today, -offset, ZONE), count: 1 }, ZONE);
    }

    const wide = await readThroughWindow(userId, addDaysToDateOnly(today, -30, ZONE), today);
    expect(wide?.streak).toBe(3);

    // And the two windows agree, which is the property the bug broke.
    const narrow = await readThroughWindow(userId, today, today);
    expect(narrow?.streak).toBe(wide?.streak);
  });

  it('still reads a genuine one-day streak as one', async () => {
    const { userId } = await seedAccount();
    const today = todayIn(ZONE);
    const habit = await seedDailyHabit(userId, addDaysToDateOnly(today, -10, ZONE));
    await checkIn(userId, habit.id, { date: today, count: 1 }, ZONE);

    // Guards the other direction: a fix that simply counted every entry in the
    // habit's life would pass the two tests above and fail here.
    const read = await readThroughWindow(userId, today, today);
    expect(read?.streak).toBe(1);
  });

  it('breaks the streak on a missed day', async () => {
    const { userId } = await seedAccount();
    const today = todayIn(ZONE);
    const habit = await seedDailyHabit(userId, addDaysToDateOnly(today, -10, ZONE));

    // Yesterday and the day before are the gap; today and three days ago are in.
    await checkIn(userId, habit.id, { date: today, count: 1 }, ZONE);
    await checkIn(userId, habit.id, { date: addDaysToDateOnly(today, -3, ZONE), count: 1 }, ZONE);

    const read = await readThroughWindow(userId, today, today);
    expect(read?.streak).toBe(1);
  });

  it('does not let the display window shorten a streak that predates it', async () => {
    const { userId } = await seedAccount();
    const today = todayIn(ZONE);
    const habit = await seedDailyHabit(userId, addDaysToDateOnly(today, -40, ZONE));

    // Five days running, all of them before the window below starts.
    for (const offset of [5, 4, 3, 2, 1, 0]) {
      await checkIn(userId, habit.id, { date: addDaysToDateOnly(today, -offset, ZONE), count: 1 }, ZONE);
    }

    const read = await readThroughWindow(userId, addDaysToDateOnly(today, -2, ZONE), today);
    expect(read?.streak).toBe(6);
  });
});

/**
 * A streak is a run of days that were *done*, and the app lets any day be marked
 * after the fact — `checkIn` takes an arbitrary date and does not clamp it to the
 * habit's start date. So the run does not have to end on the day the habit was
 * created, and the walk back has to be allowed to cross that date.
 *
 * The bug this pins: the walk stopped as soon as it stepped before
 * `habit.startDate`, so a habit created today whose previous seven days were
 * filled in afterwards reported **no streak at all**. The days were stored, the
 * boxes were ticked, and the number said 0.
 */
describe('a streak counts days filled in after the fact', () => {
  it('counts a run that ends yesterday, on a habit created today', async () => {
    const { userId } = await seedAccount();
    const today = todayIn(ZONE);
    const habit = await seedDailyHabit(userId, today);

    // Seven days marked, today deliberately left alone.
    for (let offset = 1; offset <= 7; offset += 1) {
      await checkIn(userId, habit.id, { date: addDaysToDateOnly(today, -offset, ZONE), count: 1 }, ZONE);
    }

    const read = await readThroughWindow(userId, today, today);
    expect(read?.streak).toBe(7);
  });

  it('counts the same run on a habit older than it', async () => {
    const { userId } = await seedAccount();
    const today = todayIn(ZONE);
    const habit = await seedDailyHabit(userId, addDaysToDateOnly(today, -60, ZONE));

    for (let offset = 1; offset <= 7; offset += 1) {
      await checkIn(userId, habit.id, { date: addDaysToDateOnly(today, -offset, ZONE), count: 1 }, ZONE);
    }

    const read = await readThroughWindow(userId, today, today);
    expect(read?.streak).toBe(7);
  });

  it('still stops at a day that was genuinely missed', async () => {
    const { userId } = await seedAccount();
    const today = todayIn(ZONE);
    const habit = await seedDailyHabit(userId, today);

    // Yesterday and the day before are in; three days ago is the gap.
    for (const offset of [1, 2]) {
      await checkIn(userId, habit.id, { date: addDaysToDateOnly(today, -offset, ZONE), count: 1 }, ZONE);
    }
    for (let offset = 4; offset <= 10; offset += 1) {
      await checkIn(userId, habit.id, { date: addDaysToDateOnly(today, -offset, ZONE), count: 1 }, ZONE);
    }

    // Guards the other direction: walking past `startDate` must not turn the
    // count into "every entry the habit ever had".
    const read = await readThroughWindow(userId, today, today);
    expect(read?.streak).toBe(2);
  });
});
