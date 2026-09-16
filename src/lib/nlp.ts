/**
 * Natural-language quick add — the feature that makes a task app feel fast.
 *
 * Pure and deterministic: the same input always produces the same parse, in
 * every timezone, with no network access. That is a hard requirement because it
 * runs on every keystroke for live preview.
 *
 * Supported grammar (case-insensitive):
 *
 *   Dates    today · tomorrow · tonight · yesterday
 *            next week · next month · next year
 *            monday … sunday · next friday · this tuesday
 *            in 3 days · in 2 weeks · in 1 month
 *            2025-05-12 · 12/05 · 12/05/2025 · 12 may · may 12 · may 12 2025
 *   Times    5pm · 5:30pm · 17:30 · at 9 · at 09:15
 *   Repeats  daily · weekly · monthly · yearly
 *            every day · every weekday · every monday · every 2 weeks · every 3 months
 *   Meta     !high !medium !low !1 !2 !3 !!! !! ! "#work
 *            @Groceries            (list)
 *            ~45m ~2h ~1h30m       (time estimate)
 *
 * Deliberately *not* supported: relative phrases that need a conversation
 * ("sometime next spring"), and locale-specific date formats beyond the ones
 * listed. Anything unrecognised stays in the title, which is always the safe
 * failure mode — a user would rather see "buy milk next blursday" than lose text.
 */
import { DateTime } from 'luxon';
import { buildRRule, type Freq } from './rrule';
import { DATE_FORMAT } from './dates';
import type { DateOnly, Priority } from './types';

export interface QuickAddMatch {
  kind: 'date' | 'time' | 'repeat' | 'priority' | 'tag' | 'list' | 'estimate';
  /** The exact substring that was consumed. */
  text: string;
  /** Character offset in the *original* input, for highlight rendering. */
  index: number;
}

export interface QuickAddResult {
  /** Input with every recognised fragment removed. */
  title: string;
  dueDate: DateOnly | null;
  /** `HH:mm`, 24-hour. Null when the input carried no clock time. */
  dueTime: string | null;
  isAllDay: boolean;
  priority: Priority;
  tags: string[];
  listName: string | null;
  estimateMinutes: number | null;
  recurrenceRule: string | null;
  matches: QuickAddMatch[];
  /** True when nothing beyond a title was recognised. */
  isPlain: boolean;
}

export interface QuickAddOptions {
  /** IANA zone used to resolve "today" and bare weekdays. */
  zone: string;
  weekStartsOn?: number;
  /** Injectable clock, for tests. */
  now?: DateTime;
}

const WEEKDAYS: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

/**
 * A working buffer that records where each consumed fragment came from, so the
 * UI can highlight exactly what was understood.
 */
class Scanner {
  private buf: string;
  readonly matches: QuickAddMatch[] = [];
  private consumed = '';

  constructor(input: string) {
    this.buf = input;
    this.consumed = '\u0000'.repeat(input.length);
  }

  get text(): string {
    return this.buf;
  }

  /** Tries each pattern in order and applies the first one that matches. */
  tryMatch(kind: QuickAddMatch['kind'], patterns: RegExp[], onMatch: (m: RegExpMatchArray) => boolean): boolean {
    for (const pattern of patterns) {
      const match = pattern.exec(this.buf);
      if (!match) continue;
      if (!onMatch(match)) continue;
      const start = match.index;
      this.record(kind, match[0], start);
      this.erase(start, match[0].length);
      return true;
    }
    return false;
  }

  /** Same as `tryMatch` but keeps matching until no pattern applies. */
  tryMatchAll(kind: QuickAddMatch['kind'], pattern: RegExp, onMatch: (m: RegExpMatchArray) => void): void {
    const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (;;) {
      const match = global.exec(this.buf);
      if (!match) return;
      const start = match.index;
      onMatch(match);
      this.record(kind, match[0], start);
      this.erase(start, match[0].length);
    }
  }

