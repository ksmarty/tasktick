'use client';

/**
 * The period charts — hand-rolled SVG, no charting dependency.
 *
 * ## Why there is no library here
 *
 * These are four small series over a handful of points: one point per measured
 * cycle, one dot per temperature reading, one bar per phase. `recharts` or
 * `visx` would add a dependency, a bundle and a second set of layout opinions to
 * draw what is a `<polyline>` and a few `<circle>`s — and this project has
 * repeatedly deleted a dependency rather than keep one for the parts it uses.
 * The SVG is in the app's own palette tokens, so it follows the theme and the
 * accent preference with no configuration at all.
 *
 * The arithmetic lives in `./chart-math`, as pure functions with their own tests,
 * because the part that can silently be wrong is the scale, not the drawing.
 *
 * ## Accessibility is the reason each chart has a caption
 *
 * A chart a screen reader cannot read is worse than the paragraph it replaced, so
 * every one of these is a `<figure>` whose `<svg>` carries `role="img"` and an
 * `aria-label` that *states the finding* — "your last 8 measured cycles averaged
 * 26 days, ranging 24–29" — and which renders the same sentence as a visible
 * caption underneath. The finding is computed once and used for both, so the
 * picture and the words cannot drift. Charts whose points are individually
 * meaningful (a cycle, a day) keep that meaning in the caption rather than in
 * hover-only tooltips, which a phone does not have.
 *
 * ## Every chart renders an empty state rather than nothing
 *
 * Each component returns its `<figure>` whatever the data, with a sentence
 * instead of an axis when there is nothing to plot. A card that vanishes when a
 * user has one cycle instead of two is how a screen ends up looking broken, and
 * it is the case a chart most often divides by zero.
 */
import type { ReactNode } from 'react';
import {
  backtestBars,
  cycleFinding,
  cycleLengthValues,
  forecastErrors as backtestForecastErrors,
  forecastFinding,
  meanAbsoluteError,
  paddedDomain,
  phaseBars,
  phaseFinding,
  projectXValue,
  projectY,
  seriesPath,
  seriesPoints,
  temperatureFinding,
  type Box,
  type CycleLength,
  type Domain,
  type PhaseSegment,
  type TemperatureReading,
} from './chart-math';
import { cn } from '@/lib/utils';

/* -------------------------------------------------------------------------- */
/* shared pieces                                                              */
/* -------------------------------------------------------------------------- */

/** The drawing boxes. One per shape, so every chart of a kind is the same size. */
const LINE_BOX: Required<Box> = { width: 320, height: 120, inset: 26 };
const RANGE_BOX: Required<Box> = { width: 320, height: 56, inset: 16 };
/**
 * The phase bar's box.
 *
 * Taller than the bar itself, because the marker for today sits *above* it and an
 * SVG clips whatever falls outside its viewBox — the first version drew the
 * marker a few units above the bar and lost half of it.
 */
const PHASE_BOX: Required<Box> = { width: 320, height: 34, inset: 0 };

/** Where the bar sits inside its box, leaving room for the marker. */
const PHASE_BAR_TOP = 8;
const PHASE_BAR_HEIGHT = 20;
const BAR_BOX: Required<Box> = { width: 320, height: 104, inset: 22 };

/**
 * The frame every chart shares: the finding, the picture, the same finding.
 *
 * `data-chart` is the hook the probe (and a human with devtools) uses to find the
 * chart rather than matching on its text.
 */
function ChartFrame({
  chart,
  title,
  finding,
  empty = false,
  children,
}: {
  chart: string;
  title: string;
  finding: string;
  /** True when there was nothing to plot: the same hook, marked as empty. */
  empty?: boolean;
  children?: ReactNode;
}) {
  return (
    <figure data-chart={chart} data-chart-empty={empty ? 'true' : undefined} className="flex flex-col gap-2">
      {children}
      {/* The visible half of the text alternative, and the same string as the
          SVG's accessible name — one source, so they cannot disagree. */}
      <figcaption className="text-xs leading-relaxed text-muted-foreground">
        <span className="sr-only">{title}. </span>
        {finding}
      </figcaption>
    </figure>
  );
}

/** A chart with no data to draw: the finding explains why, with no empty axis. */
function EmptyChart({ chart, title, finding }: { chart: string; title: string; finding: string }) {
  return (
    <ChartFrame chart={chart} title={title} finding={finding} empty>
      <p className="flex h-16 items-center text-sm text-muted-foreground">Nothing recorded yet.</p>
    </ChartFrame>
  );
}

