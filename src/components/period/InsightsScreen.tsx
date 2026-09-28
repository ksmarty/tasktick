'use client';

/**
 * Insights: the prediction explained, and the history it came from.
 *
 * ## A range, never a confident date
 *
 * The whole reason this screen exists as its own destination rather than a line
 * under a calendar is that a cycle prediction is a *band*, not a day. Every date
 * the API returns here carries a `± days` half-width (`uncertainty.days`) and a
 * `source` saying whether that width was measured from this user's own spread or
 * is a default because there is not enough history to measure one. So the next
 * period is rendered as the predicted bleeding **range** (`rangeLabel`) together
 * with the uncertainty, and the most likely start appears only as
 * `weekdayDateLabel(start) ± days` — never as a bare date the user could read as
 * a promise. Nothing on this screen is a predicted date, an ovulation day, a
 * window, an average, a median, a standard deviation or a cycle length computed
 * here: each one is read from `PeriodPrediction` / `PeriodStats`. See
 * `period-math.ts` for the arithmetic.
 *
 * ## Why it is charts instead of paragraphs
 *
 * The user's complaint was that this screen was too much text, and the honest
 * answer was that several of its paragraphs were describing a *shape* — the
 * spread of the cycles, the direction they have drifted, where today sits in the
 * cycle, how far the past estimates landed. A shape is what a chart is for. So
 * the four charts in `./charts` replace the prose and the raw number lists, and
 * what is left is: the range, the numbers a chart cannot state, and the two
 * caveats that have to stay.
 *
 * Each chart carries its finding as text — "your last 8 measured cycles averaged
 * 26 days, ranging 24–29" — as both its accessible name and its visible caption,
 * so a chart is never the only place a fact lives. The arithmetic behind them is
 * pure and tested in `tests/period-charts.test.ts`.
 *
 * ## Why the fertility part is labelled rather than hidden
 *
 * A hormonal method suppresses ovulation, so a calendar estimate of a fertile
 * window stops being a statement about fertility at all. Hiding the window would
 * hide data the user logged against; rendering it unlabelled would be worse. So
 * when `contraception.affectsPrediction` is true the window is still shown and
 * the card says plainly what it is not, and the row itself is relabelled rather
 * than left with the word "fertile" on it. `prediction.meaning` is the footer of
 * the headline card for the same reason, and it is never cut for length.
 *
 * ## Body signs, off by default
 *
 * The fertility-awareness observations — basal temperature, cervical mucus, LH
 * tests, ovulation pain — are hidden until the user asks for them, in the log form
 * and here. What is *not* hidden when they are off is the answer to "did I lose
 * that data": it is still on the calendar day it was recorded on, and this screen
 * says so in one line rather than silently dropping the card.
 *
 * ## No props, one column
 *
 * The screen is a plain `flex flex-col gap-stack` column inset by `px-gutter`,
 * like the settings sections (`/settings/appearance`), so the shell keeps owning
 * the scroll and this screen never declares `useShellPane`. Rows are
 * `SettingsGroup` / `SettingsRow` because the row rhythm of a settings-shaped
 * screen is what that pair defines — the reason it exists is that this exact
 * "one column of cards of label/value rows" shape kept drifting by hand.
 *
 * ## The API may be absent
 *
 * This screen is written against the types and the `{ ok, data }` envelope, not
 * against a running server: a failed read (a 404 while the route is still being
 * built) shows the API's own message and a retry rather than an endless
 * skeleton, and every read tolerates `undefined` so nothing throws.
 */
