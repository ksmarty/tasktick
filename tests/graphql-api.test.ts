/**
 * GraphQL API: token lifecycle, isolation, and the calls the user named.
 *
 * These tests go through the real route handler (`POST /api/graphql`) against a
 * real migrated SQLite file, so they cover the whole path: bearer parsing, token
 * resolution, context construction, the depth check, the resolvers and the
 * status mapping. The single most important case is the two-user one: a token
 * must only ever see and touch its own owner's data.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetEnvCache } from '@/lib/env';
import { resetDialectCache } from '@/server/db/dialect';
import { closeDb, getDb } from '@/server/db';
import { user } from '@/server/db/schema';
import { ensureUserBootstrap } from '@/server/bootstrap';
import { createTask, getTask } from '@/server/repos/tasks';
import { createHabit } from '@/server/repos/habits';
import { createEvent, listCalendars } from '@/server/repos/calendars';
import { createApiToken, getApiToken, issueApiToken, resolveApiToken, revokeApiToken } from '@/server/repos/api-tokens';
import { POST } from '@/app/api/graphql/route';

const SECRET = 'test-secret-test-secret-test-secret-0001';
const USER_A = 'user-a';
const USER_B = 'user-b';

let tempDir = '';

beforeEach(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tasktick-graphql-'));
  const file = path.join(tempDir, 'api.db');

  process.env.DATABASE_URL = `file:${file}`;
  process.env.BETTER_AUTH_SECRET = SECRET;
  process.env.APP_URL = 'http://127.0.0.1:3000';

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

  const db = getDb();
  await db.insert(user).values([
    { id: USER_A, name: 'Ada', email: 'ada@example.com', timezone: 'UTC' },
    { id: USER_B, name: 'Grace', email: 'grace@example.com', timezone: 'UTC' },
  ]);
  await ensureUserBootstrap(USER_A, 'UTC', 1);
  await ensureUserBootstrap(USER_B, 'UTC', 1);
});

afterEach(async () => {
  await closeDb();
  fs.rmSync(tempDir, { recursive: true, force: true });
});

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

interface GqlResponse {
  status: number;
  body: { data?: Record<string, unknown> | null; errors?: { message: string; extensions?: { code?: string } }[] };
}

async function gql(token: string | null, query: string, variables?: Record<string, unknown>): Promise<GqlResponse> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token) headers.authorization = `Bearer ${token}`;
  const req = new NextRequest('http://127.0.0.1:3000/api/graphql', {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const res = await POST(req);
  return { status: res.status, body: (await res.json()) as GqlResponse['body'] };
}

function codeOf(response: GqlResponse): string | undefined {
  return response.body.errors?.[0]?.extensions?.code;
}

/* -------------------------------------------------------------------------- */
/* transport + auth errors                                                    */
/* -------------------------------------------------------------------------- */

