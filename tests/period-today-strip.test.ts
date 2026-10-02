/**
 * The Today screen's new structure: the week strip, the hero and the insights row.
 *
 * Two kinds of assertion, because two different things can go wrong:
 *
 *  · **A real property, measured.** The strip must never show a different week
 *    from the month grid. That is checkable without a browser: the screen takes
 *    its days from `rangeForView('month', …)` chunked by `buildMonthRows`, and the
 *    test below runs that exact pipeline for every date of several months and
 *    three week starts, asserting that the row holding a day begins on that user's
 *    week-start day. A source pin alone would not catch a wrong `weekStartsOn`
 *    being passed through.
 *  · **Pins on the decisions**, for the parts that are markup: the strip's
 *    semantics, the row's snap and gutters, and the action card's target.
 *
 * The client components cannot be rendered in this suite (node, no DOM), so the
 * markup pins name the expression that *is* the decision rather than a nearby
 * string — the same convention as the rest of the period tests.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMonthRows } from '@/components/calendar/geometry';
import { startOfWeekDate, rangeForView, addDaysToDateOnly } from '@/lib/dates';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

/**
 * The same source with its block comments removed.
 *
 * The doc comments in these files *explain* the decisions — including the ones
 * these tests rule out ("not a tablist", "no probability") — so a negative
 * assertion has to read the code rather than the prose around it.
 */
