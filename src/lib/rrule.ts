/**
 * RRULE construction and human-readable description.
 *
 * Pure and dependency-free so it can run on both the client (rendering
 * "Repeats every 2 weeks on Mon") and the server (building the rule stored on a
 * task). Actual occurrence expansion is *not* here — that needs a real calendar
 * engine and lives server-side behind `@/server/recurrence`, so there is exactly
 * one implementation of the tricky part.
 */
import type { DateOnly } from './types';

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface RRuleSpec {
  freq: Freq;
  interval?: number;
  /** 0 = Sunday .. 6 = Saturday, matching JavaScript's `getDay()`. */
  byDay?: number[];
  byMonthDay?: number[];
  byMonth?: number[];
  count?: number;
  /** Inclusive end date, `YYYY-MM-DD` (floating, as RFC 5545 UNTIL demands). */
  until?: DateOnly;
}

const ICAL_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'] as const;
const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** Serialises a spec into an RRULE body (no leading `RRULE:`). */
export function buildRRule(spec: RRuleSpec): string {
  const parts: string[] = [`FREQ=${spec.freq}`];

  if (spec.interval && spec.interval > 1) parts.push(`INTERVAL=${Math.floor(spec.interval)}`);

  if (spec.byDay?.length) {
    const days = [...new Set(spec.byDay)].sort((a, b) => a - b).map((d) => ICAL_DAYS[d]).filter(Boolean);
    if (days.length) parts.push(`BYDAY=${days.join(',')}`);
  }

  if (spec.byMonthDay?.length) {
    parts.push(`BYMONTHDAY=${[...new Set(spec.byMonthDay)].sort((a, b) => a - b).join(',')}`);
  }

  if (spec.byMonth?.length) {
    parts.push(`BYMONTH=${[...new Set(spec.byMonth)].sort((a, b) => a - b).join(',')}`);
  }

  if (spec.count && spec.count > 0) parts.push(`COUNT=${Math.floor(spec.count)}`);
  else if (spec.until) parts.push(`UNTIL=${spec.until.replace(/-/g, '')}T235959Z`);

  return parts.join(';');
}

export interface ParsedRRule {
  freq: Freq | null;
  interval: number;
  byDay: number[];
  byMonthDay: number[];
  byMonth: number[];
  count: number | null;
  until: string | null;
}

export function parseRRule(rule: string | null | undefined): ParsedRRule {
  const empty: ParsedRRule = {
    freq: null,
    interval: 1,
    byDay: [],
    byMonthDay: [],
    byMonth: [],
    count: null,
    until: null,
  };
  if (!rule) return empty;

  const body = rule.replace(/^RRULE:/i, '');
  const out: ParsedRRule = { ...empty };
  const byDay: number[] = [];

  for (const chunk of body.split(';')) {
    const [rawKey, rawValue] = chunk.split('=');
    if (!rawKey || rawValue === undefined) continue;
    const key = rawKey.trim().toUpperCase();
    const value = rawValue.trim();

    switch (key) {
      case 'FREQ':
        if (['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(value.toUpperCase())) {
          out.freq = value.toUpperCase() as Freq;
        }
        break;
      case 'INTERVAL':
        out.interval = Math.max(1, Number.parseInt(value, 10) || 1);
        break;
      case 'BYDAY':
        for (const token of value.split(',')) {
          // Strip any ordinal prefix such as `2MO` (second Monday).
          const day = token.trim().slice(-2).toUpperCase();
          const index = ICAL_DAYS.indexOf(day as (typeof ICAL_DAYS)[number]);
          if (index >= 0) byDay.push(index);
        }
        break;
      case 'BYMONTHDAY':
        out.byMonthDay = value
          .split(',')
          .map((n) => Number.parseInt(n, 10))
          .filter((n) => Number.isFinite(n));
        break;
      case 'BYMONTH':
        out.byMonth = value
          .split(',')
          .map((n) => Number.parseInt(n, 10))
          .filter((n) => Number.isFinite(n));
        break;
      case 'COUNT':
        out.count = Number.parseInt(value, 10) || null;
        break;
      case 'UNTIL':
        out.until = value;
        break;
      default:
        break;
    }
  }

  out.byDay = [...new Set(byDay)].sort((a, b) => a - b);
  return out;
}

function joinList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** True when the rule means "every Monday–Friday". */
function isWeekdays(byDay: number[]): boolean {
  return byDay.length === 5 && [1, 2, 3, 4, 5].every((d) => byDay.includes(d));
}

/** Human summary of a rule, for the task detail sheet. */
export function describeRRule(rule: string | null | undefined): string | null {
  if (!rule) return null;
  const parsed = parseRRule(rule);
  if (!parsed.freq) return null;

  const every = parsed.interval > 1 ? `Every ${parsed.interval} ` : 'Every ';
  const unit = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' }[parsed.freq];
  let text: string;

  if (parsed.freq === 'WEEKLY') {
    if (isWeekdays(parsed.byDay)) {
      text = parsed.interval > 1 ? `Every ${parsed.interval} weeks on weekdays` : 'Every weekday';
    } else if (parsed.byDay.length) {
      const days = parsed.byDay.map((d) => DAY_LABELS[d]);
      text = `${every}${parsed.interval > 1 ? 'weeks' : 'week'} on ${joinList(days)}`;
    } else {
      text = `${every}${unit}`;
    }
  } else if (parsed.freq === 'MONTHLY' && parsed.byMonthDay.length) {
    const days = parsed.byMonthDay.map((d) => ordinal(d));
    text = `${every}${unit} on the ${joinList(days)}`;
  } else if (parsed.freq === 'YEARLY' && parsed.byMonth.length) {
    const months = parsed.byMonth.map((m) => MONTH_LABELS[m - 1]).filter(Boolean);
    text = `${every}${unit} in ${joinList(months)}`;
  } else {
    text = `${every}${unit}`;
  }

  if (parsed.count) text += `, ${parsed.count} times`;
  else if (parsed.until) text += `, until ${formatUntil(parsed.until)}`;

  return text;
}

function ordinal(n: number): string {
  const abs = Math.abs(n);
  const suffix =
    abs % 100 >= 11 && abs % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][abs % 10] ?? 'th';
  return `${n}${suffix}`;
}

