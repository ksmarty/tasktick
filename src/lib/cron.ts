/**
 * A small cron reader, for the "advanced" repeat mode.
 *
 * The repeat control is a form of buttons — daily, every N weeks, the first
 * Monday of the month — which covers what most people want and cannot express
 * "every weekday except Wednesday, at 07:30 and 16:00". This is the escape hatch:
 * a five-field cron expression, read into the same two things the rest of the app
 * already stores — an RFC 5545 RRULE for *when* the item repeats, and a list of
 * minutes-of-day for *what time*.
 *
 * ## Why not a dependency
 *
 * The project forbids new runtime dependencies for something this small, and the
 * published parsers are either full schedulers (four hundred lines plus a timezone
 * engine) or so permissive that "0 99 * * *" parses. This one is deliberately
 * narrow: the fields, lists, ranges and steps that people actually type, five
 * fields only, and an error message that says what to write instead of a stack
 * trace. `@daily`-style shortcuts are accepted because they are easier to
 * remember than `0 0 * * *`.
 *
 * ## What it refuses, and why that is not a bug
 *
 * Cron is *not* a recurrence engine. `0 9,17 * * *` is two times a day, and an
 * RRULE for a task has one due time per occurrence — so the times go to the
 * reminder list and the days go to the rule. A tick past roughly a month of
 * occurrences is refused rather than silently truncated: `* * * * *` would
 * otherwise mean 1440 reminders.
 *
 * Pure, and imported by both the client (to describe what you typed as you type)
 * and the server (to reject an expression it cannot honour).
 */
import { buildRRule } from './rrule';

/** A parsed expression: each field as the explicit set of values it allows. */
export interface CronSchedule {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  /** 0 = Sunday, as JavaScript's `getDay()` — cron's 7 is folded to 0. */
  dayOfWeek: number[];
}

export type CronResult =
  | {
      ok: true;
      schedule: CronSchedule;
      /** Plain English, e.g. `At 09:00, every weekday`. */
      description: string;
      /** The repeat, as the RRULE body the app stores; `null` when it repeats daily. */
      rrule: string;
      /** The times of day, as minutes from midnight (the reminders field). */
      minutesOfDay: number[];
    }
  | { ok: false; error: string };

/** The most times of day one expression may name. */
const MAX_TIMES_PER_DAY = 32;

/** Shorthands people know, written out. */
const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
};

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/**
 * Reads an expression.
 *
 * Every failure returns the sentence to show the user, naming the field that is
 * wrong — a cron error is only useful if it says where to look.
 */
export function parseCron(expression: string): CronResult {
  const raw = expression.trim().toLowerCase();
  if (!raw) return { ok: false, error: 'Type a cron expression, or switch advanced mode off.' };

  const expanded = MACROS[raw] ?? raw;
  const fields = expanded.split(/\s+/);
  if (fields.length !== 5) {
    return {
      ok: false,
      error: `A cron expression has five fields — minute hour day-of-month month day-of-week. This one has ${fields.length}.`,
    };
  }

  const [minuteText, hourText, domText, monthText, dowText] = fields as [string, string, string, string, string];

  const minute = parseField(minuteText, 0, 59, 'minute');
  if (!minute.ok) return minute;
  const hour = parseField(hourText, 0, 23, 'hour');
  if (!hour.ok) return hour;
  const dayOfMonth = parseField(domText, 1, 31, 'day of the month');
  if (!dayOfMonth.ok) return dayOfMonth;
  const month = parseField(monthText, 1, 12, 'month');
  if (!month.ok) return month;
  const dayOfWeek = parseField(dowText, 0, 7, 'day of the week', { wrapSeven: true });
  if (!dayOfWeek.ok) return dayOfWeek;

  const times = hour.values.length * minute.values.length;
  if (times > MAX_TIMES_PER_DAY) {
    return {
      ok: false,
      error: `That names ${times} times a day, which is more than a reminder list can hold. Use at most ${MAX_TIMES_PER_DAY}.`,
    };
  }

  const schedule: CronSchedule = {
    minute: minute.values,
    hour: hour.values,
    dayOfMonth: dayOfMonth.values,
    month: month.values,
    dayOfWeek: dayOfWeek.values,
  };

  const minutesOfDay = schedule.hour
    .flatMap((h) => schedule.minute.map((m) => h * 60 + m))
    .sort((a, b) => a - b);

  return {
    ok: true,
    schedule,
    description: describeSchedule(schedule),
    rrule: cronToRrule(schedule),
    minutesOfDay,
  };
}

/**
 * The repeat part of the expression, as an RRULE body.
 *
 * Day-of-week wins over day-of-month, because that is what cron itself does when
 * both are restricted — and picking the other way would silently disagree with
 * every cron the user has written.
 */