function code(relative: string): string {
  return source(relative).replace(/\/\*[\s\S]*?\*\//g, '');
}

const TODAY = source('components/period/TodayLogScreen.tsx');
const STRIP = source('components/period/WeekStrip.tsx');
const HERO = source('components/period/HeroCard.tsx');
const ROW = source('components/period/TodayInsightsRow.tsx');
const CYCLES = source('components/period/MyCyclesCard.tsx');

const ZONE = 'Europe/Berlin';
/** Sunday-first, Monday-first and Saturday-first — a user can set any of them. */
const WEEK_STARTS = [0, 1, 6];

/** Every day of May, August and the year boundary, which is where months are ragged. */
function sampleDates(): string[] {
  const anchors = ['2026-05-01', '2026-08-15', '2026-12-28', '2027-01-02'];
  const out: string[] = [];
  for (const anchor of anchors) {
    for (let offset = 0; offset < 35; offset += 5) out.push(addDaysToDateOnly(anchor, offset, ZONE));
  }
  return out;
}

describe('the strip is one row of the month grid', () => {
  it('chunks a month window so the row holding a day starts on the user’s week start', () => {
    for (const weekStartsOn of WEEK_STARTS) {
      for (const date of sampleDates()) {
        const range = rangeForView('month', date, ZONE, weekStartsOn);
        const rows = buildMonthRows(range.days, date);
        const row = rows.find((candidate) => candidate.some((cell) => cell.date === date));
        expect(row, `${date} / weekStartsOn=${weekStartsOn}`).toBeDefined();
        expect(row?.map((cell) => cell.date), `${date} / weekStartsOn=${weekStartsOn}`).toHaveLength(7);
        expect(row?.[0].date, `${date} / weekStartsOn=${weekStartsOn}`).toBe(
          startOfWeekDate(date, weekStartsOn, ZONE),
        );
      }
    }
  });

  it('is the same pipeline the screen actually runs, and the same the month grid collapses to', () => {
    // The screen: the range, then the chunking, then the row containing the
    // selected day — byte for byte the calls checked above.
    expect(TODAY).toContain("rangeForView('month', selectedDate, zone, weekStartsOn)");
    expect(TODAY).toContain('buildMonthRows(range.days, selectedDate)');
    expect(TODAY).toContain('range.startDate');
    expect(TODAY).toContain('range.endDate');
    // The one week-start setting, read from the shell's bootstrap payload.
    expect(TODAY).toContain('const { today, zone, weekStartsOn } = useTodayZone();');
    expect(TODAY).toContain('weekStartsOn={weekStartsOn}');
    // And the marks come from the month's own derivation, over the same days the
    // strip paints, so "is this a period day" cannot be answered two ways.
    expect(TODAY).toContain('marksForDays(range.days, data)');
    expect(TODAY).toContain('markFor={markFor}');
  });

  it('takes its captions from the month header’s own rotation helper', () => {
    expect(STRIP).toContain("weekdayLabels(weekStartsOn, 'initial')");
    expect(STRIP).toContain("from '@/components/calendar'");
  });

  it('moves the selection a week at a time, through the same helper the grid uses', () => {
    expect(TODAY).toContain('addDaysToDateOnly(selectedDate, -7, zone)');
    expect(TODAY).toContain('addDaysToDateOnly(selectedDate, 7, zone)');
  });
});

describe('the strip is a group of day buttons, not a tablist', () => {
  it('names the control and says which day is pressed', () => {
    expect(STRIP).toContain('role="group"');
    expect(STRIP).toContain('aria-pressed={selected}');
    expect(STRIP).toContain('aria-label={name}');
    // Today is stated the way the month grid's day buttons state it.
    expect(STRIP).toContain("aria-current={isToday ? 'date' : undefined}");
    // Not tabs: there is no tabpanel and nothing is hidden, so the roles must not
    // be borrowed from the tab bar.
    expect(code('components/period/WeekStrip.tsx')).not.toContain('tablist');
    expect(code('components/period/WeekStrip.tsx')).not.toContain('role="tab"');
  });

  it('is one tab stop with arrows that move and select, as the month lattice is', () => {
    expect(STRIP).toContain('tabIndex={focusDate === date ? 0 : -1}');
    expect(STRIP).toContain("case 'ArrowLeft':");
    expect(STRIP).toContain("case 'ArrowRight':");
    expect(STRIP).toContain("case 'Home':");
    expect(STRIP).toContain("case 'End':");
    expect(STRIP).toContain('onSelectDate(date);');
  });

  it('announces the period mark with the same words the month uses', () => {
    expect(STRIP).toContain('markWords(marks)');
    expect(STRIP).toContain('words.join(\', \')');
  });

  it('keeps the raised disc, the period fill and the tail as decoration or geometry', () => {
    // The two states are independent: the selected disc is larger and shadowed,
    // and a period day is filled with `bg-primary` whether or not it is selected.
    // No colour token is invented for either.
    expect(STRIP).toContain("selected ? 'size-11 shadow-md' : 'size-9'");
    expect(STRIP).toContain("'bg-primary'");
    expect(STRIP).toContain("'bg-card ring-1 ring-border'");
    // The tail cannot eat the day's tap or be announced twice.
    expect(STRIP).toContain('pointer-events-none flex h-3 flex-col items-center justify-start');
    expect(STRIP).toContain('<CaretDownIcon');
    // The states are named in the DOM, which is how the probe measures them.
    expect(STRIP).toContain('data-day-disc={state}');
    expect(STRIP).toContain('data-week-strip={days[0] ?? selectedDate}');
  });
});

describe('the hero card', () => {
  it('is the largest type on the screen, and the only primary button', () => {
    expect(HERO).toContain('text-5xl');
    // The count's unit and the sentence are both body-sized, so the number stays
    // the centrepiece rather than the lead-in.
    expect(HERO).toContain('data-hero="lead" className="text-sm text-muted-foreground"');
    expect(HERO).toContain('data-hero="value"');
    expect(HERO).toContain('{hero.sentence}');
    // One pill, full width, taller than the form's controls.
    expect(HERO).toContain('className="h-11 w-full rounded-full text-base"');
    // Its words come from the pure module rather than being assembled in JSX.
    expect(HERO).toContain('heroFor(prediction, selectedDate)');
    expect(HERO).toContain('periodActionFor(coveringCycle, selectedDate)');
  });

  it('keeps the corrections the card it replaced used to own', () => {
    expect(HERO).toContain('Remove this period');
    expect(HERO).toContain('aria-label="Add a past period"');
    expect(TODAY).toContain('<AddPastPeriodSheet');
  });

  it('no longer renders the old period card, so one action cannot become two', () => {
    expect(TODAY).not.toContain('function PeriodCard');
    expect(TODAY).not.toContain('My period started today');
    expect(TODAY).toContain('<HeroCard');
  });

  it('repaints after a period write through the store, not by hand', () => {
    /*
     * Found by the probe: the POST landed and the toast appeared, and the strip
     * and the button kept showing the pre-write state until the page was
     * reloaded. The write named `/api/period` as invalid, and the store's
     * `invalidate()` dropped the worker's copy of it — but refetched nothing that
     * was still on screen. This screen worked around that by hand:
     *
     *     invalidate(PERIOD_PREFIX).then(() => overview.refresh())
     *
     * which put the ordering (worker drop first, then the read) in the screen's
     * hands and left every other screen to rediscover it. Most did not, which is
     * what the reported bugs were.
     *
     * The store owns that ordering now: `invalidate()` makes the worker drop its
     * copy and then wakes every loader registered for the prefix, refetching them
     * with `force`. So a write only has to name its prefixes, and the screen has
     * nothing left to sequence — `tests/store-invalidate.test.ts` pins the order.
     */
    for (const write of ['createCycle', 'updateCycle', 'deleteCycle']) {
      expect(TODAY, write).toContain(`const ${write} = use`);
    }
    expect(code('components/period/TodayLogScreen.tsx')).not.toContain('overview.refresh()');
  });

  it('writes the period settings through the same store write as its data', () => {
    // The switch is rendered from the store entry it is about to change, so the
    // optimistic write is what stops it looking inert — and the invalidation is
    // what makes it settle on the server's answer.
    expect(TODAY).toContain('useUpdatePeriodSettings');
  });

  it('keeps the prediction card with its basis under the hero, anchored to today', () => {
    // `today`, not `selectedDate`: the card's sentences are all relative to the
    // prediction's own `asOf`, so a tapped day would make them false.
    expect(TODAY).toContain('<PredictionSummary prediction={data?.prediction} today={today} />');
  });
});

describe('the insights row', () => {
  it('is a section with a heading above it, not a page header', () => {
    expect(ROW).toContain('My daily insights');
    expect(ROW).toContain('aria-labelledby={HEADING_ID}');
    expect(ROW).toContain('<h2 id={HEADING_ID}');
    // The shell publishes the screen's title; a second PageHeader would double it.
    expect(ROW).not.toContain('PageHeader');
    expect(CYCLES).toContain('My cycles');
    expect(CYCLES).not.toContain('PageHeader');
  });

  it('scrolls sideways with a snap, full-bleed so its edge cards are not clipped', () => {
    expect(ROW).toContain('snap-x snap-mandatory');
    expect(ROW).toContain('overflow-x-auto');
    expect(ROW).toContain('scroll-px-gutter');
    // The row carries the gutter itself because the screen's column no longer
    // does; that is what makes the first and last card land on the gutter line.
    expect(ROW).toContain('gap-2 overflow-x-auto px-gutter pb-1');
    expect(ROW).toContain('shrink-0 snap-start');
    expect(TODAY).toContain('<TodayInsightsRow');
  });

  it('leads with the action, and the action reveals the one form', () => {
    expect(ROW).toContain('data-insight-card="log"');
    expect(ROW).toContain('Log your symptoms');
    expect(ROW).toContain('<PlusIcon');
    // It scrolls to the form that already exists rather than opening a second
    // copy of it in a sheet.
    expect(ROW).not.toContain('Drawer');
    expect(ROW).not.toContain('DayLogForm');
    expect(TODAY).toContain('DAY_LOG_ID');
    expect(TODAY).toContain('scrollIntoView({ block: \'start\', behavior: \'smooth\' })');
    expect(TODAY).toContain('id={DAY_LOG_ID}');
  });

  it('never states a fact the API did not return', () => {
    // The cards read the two payloads, and every value is a field on one of them.
    expect(ROW).toContain('insightCardsFor');
    const cards = source('components/period/today-insights.ts');
    expect(cards).toContain('prediction?.fertileWindow');
    expect(cards).toContain('prediction.currentCycleDay');
    expect(cards).toContain('stats.loggedDays');
    // No invented streak, score or probability.
    expect(code('components/period/today-insights.ts')).not.toMatch(/streak|chance|probab|%/i);
  });

  it('lists measured cycle lengths, with the dates each length came from', () => {
    expect(CYCLES).toContain('stats?.cycleLengths');
    expect(CYCLES).toContain('shortDate(cycle.from)');
    expect(CYCLES).toContain('shortDate(cycle.to)');
    // "Regular" is not a word the contract defines, so the card does not use it.
    expect(code('components/period/MyCyclesCard.tsx')).not.toMatch(/regular/i);
    expect(CYCLES).toContain('averageCycleLengthDays');
  });
});

describe('nothing the brief protects was removed', () => {
  it('keeps the form, its one commit path and its escape hatch', () => {
    expect(TODAY).toContain('<DayLogForm');
    expect(TODAY).toContain('onShowAllSections={onShowAllSections}');
    expect(TODAY).toContain('settings: { ...current.settings, ...SHOW_ALL_TODAY_CATEGORIES }');
    expect(TODAY).toContain("'Saved as you tap.'");
    expect(TODAY).toContain('aria-live="polite"');
    expect(TODAY).toContain('aria-label={`Clear everything logged on ${longDate(selectedDate)}`}');
  });

  it('keeps the shell’s pane behaviour on the cycle month alone', () => {
    // The month screen pins its own `useShellPane` in period-nav.test.ts; the
    // Today screen still scrolls in the shell's pane, and must not have gained a
    // second scroller.
    expect(TODAY).not.toContain('useShellPane');
    expect(source('components/period/DayLogSheet.tsx')).toContain('<DayLogForm');
  });
});