function formatUntil(raw: string): string {
  const match = /^(\d{4})(\d{2})(\d{2})/.exec(raw);
  if (!match) return raw;
  return `${match[3]}/${match[2]}/${match[1]}`;
}

/**
 * Quick-add presets, in the order they appear in the repeat picker.
 * `byDay` is filled in from the task's current due date at selection time.
 */
export interface RepeatPreset {
  id: string;
  label: string;
  build: (context: { dueDay: number; dueDate: DateOnly | null }) => RRuleSpec | null;
}

export const REPEAT_PRESETS: RepeatPreset[] = [
  { id: 'none', label: 'Never', build: () => null },
  { id: 'daily', label: 'Every day', build: () => ({ freq: 'DAILY' }) },
  { id: 'weekdays', label: 'Every weekday', build: () => ({ freq: 'WEEKLY', byDay: [1, 2, 3, 4, 5] }) },
  { id: 'weekly', label: 'Every week', build: ({ dueDay }) => ({ freq: 'WEEKLY', byDay: [dueDay] }) },
  { id: 'biweekly', label: 'Every 2 weeks', build: ({ dueDay }) => ({ freq: 'WEEKLY', interval: 2, byDay: [dueDay] }) },
  { id: 'monthly', label: 'Every month', build: () => ({ freq: 'MONTHLY' }) },
  { id: 'yearly', label: 'Every year', build: () => ({ freq: 'YEARLY' }) },
];

/** True when the rule is a plain, human-friendly preset (drives the picker UI). */
export function matchPreset(rule: string | null | undefined, dueDay: number): string {
  if (!rule) return 'none';
  const parsed = parseRRule(rule);
  for (const preset of REPEAT_PRESETS) {
    const spec = preset.build({ dueDay, dueDate: null });
    if (!spec) continue;
    if (buildRRule(spec) === rule.replace(/^RRULE:/i, '')) return preset.id;
  }
  if (parsed.freq === 'WEEKLY' && parsed.interval === 1) return 'weekly';
  if (parsed.freq === 'MONTHLY') return 'monthly';
  if (parsed.freq === 'YEARLY') return 'yearly';
  if (parsed.freq === 'DAILY') return 'daily';
  return 'custom';
}

/** Weekday index (0 = Sunday) for a floating date, without timezone maths. */
export function weekdayOfDate(date: DateOnly): number {
  const [y, m, d] = date.split('-').map((n) => Number.parseInt(n, 10));
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}
