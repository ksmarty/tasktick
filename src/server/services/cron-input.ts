/**
 * Turning a cron expression into the fields a task actually stores.
 *
 * The advanced repeat control sends the expression itself, not the fields it
 * previews: the same reader (`@/lib/cron`) runs here, so a request cannot arrive
 * with a rule the UI derived and the server never checked. This is the one place
 * that decides what "0 9 * * 1-5" *means* for a stored task.
 *
 * ## What a cron expression can and cannot set on a task
 *
 * A task has one due instant per occurrence, so the day part of the expression
 * becomes the RRULE and the time part becomes the due time. When the expression
 * names several times of day, the earliest is the due time — the others are
 * reported in the description the control shows, but a task cannot be due at two
 * times on one date. It also gets a reminder at that instant, because "every
 * weekday at 09:00" that does not tell you at 09:00 is not a reminder schedule.
 */
import { badRequest } from '../http';
import { cronTimeLabel, parseCron } from '@/lib/cron';

/** The task fields an expression sets. */
export interface CronTaskFields {
  recurrenceRule: string;
  dueTime: string;
  reminders: { offsetMinutes: number }[];
}

/**
 * The fields for one expression, or a 400 whose message says what is wrong.
 *
 * The schema already refuses an unreadable expression, so reaching the error
 * here means the expression was read but names nothing usable — an empty time
 * list is the only way that happens today, and it is still better to say so than
 * to store a task that repeats forever at an unspecified time.
 */
export function cronTaskFields(cron: string): CronTaskFields {
  const parsed = parseCron(cron);
  if (!parsed.ok) throw badRequest(`That repeat expression cannot be read: ${parsed.error}`);

  const [first] = parsed.minutesOfDay;
  if (first === undefined) throw badRequest('That repeat expression names no time of day.');

  return {
    recurrenceRule: parsed.rrule,
    dueTime: cronTimeLabel(first),
    reminders: [{ offsetMinutes: 0 }],
  };
}

/**
 * Applies `cron`, when present, to a task body and drops the field itself.
 *
 * Written as a spread-returning helper rather than a mutation so both routes read
 * the same way, and so `cron` never reaches the repository — it is not a column
 * and an unknown key in a `TaskPatch` is a type error waiting to happen.
 */
export function withCron<T extends { cron?: string }>(input: T): Omit<T, 'cron'> & Partial<CronTaskFields> {
  const { cron, ...rest } = input;
  if (!cron) return rest;
  return { ...rest, ...cronTaskFields(cron) };
}