  private record(kind: QuickAddMatch['kind'], text: string, index: number): void {
    // Erasure always replaces N characters with N spaces, so the buffer length is
    // invariant and these offsets stay valid against the ORIGINAL input. That is
    // what lets the UI highlight the understood fragments in place.
    this.matches.push({ kind, text: text.trim(), index });
  }

  private erase(start: number, length: number): void {
    this.buf = this.buf.slice(0, start) + ' '.repeat(length) + this.buf.slice(start + length);
  }

  /** Public so the time/priority sections can apply a match they selected themselves. */
  eraseAt(start: number, length: number): void {
    this.erase(start, length);
  }

  recordMatch(kind: QuickAddMatch['kind'], text: string, index: number): void {
    this.record(kind, text, index);
  }

  /** Remaining text with all consumed fragments blanked out. */
  remaining(): string {
    return this.buf;
  }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Resolves a bare hour to a 24-hour value.
 *
 * Documented heuristic: `at 1`–`at 7` means afternoon/evening (13:00–19:00),
 * because that is overwhelmingly what people mean when they say "lunch at 1".
 * `at 8`–`at 12` means morning; `at 13`+ is already 24-hour. An explicit
 * am/pm always wins over this.
 */
function resolveBareHour(hour: number): number {
  if (hour >= 13 && hour <= 23) return hour;
  if (hour === 0) return 0;
  if (hour >= 1 && hour <= 7) return hour + 12;
  if (hour >= 8 && hour <= 12) return hour;
  return hour;
}

function toTimeString(hour: number, minute: number): string | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${pad2(hour)}:${pad2(minute)}`;
}

/** Parses a duration literal such as `2h`, `45m`, `1h30m`, `1.5h`. */
export function parseDuration(raw: string): number | null {
  const cleaned = raw.trim().toLowerCase();
  if (!cleaned) return null;

  const hFromMinutes = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(\d+)\s*(?:m|min|mins|minute|minutes)?$/.exec(cleaned);
  if (hFromMinutes) {
    return Math.round(Number(hFromMinutes[1]) * 60 + Number(hFromMinutes[2]));
  }

  const hours = /^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)$/.exec(cleaned);
  if (hours) return Math.round(Number(hours[1]) * 60);

  const minutes = /^(\d+)\s*(?:m|min|mins|minute|minutes)$/.exec(cleaned);
  if (minutes) return Number(minutes[1]);

  return null;
}

export function parseQuickAdd(input: string, options: QuickAddOptions): QuickAddResult {
  const now = (options.now ?? DateTime.now().setZone(options.zone)).setZone(options.zone);
  const scanner = new Scanner(input);

  let priority: Priority = 'none';
  const tags: string[] = [];
  let listName: string | null = null;
  let estimateMinutes: number | null = null;
  let recurrenceRule: string | null = null;
  let dueDate: DateOnly | null = null;
  let dueTime: string | null = null;

  /* ---- 1. repeat rules (before dates, or "every monday" eats "monday") ---- */

  const weekdayNames = Object.keys(WEEKDAYS).join('|');
  const repeatHandled = scanner.tryMatch(
    'repeat',
    [
      // every weekday / every day / every week / every 2 weeks / every month
      /\bevery\s+(weekday|day|week|month|year|weekend)\b/i,
      // every N days/weeks/months/years
      /\bevery\s+(\d+)\s+(day|week|month|year)s?\b/i,
      // every monday / every mon, wed
      new RegExp(`\\bevery\\s+((?:${weekdayNames})s?)(?:\\s*(?:,|and|&)\\s*(?:${weekdayNames})s?)*\\b`, 'i'),
      // daily / weekly / monthly / yearly
      /\b(daily|weekly|monthly|yearly|annually)\b/i,
    ],
    (match) => {
      const lower = match[0].toLowerCase();
      const everyN = /\bevery\s+(\d+)\s+(day|week|month|year)s?\b/i.exec(lower);
      const everyUnit = /\bevery\s+(weekday|day|week|month|year|weekend)\b/i.exec(lower);

      if (everyN) {
        const interval = Number.parseInt(everyN[1], 10);
        const unit = everyN[2].toLowerCase() as 'day' | 'week' | 'month' | 'year';
        const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }[unit] as Freq;
        recurrenceRule = buildRRule({ freq, interval });
        return true;
      }

      if (everyUnit) {
        const unit = everyUnit[1].toLowerCase();
        if (unit === 'weekday') recurrenceRule = buildRRule({ freq: 'WEEKLY', byDay: [1, 2, 3, 4, 5] });
        else if (unit === 'weekend') recurrenceRule = buildRRule({ freq: 'WEEKLY', byDay: [0, 6] });
        else if (unit === 'day') recurrenceRule = buildRRule({ freq: 'DAILY' });
        else if (unit === 'week') recurrenceRule = buildRRule({ freq: 'WEEKLY' });
        else if (unit === 'month') recurrenceRule = buildRRule({ freq: 'MONTHLY' });
        else recurrenceRule = buildRRule({ freq: 'YEARLY' });
        return true;
      }

      if (/^every\s+/.test(lower)) {
        const days = [...lower.matchAll(new RegExp(weekdayNames, 'gi'))]
          .map((m) => WEEKDAYS[m[0].toLowerCase()])
          .filter((d): d is number => d !== undefined);
        if (!days.length) return false;
        recurrenceRule = buildRRule({ freq: 'WEEKLY', byDay: [...new Set(days)] });
        return true;
      }

      const word = lower.replace(/[^a-z]/g, '');
      const map: Record<string, Freq> = {
        daily: 'DAILY',
        weekly: 'WEEKLY',
        monthly: 'MONTHLY',
        yearly: 'YEARLY',
        annually: 'YEARLY',
      };
      if (!map[word]) return false;
      recurrenceRule = buildRRule({ freq: map[word] });
      return true;
    },
  );
  void repeatHandled;

  /* ---- 2. absolute dates that are not ambiguous with times ---- */

  scanner.tryMatch(
    'date',
    [
      // ISO
      /\b(\d{4})-(\d{2})-(\d{2})\b/,
      // 12/05 or 12/05/2025 or 12-05-2025, read as D/M(/Y)
      /\b(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?\b/,
      // 12 may / 12 may 2025
      new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${Object.keys(MONTHS).join('|')})\\.?(?:\\s+(\\d{4}))?\\b`, 'i'),
      // may 12 / may 12th, 2025
      new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i'),
    ],
    (match) => {
      const parsed = parseAbsoluteDate(match, now);
      if (!parsed) return false;
      dueDate = parsed.toFormat(DATE_FORMAT);
      return true;
    },
  );

  /* ---- 3. relative days and weekdays ---- */

  if (!dueDate) {
    scanner.tryMatch(
      'date',
      [
        /\btoday\b/i,
        /\btomorrow\b/i,
        /\btonight\b/i,
        /\byesterday\b/i,
        /\bnext\s+week\b/i,
        /\bnext\s+month\b/i,
        /\bnext\s+year\b/i,
        /\bin\s+(\d+)\s+(day|week|month|year)s?\b/i,
        new RegExp(`\\b(next|this|coming|last)?\\s*(${weekdayNames})\\b`, 'i'),
      ],
      (match) => {
        const lower = match[0].toLowerCase().trim();

        if (/^today\b/.test(lower)) {
          dueDate = now.toFormat(DATE_FORMAT);
          return true;
        }
        if (/^tomorrow\b/.test(lower)) {
          dueDate = now.plus({ days: 1 }).toFormat(DATE_FORMAT);
          return true;
        }
        if (/^tonight\b/.test(lower)) {
          dueDate = now.toFormat(DATE_FORMAT);
          if (!dueTime) dueTime = '20:00';
          return true;
        }
        if (/^yesterday\b/.test(lower)) {
          dueDate = now.minus({ days: 1 }).toFormat(DATE_FORMAT);
          return true;
        }
        if (/^next\s+week/.test(lower)) {
          dueDate = now.plus({ weeks: 1 }).toFormat(DATE_FORMAT);
          return true;
        }
        if (/^next\s+month/.test(lower)) {
          dueDate = now.plus({ months: 1 }).toFormat(DATE_FORMAT);
          return true;
        }
        if (/^next\s+year/.test(lower)) {
          dueDate = now.plus({ years: 1 }).toFormat(DATE_FORMAT);
          return true;
        }

        const inN = /^in\s+(\d+)\s+(day|week|month|year)/.exec(lower);
        if (inN) {
          const amount = Number.parseInt(inN[1], 10);
          const unit = inN[2] as 'day' | 'week' | 'month' | 'year';
          dueDate = now.plus({ [`${unit}s`]: amount }).toFormat(DATE_FORMAT);
          return true;
        }

        const weekdayMatch = new RegExp(`(next|this|coming|last)?\\s*(${weekdayNames})`, 'i').exec(lower);
        if (weekdayMatch) {
          const qualifier = weekdayMatch[1]?.toLowerCase();
          const target = WEEKDAYS[weekdayMatch[2].toLowerCase()];
          if (target === undefined) return false;

          // "next friday" always means the one in the following week, which is
          // what people expect even when today is Thursday.
          let delta = (target - now.weekday % 7 + 7) % 7;
          if (qualifier === 'next') delta = delta === 0 ? 7 : delta + 7;
          else if (qualifier === 'last') delta = delta === 0 ? -7 : delta - 7;
          else if (delta === 0) delta = 0;

          if (qualifier === 'next' && delta <= 7) delta = delta === 7 ? 7 : delta + 7;
          dueDate = now.plus({ days: delta }).toFormat(DATE_FORMAT);
          return true;
        }

        return false;
      },
    );
  }

  /* ---- 4. clock times ---- */

  //
  // Order matters and so does the optional `at ` prefix: matching bare `5pm`
  // first would leave a dangling "at" behind in the title, which is the classic
  // quick-add papercut. Patterns are anchored on a token boundary via
  // `(?:^|\s)` because `\b` does not fire between a space and `!`/`5`.
  //
  // Each entry carries its own group layout, so the handler is told which shape
  // matched instead of guessing from positional groups.
  //
  type TimeMatch = { hour: number; minute: number; meridiem?: string };

  const timePatterns: { re: RegExp; read: (m: RegExpMatchArray) => TimeMatch }[] = [
    // at 5pm / 5:30 pm / at 5:30pm
    {
      re: /(?:^|\s)(?:at\s+)?(\d{1,2}):(\d{2})\s*(am|pm)?(?=\s|$)/i,
      read: (m) => ({ hour: Number.parseInt(m[1], 10), minute: Number.parseInt(m[2], 10), meridiem: m[3] }),
    },
    // at 5pm / 5 pm
    {
      re: /(?:^|\s)(?:at\s+)?(\d{1,2})\s*(am|pm)(?=\s|$)/i,
      read: (m) => ({ hour: Number.parseInt(m[1], 10), minute: 0, meridiem: m[2] }),
    },
    // at 9 (bare hour, resolved by the documented heuristic)
    {
      re: /(?:^|\s)at\s+(\d{1,2})(?=\s|$)/i,
      read: (m) => ({ hour: Number.parseInt(m[1], 10), minute: 0 }),
    },
  ];

  for (const pattern of timePatterns) {
    const match = pattern.re.exec(scanner.text);
    if (!match) continue;

    const { hour: rawHour, minute, meridiem } = pattern.read(match);
    if (minute < 0 || minute > 59) continue;

    let hour = rawHour;
    if (meridiem) {
      if (rawHour < 1 || rawHour > 12) continue;
      const pm = meridiem.toLowerCase() === 'pm';
      if (pm && rawHour !== 12) hour += 12;
      if (!pm && rawHour === 12) hour = 0;
    } else if (pattern.re.source.includes('at\\s+')) {
      if (rawHour > 23) continue;
      hour = resolveBareHour(rawHour);
    } else if (rawHour > 23) {
      continue;
    }

    const time = toTimeString(hour, minute);
    if (!time) continue;

    dueTime = time;
    scanner.eraseAt(match.index, match[0].length);
    scanner.recordMatch('time', match[0], match.index);
    break;
  }

  /* ---- 5. priority ---- */

  //
  // Anchored on `(?:^|\s)` rather than `\b`: `!` is not a word character, so
  // `\b!high\b` can never match after a space.
  //
  const priorityPatterns: { re: RegExp; read: (m: RegExpMatchArray) => Priority }[] = [
    { re: /(?:^|\s)(!{3})(?=\s|$)/, read: () => 'high' },
    { re: /(?:^|\s)(!{2})(?=\s|$)/, read: () => 'medium' },
    { re: /(?:^|\s)(p[123])(?=\s|$)/i, read: (m) => ({ p1: 'high', p2: 'medium', p3: 'low' } as const)[m[1].toLowerCase() as 'p1' | 'p2' | 'p3'] },
    // `!1` / `!2` / `!3` — the shorthand a lot of people carry over from TickTick.
    {
      re: /(?:^|\s)(![123])(?=\s|$)/,
      read: (m) => ({ '!1': 'high', '!2': 'medium', '!3': 'low' } as const)[m[1] as '!1' | '!2' | '!3'],
    },
    { re: /(?:^|\s)(![123])(?=\s|$)/, read: (m) => ({ '!1': 'high', '!2': 'medium', '!3': 'low' } as const)[m[1] as '!1' | '!2' | '!3'] },
    {
      re: /(?:^|\s)(!(?:high|med|medium|low|none|h|m|l))(?=\s|$)/i,
      read: (m) => {
        const word = m[1].slice(1).toLowerCase();
        if (word === 'h' || word === 'high') return 'high';
        if (word === 'm' || word === 'med' || word === 'medium') return 'medium';
        if (word === 'l' || word === 'low') return 'low';
        return 'none';
      },
    },
    { re: /(?:^|\s)(!)(?=\s|$)/, read: () => 'low' },
  ];

  for (const pattern of priorityPatterns) {
    const match = pattern.re.exec(scanner.text);
    if (!match) continue;
    priority = pattern.read(match);
    scanner.eraseAt(match.index, match[0].length);
    scanner.recordMatch('priority', match[0], match.index);
    break;
  }

  /* ---- 6. tags ---- */

  scanner.tryMatchAll('tag', /(?:^|\s)#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu, (match) => {
    const name = match[1].trim();
    if (name && !tags.includes(name)) tags.push(name);
  });

  /* ---- 7. list ---- */

  scanner.tryMatch('list', [/(?:^|\s)@([\p{L}\p{N}][\p{L}\p{N}_-]*)/u], (match) => {
    listName = match[1].trim() || null;
    return Boolean(listName);
  });

  /* ---- 8. time estimate ---- */

  scanner.tryMatch('estimate', [/(?:^|\s)~(\d+(?:\.\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)?)/i], (match) => {
    const parsed = parseDuration(match[1]);
    if (parsed === null || parsed <= 0) return false;
    estimateMinutes = parsed;
    return true;
  });

  /* ---- 9. assemble ---- */

  const title = scanner
    .remaining()
    // Collapse the whitespace left by removed fragments without touching the
    // user's own intentional spacing inside the retained words.
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim();

  return {
    title,
    dueDate,
    dueTime,
    // A resolved date with no clock time is, by definition, an all-day item.
    isAllDay: dueDate !== null && dueTime === null,
    priority,
    tags,
    listName,
    estimateMinutes,
    recurrenceRule,
    matches: scanner.matches,
    isPlain: scanner.matches.length === 0,
  };
}

