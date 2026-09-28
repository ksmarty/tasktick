/**
 * Insights, and the Today screen, after the charts went in.
 *
 * The user's complaint was "too much text", so this file pins the two halves of
 * that trade: the charts are wired to the API's own numbers, and the prose they
 * replaced is *gone* rather than sitting above them. A source pin is the only
 * kind of test available here — the components are client components and this
 * suite runs in node — so each assertion below names the expression that is the
 * decision, not a nearby string.
 *
 * The other reason these pins exist is the caveats. Cutting prose from a screen
 * that talks about fertility is dangerous: the sentence that says a calendar
 * estimate is not a fertility statement under a hormonal method, and the one that
 * says none of this is a contraceptive plan, must survive every rewrite. They are
 * asserted here so a future cut fails the build instead of reaching a user.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(relative: string): string {
  return readFileSync(new URL(`../src/${relative}`, import.meta.url), 'utf8');
}

const INSIGHTS = source('components/period/InsightsScreen.tsx');
const CHARTS = source('components/period/charts.tsx');
const TODAY = source('components/period/TodayLogScreen.tsx');
const FORM = source('components/period/DayLogForm.tsx');
const IMPORT = source('components/period/ImportCard.tsx');

describe('the charts replaced paragraphs', () => {
  it('wires every chart to the API fields, not to a re-derivation', () => {
    for (const chart of ['CycleLengthChart', 'CycleRangeChart', 'CyclePhaseBar', 'ForecastErrorChart']) {
      expect(INSIGHTS, chart).toContain(`<${chart}`);
    }
    expect(INSIGHTS).toContain("from './charts'");
    // Two of them read `PeriodStats` directly; the phase bar reads the
    // prediction's own fertile window, converted to day numbers by `dayNumber`.
    expect(INSIGHTS).toContain('lengths={stats.cycleLengths}');
    expect(INSIGHTS).toContain('average={stats.averageCycleLengthDays}');
    expect(INSIGHTS).toContain('series={stats.temperatureSeries}');
    expect(INSIGHTS).toContain('dayNumber(lastStart, fertile.start)');
  });

  it('deleted the prose and the raw number lists the charts stand for', () => {
    // Both blocks of interval lengths written out in words.
    expect(INSIGHTS).not.toContain('Intervals used for the estimate, in days');
    expect(INSIGHTS).not.toContain('All measured intervals, in days');
    expect(INSIGHTS).not.toContain('NumberListRow');
    // The paragraph that explained the basis in prose, now the chart's caption.
    expect(INSIGHTS).not.toContain('basisSummary');
    // The old explanation of what a ± means, one paragraph per uncertainty
    // source; the short line that replaced it is asserted below.
    expect(INSIGHTS).not.toContain('The start is a range, not a date: the ± is how much your cycles vary');
    // The per-cycle list of `date → date · N days` rows.
    expect(INSIGHTS).not.toContain('value={daysLabel(interval.days)}');
  });

  it('keeps the uncertainty in words, because a chart cannot say which kind it is', () => {
    expect(INSIGHTS).toContain('The ± is measured from the spread of your own cycles.');
    expect(INSIGHTS).toContain('fewer than three cycles have been measured');
    // And the start still never appears bare.
    expect(INSIGHTS).toContain('startWithUncertainty(prediction)');
  });

  it('gives every chart an accessible name that states its finding', () => {
    // Each `<svg role="img">` carries `title. finding`, and the same finding is
    // the visible caption — one string, so the two cannot disagree.
    expect(CHARTS).toContain('role="img"');
    expect(CHARTS).toContain('aria-label={`Cycle length over time. ${finding}`}');
    expect(CHARTS).toContain('aria-label={`How far apart the cycles are. ${finding}`}');
    expect(CHARTS).toContain('aria-label={`Where today sits in the cycle. ${finding}`}');
    expect(CHARTS).toContain('aria-label={`How close past estimates were. ${finding}`}');
    expect(CHARTS).toContain('aria-label={`Basal temperature. ${finding}`}');
    expect(CHARTS).toContain('<figcaption');
  });

  it('renders an empty state for every chart rather than a broken axis', () => {
    // One fallback component, used by all five.
    expect(CHARTS.match(/<EmptyChart/g)?.length).toBe(5);
    // And the probe hook is present with or without data, marked when empty.
    expect(CHARTS).toContain('data-chart={chart}');
    expect(CHARTS).toContain("data-chart-empty={empty ? 'true' : undefined}");
  });

  it('says out loud that the accuracy chart is a backtest', () => {
    // The API stores no past predictions; claiming otherwise would be a lie the
    // chart's shape cannot reveal.
    expect(CHARTS).toContain('function ForecastErrorChart');
    expect(CHARTS).toContain('const errors = backtestForecastErrors(lengths);');
    expect(INSIGHTS).toContain('The backtest replays one rule over your history');
  });
});

describe('the caveats survive every cut', () => {
  it('keeps the hormonal-method correction on the fertility card', () => {
    expect(INSIGHTS).toContain('A hormonal method makes a calendar fertility estimate misleading');
    // Fragment, not the whole sentence: JSX wraps it across two source lines.
    expect(INSIGHTS).toContain('read them as cycle');
    expect(INSIGHTS).toContain('not as when you can or cannot conceive');
    // The relabelled row is what stops the word "fertile" appearing unqualified.
    expect(INSIGHTS).toContain("'Calendar window (not a fertility estimate here)'");
  });

  it('keeps the prediction meaning, and adds the one sentence the screen must never lose', () => {
    // `prediction.meaning` is derived from the contraception setting server-side.
    expect(INSIGHTS).toContain('footer={prediction.meaning}');
    // The screen-level caveat: not medical advice, not a contraceptive plan.
    expect(INSIGHTS).toContain('not medical advice');
    expect(INSIGHTS).toContain('typical-use failure rate of about 24% a year');
  });

  it('still refuses to invent a date when there is not enough history', () => {
    expect(INSIGHTS).toContain('No date is filled in by default');
  });
});

describe('body signs, off by default', () => {
  it('reads the switch as strictly on, so an unanswered read is off', () => {
    expect(INSIGHTS).toContain('const showBodySigns = settings.data?.bodySigns === true;');
    expect(INSIGHTS).toContain('{history ? showBodySigns ? <BodySignsGroup stats={history} /> : <BodySignsHiddenRow stats={history} /> : null}');
  });

  it('does not hide recorded data in a way that looks lost', () => {
    // With the switch off, the body-signs card is replaced by a row that says
    // where the data still is. It never says "nothing recorded".
    expect(INSIGHTS).toContain('function BodySignsHiddenRow');
    expect(INSIGHTS).toContain('Nothing has been removed');
    expect(INSIGHTS).toContain('still on the calendar');
    expect(INSIGHTS).not.toContain('No body signs recorded yet');
  });

  it('hides the inputs in the form, under one switch', () => {
    expect(FORM).toContain("shows('bodySigns')");
    // The four observations the user named are behind it.
    expect(FORM).toContain('label="LH test"');
    expect(FORM).toContain('label="Cervical mucus"');
    expect(FORM).toContain('label="Basal temperature"');
    expect(FORM).toContain('label="Ovulation pain"');
  });
});

describe('one switch per Today section', () => {
  it('gates every section on the settings, in the form itself', () => {
    for (const category of ['flow', 'contraception', 'symptoms', 'mood', 'weight', 'bodySigns', 'intimacy', 'notes']) {
      expect(FORM, category).toContain(`shows('${category}')`);
    }
  });

  it('is never empty, and offers the way back in one tap', () => {
    expect(FORM).toContain('Every section of this log is switched off in period settings.');
    expect(FORM).toContain('Show my sections again');
    expect(FORM).toContain('href="/period/settings/sections"');
    // Both screens that render the form supply the escape hatch, so neither can
    // be a dead end. The write-through lives on the screen that owns the
    // overview the form renders from — see the next test.
    expect(TODAY).toContain('onShowAllSections={onShowAllSections}');
    expect(source('components/period/DayLogSheet.tsx')).toContain('onShowAllSections={onShowAllSections}');
    expect(source('components/period/PeriodCalendarScreen.tsx')).toContain('onShowAllSections={onShowAllSections}');
  });

  it('writes a toggle through the store, because invalidate alone does not repaint', () => {
    // Found by the probe: with `invalidate()` only, the switch kept showing the
    // stored value and two quick taps were both computed from the previous list,
    // so the second silently undid the first.
    const sections = source('components/period/TodaySectionsSettings.tsx');
    expect(sections).toContain('if (before) settings.mutate({ ...before, ...patch });');
    expect(sections).toContain('if (!saved && before) settings.mutate(before);');
    // The all-hidden escape hatch has the same problem and the same fix.
    expect(TODAY).toContain('settings: { ...current.settings, ...SHOW_ALL_TODAY_CATEGORIES }');
    expect(source('components/period/PeriodCalendarScreen.tsx')).toContain(
      'settings: { ...current.settings, ...SHOW_ALL_TODAY_CATEGORIES }',
    );
  });

  it('leaves the save behaviour alone: still not one write per keystroke', () => {
    // The reason is in the component: typing 36.55 is five characters, and a
    // write per character would send four values nobody meant to record.
    expect(FORM).toContain('is one write for one intention');
    expect(FORM).toContain('onBlur={commit}');
    expect(FORM).toContain("if (event.key === 'Enter') {");
  });
});

describe('the empty state leads to the importer', () => {
  it('is decided from both reads, and cannot appear for a user with data', () => {
    expect(INSIGHTS).toContain('history.loggedDays === 0 && value.basis.cycleCount === 0');
    expect(TODAY).toContain('(data?.cycles.length ?? 0) === 0 && stats.data?.loggedDays === 0');
    expect(INSIGHTS).toContain('{nothingRecorded ? <ImportEmptyState /> : null}');
    expect(TODAY).toContain('{nothingRecorded ? <ImportEmptyState /> : null}');
  });

  it('leads somewhere: the template is the first control, not a settings row', () => {
    expect(IMPORT).toContain('data-empty-state="import"');
    expect(IMPORT).toContain('Bring your history in');
    expect(IMPORT).toContain('Download the template');
    // The settings row keeps its own copy of the same control.
    expect(IMPORT).toContain('export function ImportCard()');
    // One upload implementation, two shapes of the control.
    expect(IMPORT.match(/function useCsvImport/g)?.length).toBe(1);
  });
});

describe('the screen is now shorter in words than in cards', () => {
  it('does not reintroduce a paragraph per card', () => {
    // Every card's prose is either a footer (one sentence) or a chart caption.
    // The old screen had multi-sentence explanations inside three cards.
    expect(INSIGHTS).not.toContain('Counts come from the days that carry a log.');
    expect(INSIGHTS).not.toContain('Nothing is filled in with a default date on purpose: one cycle is not a basis');
  });
});
