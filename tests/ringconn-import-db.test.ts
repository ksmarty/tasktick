/**
 * Wearable import against a real migrated SQLite file.
 *
 * The parser tests prove the file is read correctly. These prove the thing a user
 * would actually lose sleep over: that importing a wearable export **cannot**
 * overwrite a value they recorded by hand, that it fills only what is empty, and
 * that running it twice changes nothing the second time.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { periodDayLogs, user } from '@/server/db/schema';
import { applyWearableImport } from '@/server/services/ringconn-import';
import { parseWearableText, type WearableImportPlan } from '@/lib/ringconn';

const USER_ID = 'user-ringconn-test';
const WRIST = 'HKQuantityTypeIdentifierAppleSleepingWristTemperature';
let tempDir = '';

const record = (attrs: Record<string, string>) =>
  `<Record ${Object.entries(attrs)
    .map(([key, value]) => `${key}="${value}"`)
    .join(' ')}/>`;

const temperature = (date: string, value: string, source = 'RingConn') =>
  record({
    type: WRIST,
    sourceName: source,
    unit: 'degC',
    startDate: `${date} 03:10:00 +0100`,
    endDate: `${date} 03:10:00 +0100`,
    value,
  });

const healthXml = (records: string[]) =>
  [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<HealthData locale="en_GB">',
    ' <ExportDate value="2026-09-27 12:00:00 +0100"/>',
    ...records.map((line) => ` ${line}`),
    '</HealthData>',
  ].join('\n');

async function planFor(records: string[]): Promise<WearableImportPlan> {
  const parsed = await parseWearableText(healthXml(records), 'export.xml');
  if (!parsed.ok) throw new Error(`fixture did not parse: ${parsed.error}`);
  return parsed.plan;
}

function apply(plan: WearableImportPlan) {
  return applyWearableImport({
    userId: USER_ID,
    plan,
    parseIssues: plan.issues,
    parseIssueCount: plan.issueCount,
    notes: plan.notes,
  });
}

const dayRows = () => getDb().select().from(periodDayLogs).where(eq(periodDayLogs.userId, USER_ID));

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-ringconn-'));
  const file = path.join(tempDir, 'import.db');
  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = 'test-secret-test-secret-test-secret-0001';

  resetEnvCache();
  resetDialectCache();
  await closeDb();

  const handle = new Database(file);
  try {
    handle.pragma('journal_mode = WAL');
    handle.pragma('foreign_keys = ON');
    migrate(drizzle(handle), { migrationsFolder: path.join(process.cwd(), 'drizzle', 'sqlite') });
  } finally {
    handle.close();
  }

  await getDb().insert(user).values({
    id: USER_ID,
    name: 'Ring',
    email: 'ring@example.test',
    emailVerified: true,
    timezone: 'UTC',
  });
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('applyWearableImport', () => {
  it('creates a day log for a date that had none, carrying only the temperature', async () => {
    const summary = await apply(await planFor([temperature('2026-01-01', '36.20'), temperature('2026-01-02', '36.35')]));

    expect(summary).toMatchObject({
      daysCreated: 2,
      daysUpdated: 0,
      daysUnchanged: 0,
      temperatureFilled: 2,
      temperatureKept: 0,
      weightFilled: 0,
      weightKept: 0,
    });

    const rows = await dayRows();
    expect(rows.map((row) => [row.date, row.temperatureC, row.flow, row.notes])).toEqual([
      ['2026-01-01', 36.2, null, null],
      ['2026-01-02', 36.35, null, null],
    ]);
  });

  it('fills an empty temperature but leaves everything else on the row alone', async () => {
    await getDb().insert(periodDayLogs).values({
      id: 'day-hand-written',
      userId: USER_ID,
      date: '2026-02-01',
      flow: 'medium',
      symptoms: ['cramps'],
      mood: ['calm'],
      temperatureC: null,
      notes: 'hand written note',
      intimacy: true,
    });

    const summary = await apply(await planFor([temperature('2026-02-01', '36.44')]));

    expect(summary).toMatchObject({ daysCreated: 0, daysUpdated: 1, temperatureFilled: 1, temperatureKept: 0 });

    const [row] = await dayRows();
    expect(row).toMatchObject({
      // The empty field is filled...
      temperatureC: 36.44,
      // ...and nothing the user wrote is touched.
      flow: 'medium',
      symptoms: ['cramps'],
      mood: ['calm'],
      notes: 'hand written note',
      intimacy: true,
    });
  });

  it('never overwrites a temperature the user recorded by hand, and says how many it kept', async () => {
    await getDb().insert(periodDayLogs).values({
      id: 'day-measured',
      userId: USER_ID,
      date: '2026-03-01',
      temperatureC: 36.78,
      notes: 'oral, before getting up',
    });

    const summary = await apply(
      await planFor([temperature('2026-03-01', '36.10'), temperature('2026-03-02', '36.22')]),
    );

    expect(summary).toMatchObject({
      daysCreated: 1,
      daysUpdated: 0,
      daysUnchanged: 1,
      temperatureFilled: 1,
      temperatureKept: 1,
    });
    // The merge rule is visible to the user, not just to the database.
    expect(summary.notes.join(' ')).toContain('left as it was');

    const rows = await dayRows();
    expect(rows.find((row) => row.date === '2026-03-01')).toMatchObject({
      temperatureC: 36.78,
      notes: 'oral, before getting up',
    });
    expect(rows.find((row) => row.date === '2026-03-02')).toMatchObject({ temperatureC: 36.22 });
  });

  it('changes nothing when the same file is imported twice', async () => {
    const plan = await planFor([temperature('2026-04-01', '36.11'), temperature('2026-04-02', '36.31')]);

    const first = await apply(plan);
    expect(first).toMatchObject({ daysCreated: 2, daysUpdated: 0, temperatureFilled: 2 });

    // Re-parsed, because the plan is inert and the second call is a fresh import.
    const second = await apply(await planFor([temperature('2026-04-01', '36.11'), temperature('2026-04-02', '36.31')]));
    expect(second).toMatchObject({
      daysCreated: 0,
      daysUpdated: 0,
      daysUnchanged: 2,
      temperatureFilled: 0,
      temperatureKept: 2,
    });

    expect((await dayRows()).map((row) => row.temperatureC).sort()).toEqual([36.11, 36.31]);
  });

  it('carries the parser’s row errors into the summary without losing the good days', async () => {
    const summary = await apply(
      await planFor([
        temperature('2026-05-01', '36.30'),
        temperature('not-a-date', '36.40'),
        temperature('2026-05-03', 'n/a'),
        temperature('2026-05-04', '36.60'),
      ]),
    );

    expect(summary.daysCreated).toBe(2);
    expect(summary.temperatureFilled).toBe(2);
    expect(summary.issueCount).toBe(2);
    expect(summary.issues.map((issue) => issue.row)).toEqual([2, 3]);
    expect((await dayRows()).map((row) => row.date)).toEqual(['2026-05-01', '2026-05-04']);
  });
});