/**
 * Parses the matched absolute-date shape.
 *
 * Bare `D/M` with no year resolves forward: a date already past this year rolls
 * to next year, which matches user intent ("the 3rd of January" said in
 * December means the coming January).
 */
function parseAbsoluteDate(match: RegExpMatchArray, now: DateTime): DateTime | null {
  const raw = match[0];

  // ISO
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) {
    const dt = DateTime.fromObject(
      { year: +iso[1], month: +iso[2], day: +iso[3] },
      { zone: now.zoneName ?? 'utc' },
    );
    return dt.isValid ? dt.startOf('day') : null;
  }

  // D/M(/Y)
  const numeric = /^(\d{1,2})[/.](\d{1,2})(?:[/.](\d{2,4}))?$/.exec(raw);
  if (numeric) {
    const day = Number.parseInt(numeric[1], 10);
    const month = Number.parseInt(numeric[2], 10);
    let year = numeric[3] ? Number.parseInt(numeric[3], 10) : now.year;
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    let dt = DateTime.fromObject({ year, month, day }, { zone: now.zoneName ?? 'utc' }).startOf('day');
    if (!dt.isValid) return null;
    // No explicit year and the date already passed: roll forward.
    if (!numeric[3] && dt < now.startOf('day')) dt = dt.plus({ years: 1 });
    return dt;
  }

  // 12 may [2025]
  const dayFirst = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)?\\s+(${Object.keys(MONTHS).join('|')})\\.?(?:\\s+(\\d{4}))?$`, 'i').exec(raw);
  if (dayFirst) {
    const day = Number.parseInt(dayFirst[1], 10);
    const month = MONTHS[dayFirst[2].toLowerCase()];
    const year = dayFirst[3] ? Number.parseInt(dayFirst[3], 10) : now.year;
    return resolveMonthDay(month, day, year, Boolean(dayFirst[3]), now);
  }

  // may 12 [2025]
  const monthFirst = new RegExp(`^(${Object.keys(MONTHS).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`, 'i').exec(raw);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    const day = Number.parseInt(monthFirst[2], 10);
    const year = monthFirst[3] ? Number.parseInt(monthFirst[3], 10) : now.year;
    return resolveMonthDay(month, day, year, Boolean(monthFirst[3]), now);
  }

  return null;
}

function resolveMonthDay(month: number, day: number, year: number, yearExplicit: boolean, now: DateTime): DateTime | null {
  if (!month || day < 1 || day > 31) return null;
  const zone = now.zoneName ?? 'utc';
  let dt = DateTime.fromObject({ year, month, day }, { zone }).startOf('day');
  if (!dt.isValid) return null;
  if (!yearExplicit && dt < now.startOf('day')) {
    dt = DateTime.fromObject({ year: year + 1, month, day }, { zone }).startOf('day');
  }
  return dt.isValid ? dt : null;
}

/**
 * Extracts only the metadata a header-less Quick Add field needs, for callers
 * that just want a live badge ("Tomorrow 17:00 · High · #work").
 */
export function summarizeQuickAdd(result: QuickAddResult): string[] {
  const bits: string[] = [];
  if (result.dueDate) bits.push(result.dueDate);
  if (result.dueTime) bits.push(result.dueTime);
  if (result.priority !== 'none') bits.push(result.priority);
  if (result.recurrenceRule) bits.push('repeats');
  if (result.listName) bits.push(`@${result.listName}`);
  for (const tag of result.tags) bits.push(`#${tag}`);
  if (result.estimateMinutes) bits.push(`${result.estimateMinutes}m`);
  return bits;
}