export function cronToRrule(schedule: CronSchedule): string {
  const monthRestricted = !isWildcard(schedule.month, 1, 12);
  const dowRestricted = !isWildcard(schedule.dayOfWeek, 0, 6);
  const domRestricted = !isWildcard(schedule.dayOfMonth, 1, 31);

  if (dowRestricted) {
    return buildRRule({
      freq: 'WEEKLY',
      byDay: schedule.dayOfWeek,
      byMonth: monthRestricted ? schedule.month : undefined,
    });
  }
  if (domRestricted && monthRestricted) {
    return buildRRule({ freq: 'YEARLY', byMonth: schedule.month, byMonthDay: schedule.dayOfMonth });
  }
  if (domRestricted) return buildRRule({ freq: 'MONTHLY', byMonthDay: schedule.dayOfMonth });
  if (monthRestricted) return buildRRule({ freq: 'YEARLY', byMonth: schedule.month });
  return buildRRule({ freq: 'DAILY' });
}

/** `09:00` for 540. */
export function cronTimeLabel(minutesOfDay: number): string {
  const hours = Math.floor(minutesOfDay / 60);
  const minutes = minutesOfDay % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** The plain-English reading of a parsed schedule. */
export function describeSchedule(schedule: CronSchedule): string {
  const times = [...new Set(schedule.hour.flatMap((h) => schedule.minute.map((m) => h * 60 + m)))]
    .sort((a, b) => a - b)
    .map(cronTimeLabel);
  const timePart = times.length === 1 ? `at ${times[0]}` : `at ${times.slice(0, -1).join(', ')} and ${times.at(-1)}`;

  const monthPart = isWildcard(schedule.month, 1, 12)
    ? ''
    : ` in ${schedule.month.map((m) => MONTH_LABELS[m - 1]).join(', ')}`;

  if (!isWildcard(schedule.dayOfWeek, 0, 6)) {
    const days = schedule.dayOfWeek.map((d) => DAY_LABELS[d]).join(', ');
    const weekdays = sameDays(schedule.dayOfWeek, [1, 2, 3, 4, 5]);
    const weekend = sameDays(schedule.dayOfWeek, [0, 6]);
    if (weekdays) return `${capitalise(timePart)}, every weekday${monthPart}`;
    if (weekend) return `${capitalise(timePart)}, every weekend day${monthPart}`;
    return `${capitalise(timePart)}, every ${days}${monthPart}`;
  }

  if (!isWildcard(schedule.dayOfMonth, 1, 31)) {
    const days = schedule.dayOfMonth.map((d) => `${d}${ordinalSuffix(d)}`).join(', ');
    return `${capitalise(timePart)}, on the ${days} of the month${monthPart}`;
  }

  return `${capitalise(timePart)}, every day${monthPart}`;
}

type FieldParse = { ok: true; values: number[] } | { ok: false; error: string };

/**
 * One field, expanded to the values it allows.
 *
 * Syntax: `*`, `n`, `a-b`, `star/n`, `a-b/n`, and any comma-separated mix of those.
 * Anything else is an error naming the field, because a cron expression that
 * silently ignores a token is worse than one that refuses it.
 */
function parseField(text: string, min: number, max: number, label: string, options: { wrapSeven?: boolean } = {}): FieldParse {
  const values = new Set<number>();

  for (const part of text.split(',')) {
    if (!part) return { ok: false as const, error: `The ${label} field has an empty entry — check the commas.` };

    const [rangeText, stepText, ...rest] = part.split('/');
    if (rest.length) return { ok: false as const, error: `The ${label} field has more than one “/” in “${part}”.` };

    const step = stepText === undefined ? 1 : Number(stepText);
    if (stepText !== undefined && (!Number.isInteger(step) || step < 1)) {
      return { ok: false as const, error: `The step in the ${label} field (“${part}”) must be a whole number of 1 or more.` };
    }

    let from: number;
    let to: number;
    if (rangeText === '*') {
      from = min;
      to = max;
    } else if (rangeText.includes('-')) {
      const [startText, endText, ...extra] = rangeText.split('-');
      if (extra.length) return { ok: false as const, error: `The ${label} field has two ranges in “${part}”.` };
      from = Number(startText);
      to = Number(endText);
    } else {
      from = Number(rangeText);
      /* A bare number with a step is cron's shorthand for "from here onward". */
      to = stepText === undefined ? from : max;
    }

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      return { ok: false as const, error: `The ${label} field (“${part}”) is not a number, a range or a “*”.` };
    }

    const limit = options.wrapSeven ? 7 : max;
    if (from < min || from > limit || to < min || to > limit) {
      return { ok: false as const, error: `The ${label} field must stay between ${min} and ${limit}; “${part}” does not.` };
    }
    if (to < from) return { ok: false as const, error: `The range “${part}” in the ${label} field runs backwards.` };

    for (let value = from; value <= to; value += step) {
      values.add(options.wrapSeven && value === 7 ? 0 : value);
    }
  }

  return { ok: true, values: [...values].sort((a, b) => a - b) };
}

function isWildcard(values: number[], min: number, max: number): boolean {
  const expected = max - min + 1;
  return values.length === expected && values[0] === min && values.at(-1) === max;
}

function sameDays(values: number[], expected: number[]): boolean {
  return values.length === expected.length && values.every((value, index) => value === expected[index]);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function ordinalSuffix(day: number): string {
  if (day % 100 >= 11 && day % 100 <= 13) return 'th';
  if (day % 10 === 1) return 'st';
  if (day % 10 === 2) return 'nd';
  if (day % 10 === 3) return 'rd';
  return 'th';
}
