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
 * ## Why the fertility part is labelled rather than hidden
 *
 * A hormonal method suppresses ovulation, so a calendar estimate of a fertile
 * window stops being a statement about fertility at all. Hiding the window would
 * hide data the user logged against; rendering it unlabelled would be worse. So
 * when `contraception.affectsPrediction` is true the window is still shown and
 * the card says plainly what it is not, and the row itself is relabelled rather
 * than left with the word "fertile" on it.
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
import type { ReactNode } from 'react';
import { BarChartIcon } from '@svg-animated-icons/react/bar-chart';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { ExclamationTriangleIcon } from '@svg-animated-icons/react/exclamation-triangle';
import { PageHeader } from '@/components/app/PageHeader';
import { usePeriodPrediction, usePeriodStats } from '@/components/period/data';
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

/** The one line that says what the date was derived from. */
function basisSummary(basis: PeriodPredictionBasis): string {
  const cycles = `${basis.cycleCount} recorded ${basis.cycleCount === 1 ? 'cycle' : 'cycles'}`;
  const average =
    basis.averageCycleLengthDays === null
      ? 'no measurable average yet'
      : `${daysLabel(basis.averageCycleLengthDays)} average`;
  const intervals = `${basis.usedIntervalLengths.length} measured ${
    basis.usedIntervalLengths.length === 1 ? 'interval' : 'intervals'
  }`;
  return `${cycles} · ${average} · ${intervals} used for the estimate`;
}

