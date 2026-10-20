/**
 * What a cron expression means for a stored task, and what the API refuses.
 *
 * The client previews the expression with the same reader, so the interesting
 * question here is the *server's* half: an expression that arrives as typed must
 * come out as a repeat rule plus a due time the repository can store, and one it
 * cannot honour must be a 400 rather than a silently empty rule.
 */
import { describe, expect, it } from 'vitest';
import { cronTaskFields, withCron } from '@/server/services/cron-input';
import { createTaskSchema, updateTaskSchema } from '@/lib/schemas';

describe('cronTaskFields', () => {
  it('turns the expression into a repeat rule, a due time and a reminder at it', () => {
    expect(cronTaskFields('0 9 * * 1-5')).toEqual({
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      dueTime: '09:00',
      reminders: [{ offsetMinutes: 0 }],
    });
  });

  it('uses the earliest time of day when the expression names several', () => {
    // A task has one due instant per occurrence; the rest are still described in
    // the control, but cannot be a second due time.
    expect(cronTaskFields('0 20,8 * * *').dueTime).toBe('08:00');
  });

  it('pads a single-digit hour, because dueTime is a stored `HH:mm`', () => {
    expect(cronTaskFields('5 7 * * *').dueTime).toBe('07:05');
  });

  it('refuses an expression it cannot read, in the words the field showed', () => {
    expect(() => cronTaskFields('0 99 * * *')).toThrow(/cannot be read/);
  });
});

describe('withCron', () => {
  it('leaves a body alone when it carries no expression', () => {
    const body = { title: 'Water the plants' };
    expect(withCron(body)).toEqual(body);
    expect('cron' in withCron(body)).toBe(false);
  });

  it('adds the derived fields and drops the expression itself', () => {
    const fields = withCron({ title: 'Standup', cron: '30 9 * * 1-5' });
    expect(fields).toEqual({
      title: 'Standup',
      recurrenceRule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
      dueTime: '09:30',
      reminders: [{ offsetMinutes: 0 }],
    });
    // `cron` is not a column; sending it to the repository would be a silent typo.
    expect('cron' in fields).toBe(false);
  });
});

describe('the schemas', () => {
  it('accepts a readable expression on both bodies', () => {
    expect(createTaskSchema.safeParse({ title: 'A', cron: '0 9 * * 1-5' }).success).toBe(true);
    expect(updateTaskSchema.safeParse({ cron: '@daily' }).success).toBe(true);
  });

  it('refuses an unreadable one, with the reader’s own sentence', () => {
    const result = createTaskSchema.safeParse({ title: 'A', cron: '0 9 * *' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('five fields');
  });

  it('refuses an empty string, which would otherwise mean “not set”', () => {
    expect(updateTaskSchema.safeParse({ cron: '' }).success).toBe(false);
  });
});
