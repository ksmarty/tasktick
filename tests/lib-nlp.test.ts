import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { parseQuickAdd, parseDuration, summarizeQuickAdd } from '@/lib/nlp';
import { buildRRule, describeRRule, matchPreset, parseRRule, weekdayOfDate } from '@/lib/rrule';

/** A fixed "now" so the relative-date expectations never depend on the clock. */
const NOW = DateTime.fromISO('2025-03-10T09:00:00', { zone: 'Europe/Berlin' }); // a Monday

const parse = (input: string, zone = 'Europe/Berlin') => parseQuickAdd(input, { zone, weekStartsOn: 1, now: NOW.setZone(zone) });

describe('parseDuration', () => {
  it('parses hours, minutes and combined forms', () => {
    expect(parseDuration('2h')).toBe(120);
    expect(parseDuration('45m')).toBe(45);
    expect(parseDuration('1h30m')).toBe(90);
    expect(parseDuration('1.5h')).toBe(90);
    expect(parseDuration('90 min')).toBe(90);
  });

  it('rejects anything it cannot understand rather than guessing', () => {
    expect(parseDuration('soon')).toBeNull();
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('h')).toBeNull();
  });
});

describe('parseQuickAdd — dates', () => {
  it('resolves today, tomorrow and yesterday', () => {
    expect(parse('buy milk today').dueDate).toBe('2025-03-10');
    expect(parse('buy milk tomorrow').dueDate).toBe('2025-03-11');
    expect(parse('buy milk yesterday').dueDate).toBe('2025-03-09');
  });

  it('resolves bare weekdays forward within the week', () => {
    // 2025-03-10 is a Monday.
    expect(parse('standup tuesday').dueDate).toBe('2025-03-11');
    expect(parse('standup fri').dueDate).toBe('2025-03-14');
    // Same weekday as today stays today rather than jumping a week.
    expect(parse('standup monday').dueDate).toBe('2025-03-10');
  });

  it('treats "next <weekday>" as the following week', () => {
    // Monday + "next monday" must NOT be today.
    expect(parse('review next monday').dueDate).toBe('2025-03-17');
    expect(parse('review next friday').dueDate).toBe('2025-03-21');
  });

  it('supports "in N units"', () => {
    expect(parse('call in 3 days').dueDate).toBe('2025-03-13');
    expect(parse('call in 2 weeks').dueDate).toBe('2025-03-24');
    expect(parse('call in 1 month').dueDate).toBe('2025-04-10');
  });

  it('parses ISO dates', () => {
    expect(parse('ship 2025-12-24').dueDate).toBe('2025-12-24');
  });

  it('parses day-first numeric dates and rolls a past date forward a year', () => {
    expect(parse('ship 24/12').dueDate).toBe('2025-12-24');
    expect(parse('ship 05/01/2026').dueDate).toBe('2026-01-05');
    // 5 January has already passed on 10 March 2025, so it means next year.
    expect(parse('ship 05/01').dueDate).toBe('2026-01-05');
  });

  it('parses month names in both orders', () => {
    expect(parse('ship 12 may').dueDate).toBe('2025-05-12');
    expect(parse('ship may 12').dueDate).toBe('2025-05-12');
    expect(parse('ship 12th may 2026').dueDate).toBe('2026-05-12');
    expect(parse('ship may 12, 2026').dueDate).toBe('2026-05-12');
  });

  it('resolves "tonight" to today at 20:00', () => {
    const result = parse('call mum tonight');
    expect(result.dueDate).toBe('2025-03-10');
    expect(result.dueTime).toBe('20:00');
  });
});