/** Axis tick text: muted, and 9 units via the SVG's own font-size below. */
const TICK_CLASS = 'fill-muted-foreground';

/** The type size every chart's ticks share, set once on the SVG. */
const TICK_SIZE = 9;

/* -------------------------------------------------------------------------- */
/* cycle length over time                                                     */
/* -------------------------------------------------------------------------- */

export interface CycleLengthChartProps {
  lengths: CycleLength[];
  /** The average the prediction is built on, drawn as the reference line. */
  average: number | null;
  /** One standard deviation, shaded either side of the average, when measured. */
  deviation: number | null;
  className?: string;
}

/**
 * One point per measured cycle, with the average as a reference line.
 *
 * This is the chart the screen exists for: it shows at a glance whether the
 * cycles are stable, and it is the visual answer to "why is the prediction ± 3
 * days" — the band around the average *is* the uncertainty. The shaded band is
 * one standard deviation, drawn only when the API measured one.
 */
export function CycleLengthChart({ lengths, average, deviation, className }: CycleLengthChartProps) {
  const values = cycleLengthValues(lengths);
  const finding = cycleFinding(lengths, average);

  if (values.length === 0) {
    return (
      <div className={className}>
        <EmptyChart
          chart="cycle-length"
          title="Cycle length over time"
          finding="A cycle length is the days from one period start to the day before the next, so the first point appears once a second start is logged."
        />
      </div>
    );
  }

  const domain = paddedDomain(values, 1);
  const points = seriesPoints(values, LINE_BOX, domain);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const averageY = average === null ? null : projectY(average, domain, LINE_BOX);
  const band =
    average === null || deviation === null
      ? null
      : {
          top: projectY(average + deviation, domain, LINE_BOX),
          bottom: projectY(average - deviation, domain, LINE_BOX),
        };

  return (
    <div className={className}>
      <ChartFrame chart="cycle-length" title="Cycle length over time" finding={finding}>
        <svg
          viewBox={`0 0 ${LINE_BOX.width} ${LINE_BOX.height}`}
          className="h-auto w-full max-w-sm" fontSize={TICK_SIZE}
          role="img"
          aria-label={`Cycle length over time. ${finding}`}
        >
          {/* One standard deviation either side of the average: the same spread
              the prediction's ± is derived from. */}
          {band !== null ? (
            <rect
              x={LINE_BOX.inset}
              y={band.top}
              width={LINE_BOX.width - LINE_BOX.inset * 2}
              height={Math.max(0, band.bottom - band.top)}
              className="fill-muted"
              opacity={0.7}
            />
          ) : null}

          {/* The baseline, so a point's height reads as a value rather than a shape. */}
          <line
            x1={LINE_BOX.inset}
            y1={LINE_BOX.height - LINE_BOX.inset}
            x2={LINE_BOX.width - LINE_BOX.inset}
            y2={LINE_BOX.height - LINE_BOX.inset}
            className="stroke-border"
            strokeWidth={1}
          />

          {/* The average. Dashed, because it is a summary and not a measurement. */}
          {averageY !== null ? (
            <>
              <line
                x1={LINE_BOX.inset}
                y1={averageY}
                x2={LINE_BOX.width - LINE_BOX.inset}
                y2={averageY}
                className="stroke-muted-foreground"
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <text x={LINE_BOX.inset} y={averageY - 3} className={TICK_CLASS}>
                average {average}
              </text>
            </>
          ) : null}

          <path d={seriesPath(points)} fill="none" className="stroke-primary" strokeWidth={2} />
          {points.map((point) => (
            <circle key={`${point.index}`} cx={point.x} cy={point.y} r={3} className="fill-primary" />
          ))}

          {/* The ends of the series, labelled: without them the x axis says
              nothing about when any of this happened. */}
          <text x={first.x} y={LINE_BOX.height - 6} textAnchor="middle" className={TICK_CLASS}>
            {shortLabel(lengths[0]!.from)}
          </text>
          {points.length > 1 ? (
            <text x={last.x} y={LINE_BOX.height - 6} textAnchor="middle" className={TICK_CLASS}>
              {shortLabel(lengths[lengths.length - 1]!.to)}
            </text>
          ) : null}

          {/* The shortest and longest measured values, so the axis is readable. */}
          <text x={2} y={projectY(domain.max, domain, LINE_BOX)} className={TICK_CLASS}>
            {domain.max}
          </text>
          <text x={2} y={projectY(domain.min, domain, LINE_BOX)} className={TICK_CLASS}>
            {domain.min}
          </text>
        </svg>
      </ChartFrame>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* the spread the prediction is built from                                    */
/* -------------------------------------------------------------------------- */

export interface CycleRangeChartProps {
  lengths: CycleLength[];
  average: number | null;
  shortest: number | null;
  longest: number | null;
  className?: string;
}

/**
 * The range the cycles cover, with every one of them and the average on it.
 *
 * The line chart says "in order"; this says "how spread out", which is the other
 * half of the uncertainty story. A dot per cycle makes a repeated length visible
 * (two cycles of 28 and one of 24 is a different history from three of 27).
 */
export function CycleRangeChart({ lengths, average, shortest, longest, className }: CycleRangeChartProps) {
  const values = cycleLengthValues(lengths);

  if (values.length === 0) {
    return (
      <div className={className}>
        <EmptyChart
          chart="cycle-range"
          title="How far apart the cycles are"
          finding="Two recorded period starts are the minimum for a range, and there is one so far."
        />
      </div>
    );
  }

  const domain = paddedDomain(values, 1);
  const finding =
    shortest !== null && longest !== null && average !== null
      ? shortest === longest
        ? `Every measured cycle is ${shortest} days, so the prediction has almost no spread to allow for.`
        : `Measured cycles run from ${shortest} to ${longest} days, averaging ${average} — a spread of ${longest - shortest} days.`
      : cycleFinding(lengths, average);

  const left = projectXValue(shortest ?? domain.min, domain, RANGE_BOX);
  const right = projectXValue(longest ?? domain.max, domain, RANGE_BOX);
  const averageX = average === null ? null : projectXValue(average, domain, RANGE_BOX);
  // Two cycles of the same length land on the same x; nudging each point up by a
  // pixel per repeat is what makes a count visible without a legend.
  const seen = new Map<number, number>();

  return (
    <div className={className}>
      <ChartFrame chart="cycle-range" title="How far apart the cycles are" finding={finding}>
        <svg
          viewBox={`0 0 ${RANGE_BOX.width} ${RANGE_BOX.height}`}
          className="h-auto w-full max-w-sm" fontSize={TICK_SIZE}
          role="img"
          aria-label={`How far apart the cycles are. ${finding}`}
        >
          <rect
            x={left}
            y={RANGE_BOX.height / 2 - 6}
            width={Math.max(2, right - left)}
            height={12}
            rx={6}
            className="fill-muted"
          />

          {averageX !== null ? (
            <>
              <line
                x1={averageX}
                y1={RANGE_BOX.height / 2 - 12}
                x2={averageX}
                y2={RANGE_BOX.height / 2 + 12}
                className="stroke-muted-foreground"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <text x={averageX} y={RANGE_BOX.height / 2 - 16} textAnchor="middle" className={TICK_CLASS}>
                avg {average}
              </text>
            </>
          ) : null}

          {values.map((value, index) => {
            const x = projectXValue(value, domain, RANGE_BOX);
            const repeats = seen.get(x) ?? 0;
            seen.set(x, repeats + 1);
            return (
              <circle
                key={`${index}`}
                cx={x}
                cy={RANGE_BOX.height / 2 + repeats * 4}
                r={3}
                className="fill-primary"
              />
            );
          })}

          <text x={left} y={RANGE_BOX.height - 2} textAnchor="middle" className={TICK_CLASS}>
            {shortest ?? domain.min}
          </text>
          <text x={right} y={RANGE_BOX.height - 2} textAnchor="middle" className={TICK_CLASS}>
            {longest ?? domain.max}
          </text>
        </svg>
      </ChartFrame>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* where today sits                                                           */
/* -------------------------------------------------------------------------- */

export interface CyclePhaseBarProps {
  segments: PhaseSegment[];
  /** `PeriodPrediction.currentCycleDay`, or null. */
  cycleDay: number | null;
  /** `PeriodPrediction.predictedCycleLengthDays`, or null. */
  totalDays: number | null;
  className?: string;
}

/**
 * The colour each phase takes: an SVG fill and the matching HTML swatch.
 *
 * One map rather than two, so the bar and the legend cannot end up different
 * colours — which is the whole failure mode of a legend.
 */
const PHASE_STYLE: Record<PhaseSegment['phase'], { fill: string; swatch: string }> = {
  menstrual: { fill: 'fill-primary', swatch: 'bg-primary' },
  follicular: { fill: 'fill-muted', swatch: 'bg-muted' },
  fertile: { fill: 'fill-chart-2', swatch: 'bg-chart-2' },
  luteal: { fill: 'fill-accent', swatch: 'bg-accent' },
};

/**
 * Today's position in the cycle, as one bar instead of a paragraph.
 *
 * Four contiguous segments — bleeding, then the stretch before the fertile
 * window, the window itself, and the days after it — with a marker where today
 * is. The legend under the bar carries the day numbers, so the phases are named
 * in words as well as coloured; the segments are `aria-hidden` because the
 * finding already says which one today is in.
 */
export function CyclePhaseBar({ segments, cycleDay, totalDays, className }: CyclePhaseBarProps) {
  const finding = phaseFinding(segments, cycleDay, totalDays);

  if (segments.length === 0 || totalDays === null) {
    return (
      <div className={className}>
        <EmptyChart chart="phase" title="Where today sits" finding={finding} />
      </div>
    );
  }

  const bars = phaseBars(segments, totalDays, PHASE_BOX);
  const markerX =
    cycleDay === null
      ? null
      : projectXValue(cycleDay, { min: 1, max: totalDays + 1 }, PHASE_BOX);

  return (
    <div className={className}>
      <ChartFrame chart="phase" title="Where today sits" finding={finding}>
        <svg
          viewBox={`0 0 ${PHASE_BOX.width} ${PHASE_BOX.height}`}
          className="h-auto w-full max-w-sm" fontSize={TICK_SIZE}
          role="img"
          aria-label={`Where today sits in the cycle. ${finding}`}
        >
          {bars.map((bar) => (
            <rect
              key={bar.phase}
              x={bar.x}
              y={PHASE_BAR_TOP}
              width={bar.width}
              height={PHASE_BAR_HEIGHT}
              rx={3}
              className={PHASE_STYLE[bar.phase].fill}
            />
          ))}
          {markerX !== null ? (
            <>
              <line
                x1={markerX}
                y1={1}
                x2={markerX}
                y2={PHASE_BAR_TOP + PHASE_BAR_HEIGHT + 4}
                className="stroke-foreground"
                strokeWidth={2}
              />
              <circle cx={markerX} cy={3.5} r={3} className="fill-foreground" />
            </>
          ) : null}
        </svg>

        {/* The key: colour plus a word and its day numbers, which is what makes
            the bar readable for the ~8% of men who cannot separate the hues. */}
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {bars.map((bar) => (
            <li key={bar.phase} className="flex items-center gap-1.5">
              <span aria-hidden className={cn('inline-block size-2 rounded-full', PHASE_STYLE[bar.phase].swatch)} />
              {bar.label} {bar.startDay === bar.endDay ? bar.startDay : `${bar.startDay}–${bar.endDay}`}
            </li>
          ))}
        </ul>
      </ChartFrame>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* how close the estimates have landed                                        */
/* -------------------------------------------------------------------------- */

export interface ForecastErrorChartProps {
  /** Measured cycle lengths, oldest first — the input to the backtest. */
  lengths: number[];
  className?: string;
}

/**
 * A backtest, drawn honestly.
 *
 * The API stores no past predictions, so the only way to answer "is this model
 * any good for me" is to replay a rule over the recorded history. The rule is the
 * mean of the cycles *before* each one — no future knowledge, no recency
 * weighting, and therefore no pretence of being the app's own model. The caption
 * says the word "backtest" for that reason; a chart that silently showed the
 * model's error would be making a claim nothing here can support.
 */
export function ForecastErrorChart({ lengths, className }: ForecastErrorChartProps) {
  const errors = backtestForecastErrors(lengths);
  const finding = forecastFinding(errors);
  const measured = errors.filter((entry): entry is typeof entry & { error: number } => entry.error !== null);
  const average = meanAbsoluteError(errors);

  if (measured.length === 0) {
    return (
      <div className={className}>
        <EmptyChart chart="forecast-error" title="How close past estimates were" finding={finding} />
      </div>
    );
  }

  const values = measured.map((entry) => entry.error);
  const domain = paddedDomain(values, 1);
  const bars = backtestBars(values, BAR_BOX, domain);
  const zeroY = projectY(0, domain, BAR_BOX);

  return (
    <div className={className}>
      <ChartFrame chart="forecast-error" title="How close past estimates were" finding={finding}>
        <svg
          viewBox={`0 0 ${BAR_BOX.width} ${BAR_BOX.height}`}
          className="h-auto w-full max-w-sm" fontSize={TICK_SIZE}
          role="img"
          aria-label={`How close past estimates were. ${finding}`}
        >
          <line
            x1={BAR_BOX.inset}
            y1={zeroY}
            x2={BAR_BOX.width - BAR_BOX.inset}
            y2={zeroY}
            className="stroke-border"
            strokeWidth={1}
          />
          {/* Zero is "landed exactly", so the two sides mean "early" and "late". */}
          <text x={BAR_BOX.width - BAR_BOX.inset} y={zeroY - 3} textAnchor="end" className={TICK_CLASS}>
            on the average
          </text>

          {bars.map((bar, index) => (
            <rect
              key={`${measured[index]!.index}`}
              x={bar.x}
              y={bar.y}
              width={bar.width}
              height={bar.height}
              rx={2}
              className={bar.value >= 0 ? 'fill-primary' : 'fill-muted-foreground'}
            />
          ))}

          <text x={2} y={projectY(domain.max, domain, BAR_BOX)} className={TICK_CLASS}>
            +{domain.max} d
          </text>
          <text x={2} y={projectY(domain.min, domain, BAR_BOX)} className={TICK_CLASS}>
            {domain.min} d
          </text>
          {average !== null ? (
            <text x={BAR_BOX.width / 2} y={BAR_BOX.height - 4} textAnchor="middle" className={TICK_CLASS}>
              average miss {average} days
            </text>
          ) : null}
        </svg>
      </ChartFrame>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* the body-signs series                                                      */
/* -------------------------------------------------------------------------- */

export interface TemperatureChartProps {
  series: TemperatureReading[];
  className?: string;
}

/**
 * Basal body temperature over the recorded days.
 *
 * Shown only when the user has turned body signs on. It is a chart of *their own
 * readings* and nothing more: no coverline, no shift detection, no reading of
 * what the numbers mean — those are interpretations, and the feature's rule is
 * that a period prediction never reads as medical advice. The caption states the
 * day count and the range, which is what a person actually wants from a
 * temperature log at a glance.
 */
export function TemperatureChart({ series, className }: TemperatureChartProps) {
  const finding = temperatureFinding(series);
  const values = series.map((reading) => reading.temperatureC);

  if (values.length === 0) {
    return (
      <div className={className}>
        <EmptyChart
          chart="temperature"
          title="Basal temperature"
          finding="Nothing recorded yet. A basal temperature is taken first thing, before getting up."
        />
      </div>
    );
  }

  const domain: Domain = paddedDomain(values, 0.15);
  const points = seriesPoints(values, LINE_BOX, domain);
  const first = points[0]!;
  const last = points[points.length - 1]!;

  return (
    <div className={className}>
      <ChartFrame chart="temperature" title="Basal temperature" finding={finding}>
        <svg
          viewBox={`0 0 ${LINE_BOX.width} ${LINE_BOX.height}`}
          className="h-auto w-full max-w-sm" fontSize={TICK_SIZE}
          role="img"
          aria-label={`Basal temperature. ${finding}`}
        >
          <line
            x1={LINE_BOX.inset}
            y1={LINE_BOX.height - LINE_BOX.inset}
            x2={LINE_BOX.width - LINE_BOX.inset}
            y2={LINE_BOX.height - LINE_BOX.inset}
            className="stroke-border"
            strokeWidth={1}
          />
          <path d={seriesPath(points)} fill="none" className="stroke-primary" strokeWidth={2} />
          {points.map((point) => (
            <circle key={point.index} cx={point.x} cy={point.y} r={2.5} className="fill-primary" />
          ))}
          <text x={first.x} y={LINE_BOX.height - 6} textAnchor="middle" className={TICK_CLASS}>
            {shortLabel(series[0]!.date)}
          </text>
          {points.length > 1 ? (
            <text x={last.x} y={LINE_BOX.height - 6} textAnchor="middle" className={TICK_CLASS}>
              {shortLabel(series[series.length - 1]!.date)}
            </text>
          ) : null}
          <text x={2} y={projectY(domain.max, domain, LINE_BOX)} className={TICK_CLASS}>
            {domain.max.toFixed(2)}
          </text>
          <text x={2} y={projectY(domain.min, domain, LINE_BOX)} className={TICK_CLASS}>
            {domain.min.toFixed(2)}
          </text>
        </svg>
      </ChartFrame>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** `'2025-10-14'` -> `14 Oct`, without importing a zone-aware formatter. */
function shortLabel(date: string): string {
  const [, month, day] = date.split('-');
  const name = MONTHS[Number(month) - 1] ?? month ?? '';
  return `${Number(day)} ${name}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

