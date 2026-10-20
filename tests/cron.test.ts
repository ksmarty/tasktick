/**
 * The cron reader behind the advanced repeat mode.
 *
 * Two things matter here and both are behavioural: an expression that is
 * understood must produce *both* halves of what the app stores (the RRULE for the
 * repeat, the minutes-of-day for the reminder), and an expression that is not
 * understood must come back with a sentence naming the field — never a silently
 * empty schedule. The error cases below are the ones a person actually types when
 * they get it wrong: four fields, a minute of 60, a day of the week of 8.
 */
import { describe, expect, it } from 'vitest';
import { cronTimeLabel, parseCron } from '@/lib/cron';

describe('parseCron', () => {
  it('reads a weekday expression as a weekly rule and one time of day', () => {
    const result = parseCron('0 9 * * 1-5');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rrule).toBe('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
    expect(result.minutesOfDay).toEqual([9 * 60]);
    expect(result.description).toBe('At 09:00, every weekday');
  });

  it('reads several times of day into the reminder list', () => {
    const result = parseCron('0 8,20 * * *');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.minutesOfDay).toEqual([8 * 60, 20 * 60]);
    expect(result.rrule).toBe('FREQ=DAILY');
    expect(result.description).toBe('At 08:00 and 20:00, every day');
  });

  it('reads a step as a range of times', () => {
    const result = parseCron('*/30 9-17 * * *');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Nine hours (9..17) at :00 and :30.
    expect(result.minutesOfDay).toHaveLength(18);
    expect(result.minutesOfDay[0]).toBe(9 * 60);
    expect(result.minutesOfDay.at(-1)).toBe(17 * 60 + 30);
    expect(result.rrule).toBe('FREQ=DAILY');
  });

  it('reads a day of the month as a monthly rule', () => {
    const result = parseCron('0 9 1 * *');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rrule).toBe('FREQ=MONTHLY;BYMONTHDAY=1');
    expect(result.description).toBe('At 09:00, on the 1st of the month');
  });

  it('reads a day of the month inside a month as a yearly rule', () => {
    const result = parseCron('0 9 1 1 *');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rrule).toBe('FREQ=YEARLY;BYMONTHDAY=1;BYMONTH=1');
    expect(result.description).toContain('Jan');
  });

  it('reads the weekend as words rather than three day names', () => {
    const result = parseCron('30 7 * * 0,6');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.description).toBe('At 07:30, every weekend day');
  });

  it('folds cron’s Sunday 7 onto JavaScript’s 0', () => {
    const result = parseCron('0 9 * * 7');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schedule.dayOfWeek).toEqual([0]);
    expect(result.rrule).toBe('FREQ=WEEKLY;BYDAY=SU');
  });

  it('accepts the shorthands, because they are easier to remember', () => {
    const result = parseCron('@daily');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.minutesOfDay).toEqual([0]);
    expect(result.rrule).toBe('FREQ=DAILY');
  });

  it('is case-insensitive and tolerates padding', () => {
    expect(parseCron('  0 9 * * *  ').ok).toBe(true);
    expect(parseCron('@WEEKLY').ok).toBe(true);
  });

  describe('refusals', () => {
    it('says how many fields it found', () => {
      const result = parseCron('0 9 * *');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('five fields');
      expect(result.error).toContain('4');
    });

    it('asks for an expression rather than accepting an empty one', () => {
      const result = parseCron('   ');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Type a cron expression');
    });

    it.each([
      ['60 9 * * *', 'minute'],
      ['0 24 * * *', 'hour'],
      ['0 9 0 * *', 'day of the month'],
      ['0 9 * 13 *', 'month'],
      ['0 9 * * 8', 'day of the week'],
      ['a b c d e', 'minute'],
    ])('names the field that is out of range in %s', (expression, field) => {
      const result = parseCron(expression);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain(field);
    });

    it('refuses a step of zero, a doubled slash and an empty list entry', () => {
      for (const expression of ['*/0 9 * * *', '0 9/2/3 * * *', '0 9,, * * *']) {
        expect(parseCron(expression).ok).toBe(false);
      }
    });

    it('refuses a range that runs backwards', () => {
      const result = parseCron('0 9 * * 5-1');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('backwards');
    });

    it('refuses more times of day than a reminder list can hold', () => {
      const result = parseCron('* * * * *');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('32');
    });
  });
});

describe('cronTimeLabel', () => {
  it('writes minutes past midnight as a wall clock', () => {
    expect(cronTimeLabel(0)).toBe('00:00');
    expect(cronTimeLabel(9 * 60 + 5)).toBe('09:05');
    expect(cronTimeLabel(23 * 60 + 59)).toBe('23:59');
  });
});
