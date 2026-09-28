/**
 * Provisioning the sample account on demand.
 *
 * ## Why this exists rather than relying on the seed
 *
 * The sample account was created by `npm run db:seed`, and the Docker image runs
 * **migrations only** — never the seed. So on every deployed instance the sample
 * account did not exist, `resolveSampleUserId()` returned `null`, and demo mode
 * silently fell through to the signed-in user: the user switched demo mode on and
 * saw their *own* empty period history, which reads as "demo mode is broken".
 *
 * It was broken in exactly the way the earlier comment warned about — a demo that
 * quietly shows your real data — and the fix is to stop depending on a step that a
 * deployment does not run.
 *
 * ## What it creates
 *
 * Enough to make the period interface worth looking at, since that is the screen
 * the user was trying to see: eight cycles with plausible variation, flow logged on
 * the bleeding days, a few symptoms, and two contraception methods. Dates are
 * **relative to today**, so the demo does not go stale.
 *
 * It runs once, on the first request that asks for demo mode, and is idempotent by
 * checking for the account first.
 */
import { eq } from 'drizzle-orm';
import { DateTime } from 'luxon';
import { getDb } from '@/server/db';
import { ensureUserBootstrap } from '@/server/bootstrap';
import { newId } from '@/server/crypto';
import { contraceptionMethods, periodCycles, periodDayLogs, user } from '@/server/db/schema';
import { SAMPLE_EMAIL } from '@/server/demo';

const ZONE = 'UTC';

/** Bleeding days per cycle, by index — enough variation to look real. */
const CYCLE_LENGTHS = [28, 27, 29, 28, 26, 30, 28, 27];
const BLEED_DAYS = [5, 4, 5, 5, 4, 6, 5, 4];

const SYMPTOMS = ['cramps', 'headache', 'bloating', 'fatigue'];
const MOODS = ['calm', 'tired', 'irritable', 'happy'];

/**
 * Creates the sample account and its history if it is not already there.
 *
 * Returns the account id, or `null` if it could not be created — the caller then
 * leaves demo mode off rather than serving the real user's data under a demo label.
 */
export async function ensureSampleAccount(): Promise<string | null> {
  const db = getDb();

  const [existing] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, SAMPLE_EMAIL))
    .limit(1);
  if (existing) return existing.id;

  /*
   * Inserted with **no credential row**: registration here is invite-only, and an
   * account that exists to be looked at should not be sign-in-able. With no
   * `account` row there is no password hash to attack, and demo mode reaches it by
   * id, server-side, which is the only way in.
   */
  const id = newId();
  await db.insert(user).values({
    id,
    name: 'Sample Data',
    email: SAMPLE_EMAIL,
    emailVerified: true,
    isAdmin: false,
    timezone: ZONE,
  });

  // Gives it an Inbox, a default calendar and the rest of a new account's shape.
  await ensureUserBootstrap(id, ZONE, 1);

  const today = DateTime.now().setZone(ZONE).startOf('day');
  const total = CYCLE_LENGTHS.reduce((sum, n) => sum + n, 0);
  let start = today.minus({ days: total });

  for (const [index, length] of CYCLE_LENGTHS.entries()) {
    const bleed = BLEED_DAYS[index] ?? 5;
    await db
      .insert(periodCycles)
      .values({
        id: newId(),
        userId: id,
        startDate: start.toFormat('yyyy-MM-dd'),
        endDate: start.plus({ days: bleed - 1 }).toFormat('yyyy-MM-dd'),
        flowIntensity: index % 3 === 0 ? 'heavy' : 'medium',
      })
      .onConflictDoNothing();

    /*
     * Per-day logs for the first three bleeding days, and a symptom or two mid-cycle.
     * Without these the calendar has period days but nothing to show when a day is
     * opened, which is half the point of the demo.
     */
    for (let day = 0; day < bleed; day += 1) {
      const date = start.plus({ days: day });
      await db
        .insert(periodDayLogs)
        .values({
          id: newId(),
          userId: id,
          date: date.toFormat('yyyy-MM-dd'),
          flow: day < 2 ? 'heavy' : day < bleed - 1 ? 'medium' : 'light',
          symptoms: day === 0 ? [SYMPTOMS[index % SYMPTOMS.length]] : [],
          mood: day === 1 ? [MOODS[index % MOODS.length]] : [],
        })
        .onConflictDoNothing();
    }

    start = start.plus({ days: length });
  }

  /*
   * Two methods, one current and one past — so the contraception card shows history
   * rather than a single row, and the "a hormonal method is still in use" path has
   * something real to reason about.
   */
  await db
    .insert(contraceptionMethods)
    .values([
      {
        id: newId(),
        userId: id,
        method: 'pill',
        startDate: today.minus({ days: 400 }).toFormat('yyyy-MM-dd'),
        endDate: today.minus({ days: 120 }).toFormat('yyyy-MM-dd'),
      },
      {
        id: newId(),
        userId: id,
        method: 'ring',
        startDate: today.minus({ days: 118 }).toFormat('yyyy-MM-dd'),
        endDate: null,
        /*
         * 21 on, 7 off — the shape the user asked for by name ("on & off days"),
         * and what makes the contraception day log show a real cycle.
         */
        schedule: { onDays: 21, offDays: 7 },
      },
    ])
    .onConflictDoNothing();

  /*
   * Period mode **on** for the sample. It is a per-user setting and the sample has
   * its own — and without this `/period` redirects to the task list, so the demo
   * shows nothing of the interface it exists to demonstrate. The seed did this; a
   * lazily provisioned account has to do it too, or the two paths differ.
   */
  const { periodSettings } = await import('@/server/db/schema');
  await db
    .insert(periodSettings)
    .values({ userId: id, enabled: true })
    .onConflictDoUpdate({ target: periodSettings.userId, set: { enabled: true } });

  return id;
}