import { useMemo, type ReactNode } from 'react';
import { BarChartIcon } from '@svg-animated-icons/react/bar-chart';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { ExclamationTriangleIcon } from '@svg-animated-icons/react/exclamation-triangle';
import { InfoCircledIcon } from '@svg-animated-icons/react/info-circled';
import { LockClosedIcon } from '@svg-animated-icons/react/lock-closed';
import { PageHeader } from '@/components/app/PageHeader';
import { usePeriodPrediction, usePeriodSettings, usePeriodStats } from '@/components/period/data';
import {
  FLOW_LABEL,
  FLOW_OPTIONS,
  METHOD_LABEL,
  humanise,
  inDaysLabel,
  longDate,
  plusMinus,
  rangeLabel,
  weekdayDateLabel,
} from '@/components/period/labels';
import { SettingsGroup, SettingsRow } from '@/components/settings/SettingsGroup';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import type { PeriodFlow, PeriodPrediction, PeriodPredictionBasis, PeriodStats } from '@/lib/period-types';
import { cn } from '@/lib/utils';
import { cycleLengthValues, cyclePhases, dayNumber } from './chart-math';
import { CycleLengthChart, CyclePhaseBar, CycleRangeChart, ForecastErrorChart, TemperatureChart } from './charts';
import { ImportEmptyState } from './ImportCard';

/* -------------------------------------------------------------------------- */
/* formatting helpers — every one of them formats a value the API computed     */
/* -------------------------------------------------------------------------- */

/** A day count the API may not have, with an honest dash when it does not. */
function daysLabel(value: number | null): string {
  if (value === null) return '—';
  return `${value} ${value === 1 ? 'day' : 'days'}`;
}

/** "Thu 30 Oct ± 3 days" — the contract's own form, so a start is never bare. */
function startWithUncertainty(prediction: PeriodPrediction): string {
  const start = prediction.nextPeriodStart;
  if (!start) return '—';
  const base = weekdayDateLabel(start);
  if (!prediction.uncertainty) return base;
  return `${base} ${plusMinus(prediction.uncertainty.days)}`;
}

/**
 * Where the `±` came from, in the contract's own two terms.
 *
 * One short line, because the *size* of the band is the chart's job now: the
 * cycle-length chart draws the spread the ± is derived from. What still has to be
 * said in words is which of the two kinds of width this is — a measured spread is
 * a different claim from a default.
 */
function uncertaintySourceLabel(prediction: PeriodPrediction): string {
  const uncertainty = prediction.uncertainty;
  if (!uncertainty) return 'The prediction did not include an uncertainty range.';
  return uncertainty.source === 'observed'
    ? 'The ± is measured from the spread of your own cycles.'
    : 'The ± is a default width: fewer than three cycles have been measured to derive a spread from.';
}

/* -------------------------------------------------------------------------- */
/* small presentational pieces                                                */
/* -------------------------------------------------------------------------- */

/** A label/value row: the shape every number on this screen takes. */
function ValueRow({ label, value, hint }: { label: ReactNode; value: ReactNode; hint?: ReactNode }) {
  return (
    <SettingsRow>
      <span className="min-w-0 flex-1 text-sm text-muted-foreground">{label}</span>
      <span className="flex shrink-0 flex-col items-end text-sm font-medium tabular-nums">
        <span>{value}</span>
        {/* A second line under the value, for what the number means. */}
        {hint ? <span className="text-xs font-normal text-muted-foreground">{hint}</span> : null}
      </span>
    </SettingsRow>
  );
}

/** A row of prose inside a card — the shape the explanations take. */
function NoteRow({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <SettingsRow stacked>
      <div className="flex items-start gap-3">
        {icon ? (
          <span aria-hidden className="inline-flex shrink-0 text-muted-foreground">
            {icon}
          </span>
        ) : null}
        <div className="min-w-0 flex-1 text-sm">{children}</div>
      </div>
    </SettingsRow>
  );
}

/** A failed read. The API's own message, and the one control that retries it. */
function ErrorRow({ title, message, onRetry }: { title: string; message: string; onRetry: () => void }) {
  return (
    <SettingsRow stacked>
      <div className="flex items-start gap-3">
        <span aria-hidden className="inline-flex shrink-0 text-muted-foreground">
          <ExclamationTriangleIcon className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onRetry}>
        Try again
      </Button>
    </SettingsRow>
  );
}

/** A chart, in the row rhythm of the screen. */
function ChartRow({ children }: { children: ReactNode }) {
  return (
    <SettingsRow stacked>
      <div className="flex flex-col gap-2">{children}</div>
    </SettingsRow>
  );
}