/** Where the `±` came from, in the contract's own two terms. */
function uncertaintySourceLabel(prediction: PeriodPrediction): string {
  const uncertainty = prediction.uncertainty;
  if (!uncertainty) return 'The prediction did not include an uncertainty range.';
  return uncertainty.source === 'observed'
    ? 'Widest likely window, from the spread of your own recorded cycles. The start is a range, not a date: the ± is how much your cycles vary around the estimate.'
    : 'Widest likely window — a default width, because fewer than three cycles have been measured to derive a spread from. The start is a range, not a date.';
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
  const basis = prediction.basis;
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
      </SettingsRow>

      {/* The width and where it came from, said once, in the contract's own two
          terms. `observed` is this user's spread; `default` is the honest
          fallback while there are too few cycles to measure one. */}
      <NoteRow>{uncertaintySourceLabel(prediction)}</NoteRow>

      {uncertainty ? (
        <ValueRow
          label="Earliest start"
          value={weekdayDateLabel(uncertainty.earliest)}
          hint={rangeLabel(uncertainty.earliest, uncertainty.latest)}
        />
      ) : null}
      {uncertainty ? <ValueRow label="Latest start" value={weekdayDateLabel(uncertainty.latest)} /> : null}

      <ValueRow label="Cycle length used" value={daysLabel(prediction.predictedCycleLengthDays)} />
      <ValueRow
        label="Day of this cycle today"
        value={prediction.currentCycleDay === null ? '—' : `Day ${prediction.currentCycleDay}`}
        hint={prediction.lastPeriodStart ? `from ${longDate(prediction.lastPeriodStart)}` : undefined}
      />

      {/* What the date was derived from, stated rather than left to the reader. */}
      <NoteRow>
        <p className="text-muted-foreground">{basisSummary(basis)}</p>
      </NoteRow>

      {prediction.overdueDays !== null ? (
        <NoteRow icon={<ExclamationTriangleIcon className="size-5" />}>
          <p className="font-medium">Running late</p>
          <p className="text-muted-foreground">
            The prediction for this cycle was {longDate(prediction.predictedFromLastCycle ?? start)},{' '}
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
            <p className="text-xs text-muted-foreground">
              Nothing is filled in with a default date on purpose: one cycle is not a basis for a date, and a
              confident-looking wrong date would be worse than no date.
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
            hormonal and suppresses ovulation, so a window derived from your cycle length is arithmetic rather than
            a statement about fertility. The dates are shown below because they are part of the prediction and you
            logged against them — read them as cycle arithmetic, not as when you can or cannot conceive.
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
            This estimate was clamped into the current cycle: the luteal phase in use would otherwise have placed it
            before the cycle began or on the next predicted period. See the notes below.
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

/** One list of day counts, wrapping, so a long history never squeezes a label. */
function NumberListRow({ label, values, hint }: { label: string; values: number[]; hint: ReactNode }) {
  return (
    <NoteRow>
      <p className="text-muted-foreground">{label}</p>
      <p className="font-medium tabular-nums">{values.length === 0 ? '—' : `${values.join(', ')} days`}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
    </NoteRow>
  );
}

/**
 * Why the number is that number.
 *
 * Every field of `PeriodPredictionBasis` is shown, including the ones that make
 * the estimate look less certain (the wide spread, the intervals that were left
 * out). A prediction a person cannot audit is one they cannot trust, which is
 * why the API returns its own inputs at all.
 */
function BasisGroup({ prediction }: { prediction: PeriodPrediction }) {
  const basis = prediction.basis;
  const observedSpread = prediction.uncertainty?.source === 'observed';

  return (
    <SettingsGroup
      title="How this was worked out"
      footer="From your recorded cycle starts. The point estimate is a recency-weighted mean of the interval lengths, weighted towards recent cycles because they describe the cycle you have now."
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
      {/* The two lists are the raw input, so they wrap rather than squeezing the
          label beside them — a long history is the common case, not the edge. */}
      <NumberListRow
        label="Intervals used for the estimate, in days"
        values={basis.usedIntervalLengths}
        hint={
          basis.predictionCycleCount === null
            ? 'Every recorded interval.'
            : `From the ${basis.predictionCycleCount} most recent cycles, the setting you chose.`
        }
      />
      <NumberListRow
        label="All measured intervals, in days"
        values={basis.intervalLengths}
        hint="Including any left out of the estimate."
      />
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
/* the history the prediction is drawn from                                   */
/* -------------------------------------------------------------------------- */

/** Every measured cycle length, oldest last, with the summary beneath it. */
function CycleLengthGroup({ stats }: { stats: PeriodStats }) {
  return (
    <SettingsGroup title="Cycle length history">
      {stats.cycleLengths.length === 0 ? (
        <NoteRow icon={<BarChartIcon className="size-5" />}>
          <p className="text-muted-foreground">
            No complete cycle has been measured yet. A cycle length is the days from one period start to the day
            before the next, so the first one appears once a second start is logged.
          </p>
        </NoteRow>
      ) : (
        <>
          {stats.cycleLengths.map((interval) => (
            <ValueRow
              key={`${interval.from}-${interval.to}`}
              label={`${longDate(interval.from)} → ${longDate(interval.to)}`}
              value={daysLabel(interval.days)}
            />
          ))}
          <ValueRow label="Average" value={daysLabel(stats.averageCycleLengthDays)} />
          <ValueRow label="Shortest" value={daysLabel(stats.shortestCycleDays)} />
          <ValueRow label="Longest" value={daysLabel(stats.longestCycleDays)} />
          <ValueRow label="Standard deviation" value={daysLabel(stats.standardDeviationDays)} />
        </>
      )}
    </SettingsGroup>
  );
}

/** How much has actually been logged — the denominator for everything above. */
function LoggedDaysGroup({ stats }: { stats: PeriodStats }) {
  return (
    <SettingsGroup
      title="Logged days"
      footer="Counts come from the days that carry a log. A day with nothing recorded is not a day with no bleeding — it is a day nobody wrote down."
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
  // Two reads, not one: the prediction is a point-in-time answer and the stats
  // are the history behind it, so either can be shown while the other is still
  // arriving, and a failure in one does not blank the other.
  const prediction = usePeriodPrediction();
  const stats = usePeriodStats();
  const value = prediction.data;
  const history = stats.data;

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
      <CycleLengthGroup stats={history} />
      <LoggedDaysGroup stats={history} />
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
        {predictionCard}

        {value && value.dataSufficient ? <FertilityGroup prediction={value} /> : null}
        {value ? <BasisGroup prediction={value} /> : null}
        {value && value.notes.length > 0 ? <NotesGroup notes={value.notes} /> : null}

        {historyCards}
      </div>
    </>
  );
}
