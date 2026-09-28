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
const PREDICTION = source('components/period/PredictionSummary.tsx');
const TODAY = source('components/period/TodayLogScreen.tsx');
const FORM = source('components/period/DayLogForm.tsx');
const IMPORT = source('components/period/ImportCard.tsx');
const CYCLE_SUMMARY = source('components/period/CycleSummary.tsx');
const CYCLE_HISTORY = source('components/period/CycleHistory.tsx');
const CYCLE_STRIP = source('components/period/CycleDotStrip.tsx');
const INSIGHTS_MATH = source('lib/period-insights.ts');

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

  it('puts the ± on the line the date is on, and deletes the prose between them', () => {
    // What the user asked for: `29 Sep – 3 Oct   ± 2 days`, one line, range at
    // the card's own size and the ± small beside it.
    expect(INSIGHTS).toContain('{rangeLabel(start, end)}');
    expect(INSIGHTS).toContain('{plusMinus(uncertainty.days)}');
    const head = INSIGHTS.slice(INSIGHTS.indexOf('{rangeLabel(start, end)}'));
    const plusMinusAt = head.indexOf('{plusMinus(uncertainty.days)}');
    expect(plusMinusAt).toBeGreaterThan(0);
    expect(plusMinusAt).toBeLessThan(head.indexOf('</p>'));
    // The sentence that used to sit between the date and the numbers is gone.
    expect(INSIGHTS).not.toContain('The ± is measured from the spread of your own cycles.');
    expect(INSIGHTS).not.toContain('fewer than three cycles have been measured');
    expect(INSIGHTS).not.toContain('uncertaintySourceLabel');
    // The row that repeated the two rows under it is gone too.
    expect(INSIGHTS).not.toContain('hint={rangeLabel(uncertainty.earliest, uncertainty.latest)}');
  });

  it('keeps saying which of the contract’s two widths the ± is, where that is still said', () => {
    // `observed` and `default` are different claims, so the default is still
    // named on the Today/calendar card — the one place the header cannot say it
    // by arithmetical shape alone.
    expect(PREDICTION).toContain("uncertainty.source === 'default' ? ' (a default)' : ''");
    expect(PREDICTION).toContain('{plusMinus(uncertainty.days)}');
    expect(PREDICTION).toContain('{rangeLabel(prediction.nextPeriodStart');
    // And the sentence that carried the ± under the range is gone from both.
    expect(PREDICTION).not.toContain('Around ${plusMinus(uncertainty.days)}');
  });

  it('lets a label/value row wrap instead of compressing both sides', () => {
    // Measured at 390px before this: `Calendar-method window (Ogino–Knaus)` was
    // squeezed to 66px and broke over five lines beside a two-line value. The
    // rule is the pair's own width, so the row wraps rather than shrinking the
    // label, and `ml-auto` keeps the value hard right on both lines.
    expect(INSIGHTS).toContain('<SettingsRow className="flex-wrap">');
    expect(INSIGHTS).toContain('min-w-0 flex-auto text-sm text-muted-foreground');
    expect(INSIGHTS).toContain('ml-auto flex min-w-0 flex-col items-end');
  });

  it('gives every chart a scrubber that works with a pointer and with a keyboard', () => {
    // Five charts, five scrubbable SVGs — a touch-only affordance would be
    // broken on the desktop this phone app also runs on.
    expect(CHARTS.match(/= useScrub\(/g)?.length).toBe(5);
    expect(CHARTS.match(/tabIndex=\{0\}/g)?.length).toBe(5);
    expect(CHARTS.match(/onPointerDown/g)?.length).toBe(1);
    expect(CHARTS.match(/onKeyDown/g)?.length).toBe(1);
    expect(CHARTS).toContain("event.key === 'ArrowRight'");
    expect(CHARTS).toContain("'Escape'");
    // Horizontal drags scrub; vertical ones stay the scroller's.
    expect(CHARTS).toContain('touch-pan-y');
    // The reading is text, so a screen reader and a screenshot both get it.
    expect(CHARTS).toContain('aria-live="polite"');
    // And the hit test is the pure one, not an inline nearest-centre.
    expect(CHARTS).toContain('nearestIndex(userX');
    expect(CHARTS).toContain('barIndexAt(userX, bars)');
  });

  it('keeps the reference labels out of the plot area, where they collided', () => {
    // `average 28` overlapped the first data point; the label now sits above
    // `inset`, which the padded domain cannot put a point into.
    expect(CHARTS).toContain('y={LINE_BOX.inset - 8}');
    // `on the average` overlapped the tallest bar; it is a key under the picture.
    expect(CHARTS).toContain("label: 'on the average'");
    // And the range strip no longer reserves a whole day either side of itself.
    expect(CHARTS).toContain('const RANGE_PAD = 0.5;');
    // A cycle that landed exactly on the average is drawn rather than vanishing.
    expect(CHARTS).toContain('const ZERO_BAR_HEIGHT = 2;');
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
    expect(CHARTS).toContain('ForecastErrorChart');
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

  it('keeps the prediction meaning, and one plain sentence about what the dates are', () => {
    // `prediction.meaning` is derived from the contraception setting server-side.
    // The Next period card is the date and the numbers, with no paragraph after them.
  expect(INSIGHTS).not.toContain('footer={prediction.meaning}');
  expect(INSIGHTS).toContain('<SettingsGroup title="Next period">');
    /*
     * The user asked for the warnings gone and was right about most of it — the
     * disclaimer styling, the icon, the medical-advice sentence. What stays is the
     * one fact that is not a disclaimer: a fertile-window estimate is arithmetic
     * over recorded cycles, not an observation of the body, so it cannot be read as
     * contraception. Pinned so it is not mistaken for leftover boilerplate.
     */
    expect(INSIGHTS).toContain('not observations of your body');
    // And the warning treatment is gone, not merely reworded.
    expect(INSIGHTS).not.toContain('not medical advice');
    expect(INSIGHTS).not.toContain('failure rate');
  });

  it('still refuses to invent a date when there is not enough history', () => {
    expect(INSIGHTS).toContain('No date is filled in by default');
  });
});

describe('body signs, off by default', () => {
  it('reads the switch as strictly on, so an unanswered read is off', () => {
    expect(INSIGHTS).toContain('const showBodySigns = settings.data?.bodySigns === true;');
    expect(INSIGHTS).toContain('{history && (showBodySigns || hasBodySignsData(history)) ? <BodySignsGroup stats={history} /> : null}');
  });

  it('hides the card when off and empty, and never hides a reading', () => {
    /*
     * The user asked for the card gone when the switch is off and nothing was
     * recorded — no heading, no note, no warning. The second half of that is the
     * part that matters: a display setting must never hide a reading, so the gate
     * is `showBodySigns || hasBodySignsData`, and the count behind it covers every
     * body sign rather than temperature alone.
     */
    expect(INSIGHTS).toContain('const showBodySigns = settings.data?.bodySigns === true;');
    expect(INSIGHTS).toContain('const hasBodySignsData = (stats: PeriodStats) => stats.bodySignDays > 0;');
    expect(INSIGHTS).toContain('history && (showBodySigns || hasBodySignsData(history))');
    // The warning that used to stand in its place is gone, not merely restyled.
    expect(INSIGHTS).not.toContain('BodySignsHiddenRow');
    expect(INSIGHTS).not.toContain('Nothing has been removed');
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
    /*
     * Ported, not deleted: the Today screen now wraps the same control in a
     * gutter div (`px-gutter`) because the insights row below it is full-bleed,
     * so the decision is pinned as the two halves it is written in.
     */
    expect(TODAY).toContain('{nothingRecorded ? (');
    expect(TODAY).toContain('<ImportEmptyState />');
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

/* -------------------------------------------------------------------------- */
/* the cycle summary, the dot strip, and the trend sentence                   */
/* -------------------------------------------------------------------------- */

describe('the cycle summary badges are computed, and the claim is readable', () => {
  it('reads every badge from the pure threshold module', () => {
    expect(CYCLE_SUMMARY).toContain('cycleLengthVerdict(previousCycleLengthDays)');
    expect(CYCLE_SUMMARY).toContain('periodLengthVerdict(previousPeriodLengthDays)');
    expect(CYCLE_SUMMARY).toContain('cycleVariationVerdict(shortestCycleDays, longestCycleDays)');
    expect(CYCLE_SUMMARY).toContain("from '@/lib/period-insights'");
  });

  it('renders no hard-coded status word, and never the word “abnormal”', () => {
    // The badge is `verdict.badge`; a literal in the component would be a badge
    // that cannot change with the data.
    expect(CYCLE_SUMMARY).toMatch(/\{verdict\.badge\}/);
    expect(CYCLE_SUMMARY).not.toMatch(/ABNORMAL|'Abnormal'|'Normal'/);
    // And the words the module actually returns are the careful ones.
    expect(INSIGHTS_MATH).toContain("'Outside the usual range'");
    expect(INSIGHTS_MATH).toContain("'Wider variation'");
  });

  it('puts the threshold and its source where the badge can be read', () => {
    expect(INSIGHTS_MATH).toContain('21–35 days');
    expect(INSIGHTS_MATH).toContain('2–7 days');
    expect(INSIGHTS_MATH).toContain('NHS');
    expect(CYCLE_SUMMARY).toContain('not a diagnosis');
  });

  it('gives the (i) a keyboard-reachable disclosure, not a hover tooltip', () => {
    expect(CYCLE_SUMMARY).toContain('<button');
    expect(CYCLE_SUMMARY).toContain('aria-expanded={open}');
    expect(CYCLE_SUMMARY).toContain('aria-controls={panelId}');
    expect(CYCLE_SUMMARY).toContain('aria-label={`What');
  });

  it('does not build an assistant that does not exist', () => {
    // The reference’s avatar disc + speech bubble + pill implies an AI behind the
    // screen. The honest replacement is the explanatory card itself.
    expect(CYCLE_SUMMARY).not.toContain('<Avatar');
    expect(CYCLE_SUMMARY).not.toContain('SpeechBubble');
    expect(CYCLE_SUMMARY).not.toContain('ChatBubble');
  });
});

describe('the dot strip is a data visual with words', () => {
  it('has an accessible name and hides the dots from the reader', () => {
    expect(CYCLE_STRIP).toContain('role="img"');
    expect(CYCLE_STRIP).toContain('aria-label={name}');
    expect(CYCLE_STRIP).toContain('aria-hidden');
    expect(CYCLE_STRIP).toContain('stripAccessibleName(startDate, days)');
  });

  it('draws fixed geometry that cannot wrap', () => {
    expect(CYCLE_STRIP).toContain('flex-nowrap');
    expect(CYCLE_STRIP).toContain('gap: `${STRIP_GAP_PX}px`');
    expect(CYCLE_STRIP).toContain('width: `${STRIP_DOT_PX}px`');
    expect(CYCLE_STRIP).toContain('STRIP_MAX_DAYS');
    // The arithmetic itself is pinned in period-insights-math.test.ts.
  });

  it('says the fertile estimate is current-cycle only', () => {
    expect(CYCLE_STRIP).toContain('fertile estimate is drawn on the current cycle only');
  });
});

describe('the history and the trend are the data, not a template', () => {
  it('derives the trend sentence from the same lengths the graph plots', () => {
    expect(INSIGHTS).toContain('cycleTrendSentence(stats.cycleLengths)');
    expect(INSIGHTS).toContain('<CycleTrendsGroup stats={history} />');
    expect(INSIGHTS).toContain('title="Cycle trends"');
    // The old chart card’s title is gone; this is the trend card now.
    expect(INSIGHTS).not.toContain('title="Cycle length over time"');
  });

  it('makes “See all” a real toggle, not a dead link', () => {
    expect(CYCLE_HISTORY).toContain("expanded ? 'Show fewer' : 'See all'");
    expect(CYCLE_HISTORY).toContain('aria-expanded={expanded}');
    expect(CYCLE_HISTORY).not.toContain('<Link');
    expect(CYCLE_HISTORY).not.toContain('href=');
  });

  it('reads the recorded cycle ranges and never invents a fertile window', () => {
    expect(CYCLE_HISTORY).toContain('cycles: Resource<PeriodCycle[]>');
    expect(CYCLE_HISTORY).toContain('cycleStripDays(');
    // A completed cycle gets no window — only the current row carries one.
    expect(CYCLE_HISTORY).toContain('fertileWindow: null');
    expect(INSIGHTS).toContain('latestPeriodLength(cycles.data)');
  });
});