/* -------------------------------------------------------------------------- */
/* the next period                                                            */
/* -------------------------------------------------------------------------- */

/**
 * The headline card: the range, its uncertainty, and what it was based on.
 *
 * `prediction.meaning` is the card's footnote because it is derived from the
 * contraception setting server-side — it is the sentence that says whether these
 * dates are a fertility statement at all, and it belongs with the dates rather
 * than in a legal footer at the bottom of the screen.
 */
function NextPeriodGroup({ prediction }: { prediction: PeriodPrediction }) {
  const start = prediction.nextPeriodStart!;
  const end = prediction.nextPeriodEnd!;
  const uncertainty = prediction.uncertainty;

  return (
    <SettingsGroup title="Next period" footer={prediction.meaning}>
      <SettingsRow stacked>
        {/* The predicted bleeding itself, as a range. */}
        <p className="text-2xl font-semibold tabular-nums">{rangeLabel(start, end)}</p>
        {/* The most likely start never appears on its own: it carries the
            contract's own `date ± days` form. */}
        <p className="text-sm font-medium tabular-nums">
          {startWithUncertainty(prediction)} · {inDaysLabel(start, prediction.asOf)}
        </p>
        <p className="text-xs text-muted-foreground">{uncertaintySourceLabel(prediction)}</p>
      </SettingsRow>

      {uncertainty ? (
        <ValueRow
          label="Earliest start"
          value={weekdayDateLabel(uncertainty.earliest)}
          hint={rangeLabel(uncertainty.earliest, uncertainty.latest)}
        />
      ) : null}
      {uncertainty ? <ValueRow label="Latest start" value={weekdayDateLabel(uncertainty.latest)} /> : null}

      <ValueRow label="Cycle length used" value={daysLabel(prediction.predictedCycleLengthDays)} />

      {prediction.overdueDays !== null ? (
        <NoteRow icon={<ExclamationTriangleIcon className="size-5" />}>
          <p className="font-medium">Running late</p>
          <p className="text-muted-foreground">
            This cycle’s estimate was {longDate(prediction.predictedFromLastCycle ?? start)},{' '}
            {daysLabel(prediction.overdueDays)} ago. The range above is the next upcoming one rather than that
            overdue date.
          </p>
        </NoteRow>
      ) : null}
    </SettingsGroup>
  );
}