describe('parseQuickAdd — times', () => {
  it('parses explicit am/pm', () => {
    expect(parse('standup 9am').dueTime).toBe('09:00');
    expect(parse('standup 5pm').dueTime).toBe('17:00');
    expect(parse('standup 5:30pm').dueTime).toBe('17:30');
    expect(parse('standup 12am').dueTime).toBe('00:00');
    expect(parse('standup 12pm').dueTime).toBe('12:00');
  });

  it('parses 24-hour times unambiguously', () => {
    expect(parse('deploy 17:30').dueTime).toBe('17:30');
    expect(parse('deploy 09:15').dueTime).toBe('09:15');
  });

  it('applies the documented bare-hour heuristic after "at"', () => {
    // 1-7 means afternoon/evening; 8-12 means morning; 13+ is already 24-hour.
    expect(parse('lunch at 1').dueTime).toBe('13:00');
    expect(parse('standup at 9').dueTime).toBe('09:00');
    expect(parse('deploy at 18').dueTime).toBe('18:00');
  });

  it('rejects an impossible clock time instead of accepting it', () => {
    expect(parse('deploy 25:99').dueTime).toBeNull();
  });

  it('combines a date and a time', () => {
    const result = parse('flight tomorrow 6:45am');
    expect(result.dueDate).toBe('2025-03-11');
    expect(result.dueTime).toBe('06:45');
    expect(result.isAllDay).toBe(false);
  });

  it('reports a date with no time as all-day', () => {
    const result = parse('sort taxes friday');
    expect(result.dueDate).toBe('2025-03-14');
    expect(result.dueTime).toBeNull();
    expect(result.isAllDay).toBe(true);
  });
});

describe('parseQuickAdd — metadata', () => {
  it('extracts tags without swallowing the rest of the title', () => {
    const result = parse('buy milk #groceries #errand');
    expect(result.tags).toEqual(['groceries', 'errand']);
    expect(result.title).toBe('buy milk');
  });

  it('does not treat a hash inside a word as a tag', () => {
    const result = parse('fix issue #123 in the parser');
    expect(result.tags).toEqual(['123']);
    expect(result.title).toContain('fix issue');
  });

  it('extracts the list', () => {
    const result = parse('renew passport @Errands');
    expect(result.listName).toBe('Errands');
    expect(result.title).toBe('renew passport');
  });

  it('extracts priority in every supported spelling', () => {
    expect(parse('task !high').priority).toBe('high');
    expect(parse('task !h').priority).toBe('high');
    expect(parse('task !1').priority).toBe('high');
    expect(parse('task p1').priority).toBe('high');
    expect(parse('task !!!').priority).toBe('high');
    expect(parse('task !!').priority).toBe('medium');
    expect(parse('task p2').priority).toBe('medium');
    expect(parse('task !low').priority).toBe('low');
    expect(parse('task !').priority).toBe('low');
    expect(parse('task !none').priority).toBe('none');
    expect(parse('task').priority).toBe('none');
  });

  it('extracts the time estimate', () => {
    expect(parse('write report ~2h').estimateMinutes).toBe(120);
    expect(parse('write report ~45m').estimateMinutes).toBe(45);
  });

  it('keeps an unrecognised estimate in the title rather than dropping text', () => {
    const result = parse('write report ~soon');
    expect(result.estimateMinutes).toBeNull();
    expect(result.title).toBe('write report ~soon');
  });
});