describe('graphql transport', () => {
  it('rejects a request with no token as a typed 401', async () => {
    const res = await gql(null, '{ me { id email } }');
    expect(res.status).toBe(401);
    expect(codeOf(res)).toBe('UNAUTHENTICATED');
    expect(res.body.data).toBeUndefined();
  });

  it('rejects a bad token as a typed 401, not a 500', async () => {
    const res = await gql('tt_not-a-real-token', '{ me { id } }');
    expect(res.status).toBe(401);
    expect(codeOf(res)).toBe('UNAUTHENTICATED');
  });

  it('reads with a good token', async () => {
    const token = await issueApiToken(USER_A);
    const res = await gql(token.plaintext, '{ me { id email timezone } }');
    expect(res.status).toBe(200);
    expect(res.body.errors).toBeUndefined();
    expect((res.body.data?.me as { email: string }).email).toBe('ada@example.com');
  });

  it('rejects a query deeper than the limit before executing it', async () => {
    const token = await issueApiToken(USER_A);
    const deep = `{ ${Array.from({ length: 15 }, (_, i) => `f${i} {`).join(' ')} id ${'}'.repeat(15)} }`;
    const res = await gql(token.plaintext, deep);
    expect(codeOf(res)).toBe('QUERY_TOO_DEEP');
  });

  it('serves introspection when authenticated', async () => {
    const token = await issueApiToken(USER_A);
    const res = await gql(token.plaintext, '{ __schema { queryType { name } } }');
    expect(res.status).toBe(200);
    expect((res.body.data?.__schema as { queryType: { name: string } }).queryType.name).toBe('Query');
  });
});

/* -------------------------------------------------------------------------- */
/* token lifecycle                                                            */
/* -------------------------------------------------------------------------- */

describe('token lifecycle', () => {
  it('keeps exactly one token per account', async () => {
    await issueApiToken(USER_A);
    await issueApiToken(USER_A);
    const view = await getApiToken(USER_A);
    expect(view).not.toBeNull();
    // A second issue replaced the first rather than adding a row.
    const first = await issueApiToken(USER_A);
    const second = await issueApiToken(USER_A);
    expect(await resolveApiToken(first.plaintext)).toBeNull();
    expect(await resolveApiToken(second.plaintext)).toEqual({ userId: USER_A });
  });

  it('refuses createApiToken when a token already exists', async () => {
    await issueApiToken(USER_A);
    await expect(createApiToken(USER_A)).rejects.toThrow('exists');
  });

  it('cycling invalidates the old token immediately and the new one works', async () => {
    const oldToken = await issueApiToken(USER_A);
    const before = await gql(oldToken.plaintext, '{ me { id } }');
    expect(before.status).toBe(200);

    const newToken = await issueApiToken(USER_A);
    const oldAfter = await gql(oldToken.plaintext, '{ me { id } }');
    const newAfter = await gql(newToken.plaintext, '{ me { id } }');
    expect(oldAfter.status).toBe(401);
    expect(codeOf(oldAfter)).toBe('UNAUTHENTICATED');
    expect(newAfter.status).toBe(200);
  });

  it('revoking stops the token working', async () => {
    const token = await issueApiToken(USER_A);
    await revokeApiToken(USER_A);
    expect(await resolveApiToken(token.plaintext)).toBeNull();
    const res = await gql(token.plaintext, '{ me { id } }');
    expect(res.status).toBe(401);
  });

  it("a banned account's token stops working", async () => {
    const token = await issueApiToken(USER_A);
    const db = getDb();
    await db.update(user).set({ banned: true }).where(eq(user.id, USER_A));
    expect(await resolveApiToken(token.plaintext)).toBeNull();
    const res = await gql(token.plaintext, '{ me { id } }');
    expect(res.status).toBe(401);
  });

  it('a deleted account takes its token with it (cascade)', async () => {
    const token = await issueApiToken(USER_A);
    const db = getDb();
    await db.delete(user).where(eq(user.id, USER_A));
    expect(await resolveApiToken(token.plaintext)).toBeNull();
  });

  it('never returns the plaintext from a metadata read', async () => {
    const token = await issueApiToken(USER_A);
    const view = await getApiToken(USER_A);
    expect(JSON.stringify(view)).not.toContain(token.plaintext);
    expect(view?.prefix.startsWith('tt_')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* two-user isolation — the most important guarantee                          */
/* -------------------------------------------------------------------------- */

describe('two-user isolation', () => {
  it("user A's token cannot read user B's task", async () => {
    const taskB = await createTask(USER_B, { title: 'B private task' }, 'UTC');
    const tokenA = await issueApiToken(USER_A);

    const res = await gql(tokenA.plaintext, 'query($id: ID!) { task(id: $id) { id title } }', { id: taskB.id });
    expect(res.status).toBe(200);
    expect(res.body.data?.task).toBeNull();
  });

  it("user A's token cannot mutate user B's task", async () => {
    const taskB = await createTask(USER_B, { title: 'B private task' }, 'UTC');
    const tokenA = await issueApiToken(USER_A);

    const res = await gql(
      tokenA.plaintext,
      'mutation($id: ID!) { updateTask(id: $id, input: { title: "hijacked" }) { id title } }',
      { id: taskB.id },
    );
    expect(codeOf(res)).toBe('NOT_FOUND');

    const stillB = await getTask(USER_B, taskB.id);
    expect(stillB?.title).toBe('B private task');
  });

  it("user A's token cannot delete user B's task", async () => {
    const taskB = await createTask(USER_B, { title: 'B private task' }, 'UTC');
    const tokenA = await issueApiToken(USER_A);

    const res = await gql(tokenA.plaintext, 'mutation($id: ID!) { deleteTask(id: $id) { deleted } }', { id: taskB.id });
    expect(codeOf(res)).toBe('NOT_FOUND');
    expect(await getTask(USER_B, taskB.id)).not.toBeNull();
  });

  it("user A's token cannot check in user B's habit", async () => {
    const habitB = await createHabit(USER_B, { name: 'B habit' }, 'UTC');
    const tokenA = await issueApiToken(USER_A);

    const res = await gql(tokenA.plaintext, 'mutation($id: ID!) { checkInHabit(id: $id, input: {}) { doneToday } }', {
      id: habitB.id,
    });
    expect(codeOf(res)).toBe('NOT_FOUND');
  });

  it("user A's own task is readable and mutable", async () => {
    const taskA = await createTask(USER_A, { title: 'A task' }, 'UTC');
    const tokenA = await issueApiToken(USER_A);

    const read = await gql(tokenA.plaintext, 'query($id: ID!) { task(id: $id) { id title } }', { id: taskA.id });
    expect((read.body.data?.task as { title: string }).title).toBe('A task');

    const write = await gql(
      tokenA.plaintext,
      'mutation($id: ID!) { updateTask(id: $id, input: { title: "A renamed" }) { id title } }',
      { id: taskA.id },
    );
    expect((write.body.data?.updateTask as { title: string }).title).toBe('A renamed');
  });
});

/* -------------------------------------------------------------------------- */
/* the case the user named: completing habits                                 */
/* -------------------------------------------------------------------------- */

describe('habit check-ins', () => {
  it('checks a habit in through GraphQL and reports it done today', async () => {
    const habit = await createHabit(USER_A, { name: 'Drink water', goalType: 'boolean' }, 'UTC');
    const token = await issueApiToken(USER_A);

    const res = await gql(
      token.plaintext,
      'mutation($id: ID!) { checkInHabit(id: $id, input: {}) { doneToday habit { id doneToday entries { date count } } } }',
      { id: habit.id },
    );

    expect(res.status).toBe(200);
    const payload = res.body.data?.checkInHabit as {
      doneToday: boolean;
      habit: { doneToday: boolean; entries: { date: string; count: number }[] };
    };
    expect(payload.doneToday).toBe(true);
    expect(payload.habit.doneToday).toBe(true);
    expect(payload.habit.entries.length).toBeGreaterThan(0);
  });

  it('increments a countable habit with delta', async () => {
    const habit = await createHabit(USER_A, { name: 'Push-ups', goalType: 'count', goalTarget: 10 }, 'UTC');
    const token = await issueApiToken(USER_A);

    const res = await gql(
      token.plaintext,
      'mutation($id: ID!) { checkInHabit(id: $id, input: { delta: 3 }) { habit { id entries { count } } } }',
      { id: habit.id },
    );
    const entries = (res.body.data?.checkInHabit as { habit: { entries: { count: number }[] } }).habit.entries;
    expect(entries.some((entry) => entry.count === 3)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* recurrence is expanded server-side                                         */
/* -------------------------------------------------------------------------- */

describe('calendar recurrence', () => {
  it('expands a recurring event into occurrences without client maths', async () => {
    const [calendar] = await listCalendars(USER_A);
    const startMs = Date.UTC(2026, 0, 5, 9, 0, 0);
    await createEvent(
      USER_A,
      {
        calendarId: calendar.id,
        summary: 'Daily stand-up',
        startMs,
        endMs: startMs + 30 * 60 * 1000,
        rrule: 'FREQ=DAILY;COUNT=5',
        isAllDay: false,
        timezone: 'UTC',
      },
      'UTC',
    );

    const token = await issueApiToken(USER_A);
    const res = await gql(
      token.plaintext,
      'query($s: Float!, $e: Float!) { calendarItems(startMs: $s, endMs: $e) { items { id title startMs isRecurringInstance } } }',
      { s: startMs, e: startMs + 3 * 86_400_000 },
    );

    const items = (res.body.data?.calendarItems as { items: { title: string; isRecurringInstance: boolean }[] }).items;
    const occurrences = items.filter((item) => item.title === 'Daily stand-up');
    expect(occurrences.length).toBeGreaterThan(1);
    expect(occurrences.every((item) => item.isRecurringInstance)).toBe(true);
  });
});