function NotEnoughDataGroup({ prediction }: { prediction: PeriodPrediction }) {
  return (
    <SettingsGroup title="Next period" footer={prediction.meaning}>
      <SettingsRow stacked>
        <div className="flex items-start gap-3">
          <span aria-hidden className="inline-flex shrink-0 text-muted-foreground">
            <CalendarIcon className="size-6" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">Not enough recorded history yet</p>
            <p className="text-sm text-muted-foreground">
              {prediction.reason ?? 'The prediction did not include a date.'}
            </p>
            {/* The one sentence that has to survive: the absence of a date is a
                decision, not a gap in the code. */}
            <p className="text-xs text-muted-foreground">
              No date is filled in by default: one cycle is not a basis for one.
            </p>
          </div>
        </div>
      </SettingsRow>
      <ValueRow
        label="Period starts on record"
        value={`${prediction.basis.cycleCount}`}
        hint={prediction.basis.lastPeriodStart ? `most recent ${longDate(prediction.basis.lastPeriodStart)}` : undefined}
      />
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* where today sits                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The phase bar: the paragraph about "day 12 of 28, fertile window" as a picture.
 *
 * The day offsets are computed here, from the prediction's own dates, because a
 * bar is drawn in days and the API speaks in dates: `dayNumber` is the same
 * conversion `labels.daysBetween` uses to say "in 4 days". Nothing is derived that
 * the API did not send — the fertile window is the prediction's, not a
 * recomputation of it.
 */
function TodayPhaseGroup({ prediction }: { prediction: PeriodPrediction }) {
  const lastStart = prediction.lastPeriodStart;
  const fertile = prediction.fertileWindow;

  const segments = useMemo(
    () =>
      cyclePhases({
        cycleDay: prediction.currentCycleDay,
        cycleLength: prediction.predictedCycleLengthDays,
        periodLength: prediction.basis.averagePeriodLengthDays,
        fertileStartDay: lastStart && fertile ? dayNumber(lastStart, fertile.start) : null,
        fertileEndDay: lastStart && fertile ? dayNumber(lastStart, fertile.end) : null,
      }),
    [prediction, lastStart, fertile],
  );

  return (
    <SettingsGroup
      title="Where today sits"
      footer="Calendar arithmetic from your recorded cycles, not an observation of your body."
    >
      <ChartRow>
        <CyclePhaseBar
          segments={segments}
          cycleDay={prediction.currentCycleDay}
          totalDays={prediction.predictedCycleLengthDays}
        />
      </ChartRow>
      <ValueRow
        label="Cycle started"
        value={lastStart ? weekdayDateLabel(lastStart) : '—'}
        hint={prediction.currentCycleDay === null ? undefined : `day ${prediction.currentCycleDay} today`}
      />
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* the history, as charts                                                     */
/* -------------------------------------------------------------------------- */

/**
 * The chart that answers "why ± 3 days".
 *
 * One point per measured cycle, the average as the reference line and one standard
 * deviation shaded either side of it — which *is* the spread the uncertainty is
 * derived from. The caption states the finding in words, so the card does not
 * become unreadable for anyone who cannot see it.
 */
function CycleHistoryGroup({ stats }: { stats: PeriodStats }) {
  return (
    <SettingsGroup
      title="Cycle length over time"
      footer="The dashed line is the average the prediction is built on."
    >
      <ChartRow>
        <CycleLengthChart
          lengths={stats.cycleLengths}
          average={stats.averageCycleLengthDays}
          deviation={stats.standardDeviationDays}
        />
      </ChartRow>
      <ValueRow
        label="Standard deviation"
        value={daysLabel(stats.standardDeviationDays)}
        hint="the spread your ± comes from"
      />
    </SettingsGroup>
  );
}

/**
 * The spread, and how close the past estimates landed.
 *
 * Two charts and no prose: the numbers they replaced were two lists of raw
 * intervals ("28, 29, 30, 29, 28 days"), which is a shape written out in words.
 * The backtest is labelled as one on the chart itself — see `charts.tsx`.
 */
function CycleSpreadGroup({ stats }: { stats: PeriodStats }) {
  return (
    <SettingsGroup
      title="The spread behind the ±"
      footer="The backtest replays one rule over your history: what the average of the cycles before each one would have predicted."
    >
      <ChartRow>
        <CycleRangeChart
          lengths={stats.cycleLengths}
          average={stats.averageCycleLengthDays}
          shortest={stats.shortestCycleDays}
          longest={stats.longestCycleDays}
        />
        <ForecastErrorChart lengths={cycleLengthValues(stats.cycleLengths)} />
      </ChartRow>
    </SettingsGroup>
  );
}

/** The body-signs series, and the honest note when the switch is off. */
function BodySignsGroup({ stats }: { stats: PeriodStats }) {
  return (
    <SettingsGroup
      title="Body signs"
      footer="Your own readings — no coverline, no shift detection, no reading of what they mean."
    >
      <ChartRow>
        <TemperatureChart series={stats.temperatureSeries} />
      </ChartRow>
      <NoteRow>
        <p className="text-muted-foreground">
          Basal temperature, cervical mucus, an LH test and ovulation pain are recorded in the daily log. Turn Body
          signs on in period settings to see them there.
        </p>
      </NoteRow>
    </SettingsGroup>
  );
}

/**
 * One line, when body signs are switched off.
 *
 * The failure this prevents is a user with a year of temperature readings
 * concluding that switching a section off deleted them. It does not say how many
 * of *each* kind are recorded — the stats summary counts temperatures and not
 * mucus or LH tests — so it states what it can count, points at where the rest
 * still lives, and never claims "nothing recorded".
 */
function BodySignsHiddenRow({ stats }: { stats: PeriodStats }) {
  const readings = stats.temperatureSeries.length;
  return (
    <SettingsGroup title="Body signs">
      <NoteRow icon={<LockClosedIcon className="size-5" />}>
        <p className="font-medium">
          {readings > 0
            ? `${readings} temperature ${readings === 1 ? 'reading' : 'readings'} recorded`
            : 'Body signs are switched off'}
        </p>
        <p className="text-muted-foreground">
          Nothing has been removed: every temperature, mucus, LH-test and ovulation-pain day is still on the calendar
          day it was recorded on. Turn Body signs on in period settings to bring them back to this screen and to the
          daily log.
        </p>
      </NoteRow>
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* fertility                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Ovulation and the windows around it.
 *
 * Everything here is drawn straight from the prediction. The one branching
 * decision is labelling: on a hormonal method the same two windows are shown
 * with the word "fertile" taken off them and the card's first row saying why.
 */
function FertilityGroup({ prediction }: { prediction: PeriodPrediction }) {
  const { contraception } = prediction;
  const fertile = prediction.fertileWindow;
  const calendar = prediction.calendarMethodWindow;

  if (!fertile && !calendar && !prediction.ovulationDate) return null;

  return (
    <SettingsGroup title="Fertility estimate">
      {contraception.affectsPrediction ? (
        <NoteRow icon={<ExclamationTriangleIcon className="size-5" />}>
          <p className="font-medium">A hormonal method makes a calendar fertility estimate misleading</p>
          <p className="text-muted-foreground">
            {contraception.activeMethod ? METHOD_LABEL[contraception.activeMethod] : 'The recorded method'} is
            hormonal and suppresses ovulation, so a window derived from your cycle length is arithmetic rather than a
            statement about fertility. The dates are shown below because you logged against them — read them as cycle
            arithmetic, not as when you can or cannot conceive.
          </p>
        </NoteRow>
      ) : null}

      <ValueRow
        label="Ovulation (estimated)"
        value={prediction.ovulationDate ? weekdayDateLabel(prediction.ovulationDate) : '—'}
        hint={`next predicted period − ${daysLabel(prediction.basis.lutealPhaseDays)} luteal phase`}
      />

      {prediction.ovulationClamped ? (
        <NoteRow>
          <p className="text-muted-foreground">
            Clamped into the current cycle: the luteal phase in use would otherwise have placed it outside it.
          </p>
        </NoteRow>
      ) : null}

      <ValueRow
        label={
          contraception.affectsPrediction
            ? 'Calendar window (not a fertility estimate here)'
            : 'Fertile window (calendar estimate)'
        }
        value={fertile ? rangeLabel(fertile.start, fertile.end) : '—'}
        hint="5 days before ovulation, plus ovulation day"
      />

      {calendar ? (
        <ValueRow
          label="Calendar-method window (Ogino–Knaus)"
          value={rangeLabel(calendar.start, calendar.end)}
          hint="from your shortest and longest recorded cycles"
        />
      ) : null}

      <ValueRow
        label="Contraception recorded"
        value={contraception.activeMethod ? METHOD_LABEL[contraception.activeMethod] : 'None recorded'}
        hint={contraception.hormonal ? 'hormonal — ovulation suppressed' : undefined}
      />
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* the basis of the prediction                                                */
/* -------------------------------------------------------------------------- */

/**
 * Why the number is that number.
 *
 * Every field of `PeriodPredictionBasis` is still shown, including the ones that
 * make the estimate look less certain (the wide spread, the intervals that were
 * left out) — a prediction a person cannot audit is one they cannot trust. What
 * changed is the form: the two lists of raw interval lengths are gone, because
 * the cycle-length chart *is* those lists, drawn. The numbers a chart cannot
 * state (the weighting, the luteal assumption, the dates on record) stay.
 */
function BasisGroup({ prediction }: { prediction: PeriodPrediction }) {
  const basis = prediction.basis;
  const observedSpread = prediction.uncertainty?.source === 'observed';

  return (
    <SettingsGroup
      title="How this was worked out"
      footer="The point estimate is a recency-weighted mean of the interval lengths, weighted towards recent cycles because they describe the cycle you have now."
    >
      <ValueRow label="Method" value={humanise(prediction.method)} />
      <ValueRow
        label="Confidence"
        value={<Badge variant="outline">{humanise(basis.confidence)}</Badge>}
        hint={`from ${basis.usedIntervalLengths.length} measured ${
          basis.usedIntervalLengths.length === 1 ? 'interval' : 'intervals'
        }`}
      />
      <ValueRow label="Recorded cycles" value={`${basis.cycleCount}`} hint="period starts on record" />
      <ValueRow label="Measured intervals" value={`${basis.intervalCount}`} hint="one fewer than the cycles" />
      <ValueRow label="Average cycle length" value={daysLabel(basis.averageCycleLengthDays)} />
      <ValueRow label="Median cycle length" value={daysLabel(basis.medianCycleLengthDays)} />
      <ValueRow
        label="Recency-weighted mean"
        value={daysLabel(basis.recencyWeightedMeanDays)}
        hint="the point estimate"
      />
      <ValueRow label="Shortest cycle" value={daysLabel(basis.shortestCycleDays)} />
      <ValueRow label="Longest cycle" value={daysLabel(basis.longestCycleDays)} />
      <ValueRow
        label="Standard deviation"
        value={daysLabel(basis.standardDeviationDays)}
        hint={observedSpread ? 'the spread your ± comes from' : 'too few cycles to measure a spread'}
      />
      <ValueRow label="Luteal phase assumed" value={daysLabel(basis.lutealPhaseDays)} hint="ovulation → next period" />
      <ValueRow
        label="Cycles feeding the prediction"
        value={basis.predictionCycleCount === null ? 'All recorded cycles' : `${basis.predictionCycleCount} most recent`}
        hint={basis.cycleStarts.length === 0 ? undefined : `starts from ${longDate(basis.cycleStarts[0]!)}`}
      />
      <ValueRow label="Average bleeding length" value={daysLabel(basis.averagePeriodLengthDays)} />
      <ValueRow
        label="First period logged"
        value={basis.firstPeriodStart ? longDate(basis.firstPeriodStart) : '—'}
      />
      <ValueRow label="Last period logged" value={basis.lastPeriodStart ? longDate(basis.lastPeriodStart) : '—'} />
    </SettingsGroup>
  );
}

/** The prediction's own caveats, verbatim. Never a substitute for `reason`. */
function NotesGroup({ notes }: { notes: string[] }) {
  return (
    <SettingsGroup title="Notes">
      {notes.map((note) => (
        <NoteRow key={note}>{note}</NoteRow>
      ))}
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* what was logged                                                            */
/* -------------------------------------------------------------------------- */

/** How much has actually been logged — the denominator for everything above. */
function LoggedDaysGroup({ stats }: { stats: PeriodStats }) {
  return (
    <SettingsGroup
      title="Logged days"
      footer="A day with nothing recorded is a day nobody wrote down — not a day with no bleeding."
    >
      <ValueRow label="Days with a log" value={`${stats.loggedDays}`} />
      <SettingsRow stacked>
        <span className="text-sm text-muted-foreground">Days by flow</span>
        <div className="flex flex-wrap gap-2">
          {FLOW_OPTIONS.map((flow: PeriodFlow) => (
            <Badge key={flow} variant="outline" className={cn(flow === 'none' && 'text-muted-foreground')}>
              {FLOW_LABEL[flow]} · {stats.flowCounts?.[flow] ?? 0}
            </Badge>
          ))}
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}

/* -------------------------------------------------------------------------- */
/* the screen                                                                 */
/* -------------------------------------------------------------------------- */

export function InsightsScreen() {
  // Three reads, not one: the prediction is a point-in-time answer, the stats are
  // the history behind it, and the settings are what decides whether the
  // body-sign card exists at all. Each can be shown while the others are still
  // arriving, and a failure in one does not blank the rest.
  const prediction = usePeriodPrediction();
  const stats = usePeriodStats();
  const settings = usePeriodSettings();

  const value = prediction.data;
  const history = stats.data;
  /*
   * The body-signs switch, read with `=== true`: `undefined` is a settings read
   * that has not landed yet, and the whole point of the default is that body
   * signs are not shown until the server has said they are on. A cached "off"
   * flashes nothing, which is the correct kind of wrong here.
   */
  const showBodySigns = settings.data?.bodySigns === true;

  /**
   * Nothing recorded at all: the importer leads, exactly as it does on Today.
   *
   * It needs both reads to have answered — a day log or a period start is enough
   * to stop showing it — so it cannot appear for a user who has data and then
   * vanish. `undefined` (still loading, or a failed read) shows nothing.
   */
  const nothingRecorded =
    history !== undefined && value !== undefined && history.loggedDays === 0 && value.basis.cycleCount === 0;

  /**
   * The prediction, in one of four states: read, still reading, not enough
   * history recorded, or failed. Each state is a card of its own rather than a
   * global spinner, so a failed prediction does not blank the history below it.
   */
  const predictionCard = value ? (
    value.dataSufficient && value.nextPeriodStart && value.nextPeriodEnd ? (
      <NextPeriodGroup prediction={value} />
    ) : (
      <NotEnoughDataGroup prediction={value} />
    )
  ) : prediction.isInitialLoading ? (
    <Skeleton className="h-40 rounded-xl" />
  ) : (
    <SettingsGroup title="Next period">
      <ErrorRow
        title="Could not read the prediction"
        message={prediction.error ?? 'The prediction is not available right now.'}
        onRetry={() => void prediction.refresh()}
      />
    </SettingsGroup>
  );

  /** The history the prediction is drawn from, with its own loading and error. */
  const historyCards = history ? (
    <>
      <CycleHistoryGroup stats={history} />
      <CycleSpreadGroup stats={history} />
    </>
  ) : stats.isInitialLoading ? (
    <Skeleton className="h-40 rounded-xl" />
  ) : (
    <SettingsGroup title="Cycle length history">
      <ErrorRow
        title="Could not read the cycle history"
        message={stats.error ?? 'The cycle history is not available right now.'}
        onRetry={() => void stats.refresh()}
      />
    </SettingsGroup>
  );

  return (
    <>
      <PageHeader title="Insights" />

      {/* One column of cards, inset by the gutter token, exactly like a settings
          section. The shell keeps the scroll (no `useShellPane` here).

          `aria-live` on the column announces the swap from skeleton to data
          once, and `aria-busy` holds that announcement until the reads settle
          rather than firing on the skeleton. */}
      <div
        className="flex flex-col gap-stack px-gutter pt-4 pb-6"
        aria-live="polite"
        aria-busy={prediction.isInitialLoading || stats.isInitialLoading}
      >
        {nothingRecorded ? <ImportEmptyState /> : null}

        {predictionCard}

        {value ? <TodayPhaseGroup prediction={value} /> : null}
        {value && value.dataSufficient ? <FertilityGroup prediction={value} /> : null}

        {historyCards}

        {history ? showBodySigns ? <BodySignsGroup stats={history} /> : <BodySignsHiddenRow stats={history} /> : null}

        {value ? <BasisGroup prediction={value} /> : null}
        {value && value.notes.length > 0 ? <NotesGroup notes={value.notes} /> : null}

        {history ? <LoggedDaysGroup stats={history} /> : null}

        {/* The caveat that must survive every cut: no reading of this screen is a
            contraceptive guarantee or medical advice. It is a footer rather than
            a paragraph in the middle, and it is not conditional. */}
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <InfoCircledIcon className="mt-0.5 size-4 shrink-0 text-base" />
          <span>
            Every date here is an estimate from the cycles you recorded. It is not medical advice and it is not a
            contraceptive plan — the calendar method on its own has a typical-use failure rate of about 24% a year.
          </span>
        </p>
      </div>
    </>
  );
}