describe('parseQuickAdd — recurrence', () => {
  it('builds the expected RRULE for each phrase', () => {
    expect(parse('standup every day').recurrenceRule).toBe('FREQ=DAILY');
    expect(parse('standup daily').recurrenceRule).toBe('FREQ=DAILY');
    expect(parse('standup weekly').recurrenceRule).toBe('FREQ=WEEKLY');
    expect(parse('standup monthly').recurrenceRule).toBe('FREQ=MONTHLY');
    expect(parse('standup yearly').recurrenceRule).toBe('FREQ=YEARLY');
    expect(parse('standup every weekday').recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(parse('standup every weekend').recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=SU,SA');
    expect(parse('standup every 2 weeks').recurrenceRule).toBe('FREQ=WEEKLY;INTERVAL=2');
    expect(parse('standup every 3 months').recurrenceRule).toBe('FREQ=MONTHLY;INTERVAL=3');
  });

  it('handles "every monday" without the weekday also being read as a due date', () => {
    const result = parse('standup every monday');
    expect(result.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO');
    expect(result.dueDate).toBeNull();
    expect(result.title).toBe('standup');
  });

  it('handles multiple weekdays', () => {
    const result = parse('gym every mon, wed and fri');
    expect(result.recurrenceRule).toBe('FREQ=WEEKLY;BYDAY=MO,WE,FR');
  });
});

describe('parseQuickAdd — whole sentence', () => {
  it('pulls everything out of a busy line and leaves a clean title', () => {
    const result = parse('Submit the quarterly report tomorrow at 5pm #work !high @Office ~2h every week');

    expect(result.title).toBe('Submit the quarterly report');
    expect(result.dueDate).toBe('2025-03-11');
    expect(result.dueTime).toBe('17:00');
    expect(result.priority).toBe('high');
    expect(result.tags).toEqual(['work']);
    expect(result.listName).toBe('Office');
    expect(result.estimateMinutes).toBe(120);
    expect(result.recurrenceRule).toBe('FREQ=WEEKLY');
    expect(result.isPlain).toBe(false);
  });

  it('leaves a plain title untouched', () => {
    const result = parse('Buy milk');
    expect(result.title).toBe('Buy milk');
    expect(result.isPlain).toBe(true);
    expect(result.dueDate).toBeNull();
    expect(summarizeQuickAdd(result)).toEqual([]);
  });

  it('never loses text it did not understand', () => {
    const result = parse('ask blursday about the thing');
    expect(result.title).toBe('ask blursday about the thing');
  });

  it('collapses the whitespace left behind by removed fragments', () => {
    const result = parse('call   tomorrow   5pm   #home');
    expect(result.title).toBe('call');
  });
});

describe('RRULE helpers', () => {
  it('round-trips build -> parse', () => {
    const rule = buildRRule({ freq: 'WEEKLY', interval: 2, byDay: [1, 3] });
    expect(rule).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE');
    const parsed = parseRRule(rule);
    expect(parsed.freq).toBe('WEEKLY');
    expect(parsed.interval).toBe(2);
    expect(parsed.byDay).toEqual([1, 3]);
  });

  it('emits COUNT instead of UNTIL when both are present', () => {
    const rule = buildRRule({ freq: 'DAILY', count: 5, until: '2025-12-31' });
    expect(rule).toContain('COUNT=5');
    expect(rule).not.toContain('UNTIL');
  });

  it('describes rules in human language', () => {
    expect(describeRRule('FREQ=DAILY')).toBe('Every day');
    expect(describeRRule('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR')).toBe('Every weekday');
    expect(describeRRule('FREQ=WEEKLY;BYDAY=MO')).toBe('Every week on Mon');
    expect(describeRRule('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE')).toBe('Every 2 weeks on Mon and Wed');
    expect(describeRRule('FREQ=MONTHLY')).toBe('Every month');
    expect(describeRRule('FREQ=DAILY;COUNT=5')).toBe('Every day, 5 times');
    expect(describeRRule(null)).toBeNull();
  });

  it('tolerates a leading RRULE: prefix and ordinals in BYDAY', () => {
    const parsed = parseRRule('RRULE:FREQ=MONTHLY;BYDAY=2MO');
    expect(parsed.freq).toBe('MONTHLY');
    expect(parsed.byDay).toEqual([1]);
  });

  it('returns a null freq for nonsense rather than throwing', () => {
    expect(parseRRule('NONSENSE').freq).toBeNull();
    expect(describeRRule('NONSENSE')).toBeNull();
  });

  it('matches presets back to their ids', () => {
    expect(matchPreset(null, 1)).toBe('none');
    expect(matchPreset('FREQ=DAILY', 1)).toBe('daily');
    expect(matchPreset('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', 1)).toBe('weekdays');
    // Wednesday (3) - the preset is built from the task's own due weekday.
    expect(matchPreset('FREQ=WEEKLY;BYDAY=WE', 3)).toBe('weekly');
    expect(matchPreset('FREQ=WEEKLY;INTERVAL=2;BYDAY=WE', 3)).toBe('biweekly');
  });

  it('computes the weekday of a floating date without timezone drift', () => {
    expect(weekdayOfDate('2025-03-10')).toBe(1); // Monday
    expect(weekdayOfDate('2025-03-16')).toBe(0); // Sunday
    expect(weekdayOfDate('2025-01-01')).toBe(3); // Wednesday
  });
});
