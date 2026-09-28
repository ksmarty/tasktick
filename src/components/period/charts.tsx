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
 * picture and the words cannot drift.
 *
 * ## Reading a value off a point
 *
 * The finding is the chart's answer to "what does this show"; the interaction is
 * its answer to "what is *that* point". Every chart here is scrubbable: a tap, a
 * hover or the arrow keys move a selection, and the selected value is written into
 * a line of text under the picture — `ScrubLine` — so the reading is text rather
 * than a tooltip that floats over the plot. Three reasons that shape was chosen
 * over a tooltip:
 *
 *  · a tooltip is drawn over the thing it describes, which is exactly the class of
 *    collision the layout fixes below are about;
 *  · a tooltip is invisible to a screen reader and to a screenshot;
 *  · a reserved line of text does not move the chart when it appears.
 *
 * The pointer handling is `pointerdown`/`pointermove` rather than touch events, so
 * a mouse works the same way a finger does — hovering is a valid way to read a
 * point on a desktop, and `touch-pan-y` leaves vertical scrolling to the browser
 * while horizontal drags scrub. The keyboard handler is separate because arrow
 * keys are not pointer events, and it is the reason a chart is focusable at all;
 * the caption remains the non-interactive equivalent for everything else.
 *
 * The hit test itself — nearest point, or the bar whose span contains the x — is
 * pure and lives in `chart-math`, next to the scales it inverts.
 *
 * ## Every chart renders an empty state rather than nothing
 *
 * Each component returns its `<figure>` whatever the data, with a sentence
 * instead of an axis when there is nothing to plot. A card that vanishes when a
 * user has one cycle instead of two is how a screen ends up looking broken, and
 * it is the case a chart most often divides by zero.
 *
 * ## What "drawn properly" meant here
 *
 * Measured at 390px before this pass: the cycle-length chart's `average 28` label
 * sat on top of the first data point, the forecast chart's `on the average` label
 * sat on top of its tallest bar, and the range strip used 192 of the 288 units of
 * plot width because a whole day of padding was reserved either side of it. Those
 * are the three things the drawing changes below address — a label moved into a
 * band the data cannot enter, a key moved out of the plot entirely, and a pad
 * that scales with the spread instead of being a fixed day.
 */
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import {
  backtestBars,
  barIndexAt,
  cycleFinding,
  cycleLengthValues,
  forecastErrors as backtestForecastErrors,
  forecastFinding,
  meanAbsoluteError,
  nearestIndex,
  paddedDomain,
  phaseBars,
  phaseFinding,
  projectXValue,
  projectY,
  seriesPath,
  seriesPoints,
  stackOffsets,
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
 * How much of a day the range strip reserves either side of the cycles it shows.
 *
 * It was a whole day, which cost the strip 33% of the plot width for nothing: the
 * mark that has to stay off the edge is a 3-unit dot, and half a day is 16 units
 * of margin for it. The pad only decides layout — the axis ticks print the
 * measured shortest and longest, not the padded bounds.
 */
const RANGE_PAD = 0.5;

/** The height of the range strip, and the radius of the dots that sit in it. */
const RANGE_STRIP_HEIGHT = 20;
const RANGE_DOT_RADIUS = 3;

/** How tall a bar for an exactly-average cycle is drawn: visible, but a stub. */
const ZERO_BAR_HEIGHT = 2;

/** Axis tick text: muted, and 9 units via the SVG's own font-size below. */
const TICK_CLASS = 'fill-muted-foreground';

/** The type size every chart's ticks share, set once on the SVG. */
const TICK_SIZE = 9;

/** The class every scrubbable SVG shares: focus ring, and pan-y for the scroller. */
const PLOT_CLASS = 'h-auto w-full max-w-sm touch-pan-y outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary';

/**
 * The frame every chart shares: the picture, the reading, the finding.
 *
 * `data-chart` is the hook the probe (and a human with devtools) uses to find the
 * chart rather than matching on its text.
 */
function ChartFrame({
  chart,
  title,
  finding,
  empty = false,
  readout,
  children,
}: {
  chart: string;
  title: string;
  finding: string;
  /** True when there was nothing to plot: the same hook, marked as empty. */
  empty?: boolean;
  /** The interaction's line of text, already built by the caller. */
  readout?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <figure data-chart={chart} data-chart-empty={empty ? 'true' : undefined} className="flex flex-col gap-2">
      {children}
      {readout}
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

/**
 * A key for the marks a chart draws.
 *
 * Drawn in HTML below the picture rather than as SVG text inside it, because
 * inside is where labels collide with data: both of the overlaps measured before
 * this pass were a label drawn into the plot area. A legend has a reserved band
 * of its own and cannot be landed on by a point.
 */
function ChartKey({ items }: { items: { swatch: ReactNode; label: string }[] }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-flex shrink-0 items-center">
            {item.swatch}
          </span>
          {item.label}
        </li>
      ))}
    </ul>
  );
}

/** A line swatch for {@link ChartKey}: the same dash a reference line uses. */
function DashedSwatch() {
  return <span className="inline-block h-0 w-4 border-t border-dashed border-muted-foreground" />;
}

/* -------------------------------------------------------------------------- */
/* the scrubber                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The interaction state for one chart.
 *
 * Deliberately in the component and not in `chart-math`: the only thing here that
 * is arithmetic is the conversion from a client x to a user-unit x and the hit
 * test, and the hit test is the part that was extracted ({@link nearestIndex},
 * {@link barIndexAt}). What is left is React state, which has no business in a
 * module that is unit-tested without a DOM.
 *
 * `pick` maps a user-unit x to an index (or null). It is re-created on every
 * render by the caller, so the handlers below are too — there is no memoisation
 * to go stale, and the arrays here are at most a handful of entries long.
 */
function useScrub(count: number, pick: (userX: number) => number | null) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [active, setActive] = useState<number | null>(null);

  const bounded = (index: number | null) =>
    index === null || count === 0 ? null : Math.min(count - 1, Math.max(0, index));

  /** A client x, through the rendered box and back into the viewBox's units. */
  const pickAt = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || count === 0) return;
    const rect = svg.getBoundingClientRect();
    const viewWidth = Number((svg.getAttribute('viewBox') ?? '').split(/\s+/)[2]);
    // A zero-width box means the chart is not laid out (or is hidden); a pointer
    // read then would divide by zero and select index NaN.
    if (!(rect.width > 0) || !Number.isFinite(viewWidth) || viewWidth <= 0) return;
    setActive(bounded(pick(((clientX - rect.left) / rect.width) * viewWidth)));
  };

  const step = (delta: number) =>
    setActive((current) => {
      if (count === 0) return null;
      if (current === null) return delta > 0 ? 0 : count - 1;
      return Math.min(count - 1, Math.max(0, current + delta));
    });

  return {
    svgRef,
    active,
    handlers: {
      onPointerDown: (event: ReactPointerEvent<SVGSVGElement>) => {
        // Capture, so a drag that slides off the chart keeps scrubbing instead of
        // stopping at the edge.
        event.currentTarget.setPointerCapture?.(event.pointerId);
        pickAt(event.clientX);
      },
      onPointerMove: (event: ReactPointerEvent<SVGSVGElement>) => {
        // A mouse reads on hover — a desktop user should not have to hold the
        // button down. A touch needs one, because a moving finger with no button
        // pressed is a scroll, and the browser owns that.
        if (event.pointerType === 'mouse' || event.buttons !== 0) pickAt(event.clientX);
      },
      onPointerLeave: (event: ReactPointerEvent<SVGSVGElement>) => {
        if (event.pointerType === 'mouse' && event.buttons === 0) setActive(null);
      },
      onKeyDown: (event: ReactKeyboardEvent<SVGSVGElement>) => {
        if (count === 0) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          step(1);
          event.preventDefault();
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          step(-1);
          event.preventDefault();
        } else if (event.key === 'Home') {
          setActive(0);
          event.preventDefault();
        } else if (event.key === 'End') {
          setActive(count - 1);
          event.preventDefault();
        } else if (event.key === 'Escape') {
          setActive(null);
        }
      },
    },
  };
}

/**
 * The line a chart's interaction writes into.
 *
 * Its height is reserved whether or not there is a reading, so scrubbing does not
 * push the caption down the screen; and it is `aria-live` so a screen reader hears
 * the value the arrow keys just moved to. The idle text is the affordance — an
 * invisible interaction is a decorative one — and it names all three ways in.
 */
function ScrubLine({ idle, children }: { idle: string; children?: ReactNode }) {
  return (
    <p className="min-h-4 text-xs text-muted-foreground" aria-live="polite">
      {children ?? <span className="text-muted-foreground/70">{idle}</span>}
    </p>
  );
}

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

  const domain = paddedDomain(values, 1);
  const points = seriesPoints(values, LINE_BOX, domain);
  const scrub = useScrub(points.length, (userX) => nearestIndex(userX, points.map((point) => point.x)));
  const selected = scrub.active === null ? null : (lengths[scrub.active] ?? null);

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
  const activePoint = scrub.active === null ? null : (points[scrub.active] ?? null);

  return (
    <div className={className}>
      <ChartFrame
        chart="cycle-length"
        title="Cycle length over time"
        finding={finding}
        readout={
          <ScrubLine idle="Tap, hover or use ← → to read a cycle.">
            {selected ? `Cycle to ${shortLabel(selected.to)} · ${selected.days} days` : undefined}
          </ScrubLine>
        }
      >
        <svg
          ref={scrub.svgRef}
          viewBox={`0 0 ${LINE_BOX.width} ${LINE_BOX.height}`}
          className={PLOT_CLASS}
          fontSize={TICK_SIZE}
          role="img"
          tabIndex={0}
          aria-label={`Cycle length over time. ${finding}`}
          {...scrub.handlers}
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
            <line
              x1={LINE_BOX.inset}
              y1={averageY}
              x2={LINE_BOX.width - LINE_BOX.inset}
              y2={averageY}
              className="stroke-muted-foreground"
              strokeWidth={1}
              strokeDasharray="4 3"
            />
          ) : null}

          {activePoint !== null ? (
            <line
              x1={activePoint.x}
              y1={LINE_BOX.inset}
              x2={activePoint.x}
              y2={LINE_BOX.height - LINE_BOX.inset}
              className="stroke-muted-foreground"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          ) : null}

          <path d={seriesPath(points)} fill="none" className="stroke-primary" strokeWidth={2} />
          {points.map((point) => (
            <circle key={`${point.index}`} cx={point.x} cy={point.y} r={3} className="fill-primary" />
          ))}
          {activePoint !== null ? (
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r={6}
              className="fill-none stroke-primary"
              strokeWidth={2}
            />
          ) : null}

          {/* The average, and the band around it, named inside the chart. It sits
              in the top margin, above `inset`, which the series can never enter:
              the domain is padded a whole day past the measured extremes, so the
              highest point is always below the top of the plot. The first version
              drew this beside the average line, where it landed on the first
              data point. */}
          {average !== null ? (
            <text x={LINE_BOX.inset} y={LINE_BOX.inset - 8} className={TICK_CLASS}>
              {deviation === null ? `average ${average}` : `average ${average} · ± ${deviation}`}
            </text>
          ) : null}

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

        {/* The band needs a word: the caption gives the average, and the card's
            footnote names the dashed line, but nothing else explains the fill. */}
        {band !== null ? (
          <ChartKey
            items={[
              { swatch: <DashedSwatch />, label: `average ${average} days` },
              { swatch: <span className="inline-block size-2 rounded-xs bg-muted" />, label: `± ${deviation} days (1 SD)` },
            ]}
          />
        ) : null}
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
  const domain = paddedDomain(values, RANGE_PAD);
  const dots = values.map((value) => projectXValue(value, domain, RANGE_BOX));
  const scrub = useScrub(values.length, (userX) => nearestIndex(userX, dots));
  const selected = scrub.active === null ? null : (lengths[scrub.active] ?? null);

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

  const finding =
    shortest !== null && longest !== null && average !== null
      ? shortest === longest
        ? `Every measured cycle is ${shortest} days, so the prediction has almost no spread to allow for.`
        : `Measured cycles run from ${shortest} to ${longest} days, averaging ${average} — a spread of ${longest - shortest} days.`
      : cycleFinding(lengths, average);

  const left = projectXValue(shortest ?? domain.min, domain, RANGE_BOX);
  const right = projectXValue(longest ?? domain.max, domain, RANGE_BOX);
  const averageX = average === null ? null : projectXValue(average, domain, RANGE_BOX);
  const stripTop = RANGE_BOX.height / 2 - RANGE_STRIP_HEIGHT / 2;
  /*
   * Two cycles of the same length land on the same x, so a repeat is made visible
   * by stacking the dots — and the stack has to stay inside the strip it is drawn
   * in. With the smallest radius that fits `maxRepeats` dots tangent and centred,
   * the outermost offsets land exactly on the strip's inner edge, so no dot can
   * overlap its neighbour or poke out of the bar: `r ≤ height / (2 · repeats)`.
   * The first version marched repeats downwards at a fixed 4 units with a fixed
   * radius, which put the third dot of a 28-day cycle 2 units below the strip's own
   * bottom edge.
   */
  const counts = new Map<number, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const maxRepeats = Math.max(...counts.values());
  const radius = Math.min(RANGE_DOT_RADIUS, RANGE_STRIP_HEIGHT / (2 * maxRepeats));
  const spacing = radius * 2;
  const stackLimit = RANGE_STRIP_HEIGHT / 2 - radius;
  const seen = new Map<number, number>();

  return (
    <div className={className}>
      <ChartFrame
        chart="cycle-range"
        title="How far apart the cycles are"
        finding={finding}
        readout={
          <ScrubLine idle="Tap, hover or use ← → to read a cycle.">
            {selected ? `Cycle to ${shortLabel(selected.to)} · ${selected.days} days` : undefined}
          </ScrubLine>
        }
      >
        <svg
          ref={scrub.svgRef}
          viewBox={`0 0 ${RANGE_BOX.width} ${RANGE_BOX.height}`}
          className={PLOT_CLASS}
          fontSize={TICK_SIZE}
          role="img"
          tabIndex={0}
          aria-label={`How far apart the cycles are. ${finding}`}
          {...scrub.handlers}
        >
          <rect
            x={left}
            y={stripTop}
            width={Math.max(2, right - left)}
            height={RANGE_STRIP_HEIGHT}
            rx={RANGE_STRIP_HEIGHT / 2}
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
            const x = dots[index]!;
            const repeat = seen.get(value) ?? 0;
            seen.set(value, repeat + 1);
            const offsets = stackOffsets(counts.get(value) ?? 1, spacing, stackLimit);
            const offset = offsets[repeat] ?? 0;
            return (
              <circle
                key={`${index}`}
                cx={x}
                cy={RANGE_BOX.height / 2 + offset}
                r={radius}
                className="fill-primary"
              />
            );
          })}

          {scrub.active !== null ? (
            <circle
              cx={dots[scrub.active]}
              cy={RANGE_BOX.height / 2}
              r={radius + 3}
              className="fill-none stroke-primary"
              strokeWidth={2}
            />
          ) : null}

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
 * finding already says which one today is in. Scrubbing one names it too, which
 * is what makes the bar readable without colour vision.
 */
export function CyclePhaseBar({ segments, cycleDay, totalDays, className }: CyclePhaseBarProps) {
  const finding = phaseFinding(segments, cycleDay, totalDays);
  const bars = totalDays === null ? [] : phaseBars(segments, totalDays, PHASE_BOX);
  const scrub = useScrub(bars.length, (userX) => barIndexAt(userX, bars));
  const selected = scrub.active === null ? null : (bars[scrub.active] ?? null);

  if (segments.length === 0 || totalDays === null) {
    return (
      <div className={className}>
        <EmptyChart chart="phase" title="Where today sits" finding={finding} />
      </div>
    );
  }

  const markerX = cycleDay === null ? null : projectXValue(cycleDay, { min: 1, max: totalDays + 1 }, PHASE_BOX);

  return (
    <div className={className}>
      <ChartFrame
        chart="phase"
        title="Where today sits"
        finding={finding}
        readout={
          <ScrubLine idle="Tap or hover the bar to read a phase.">
            {selected ? `${selected.label} · days ${selected.startDay}–${selected.endDay}` : undefined}
          </ScrubLine>
        }
      >
        <svg
          ref={scrub.svgRef}
          viewBox={`0 0 ${PHASE_BOX.width} ${PHASE_BOX.height}`}
          className={PLOT_CLASS}
          fontSize={TICK_SIZE}
          role="img"
          tabIndex={0}
          aria-label={`Where today sits in the cycle. ${finding}`}
          {...scrub.handlers}
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
          {/* The selection is an outline, not a fill: the phase's colour is the
              thing being read, and repainting it to show the selection would hide
              the value the legend is keyed to. */}
          {selected !== null ? (
            <rect
              x={selected.x}
              y={PHASE_BAR_TOP}
              width={selected.width}
              height={PHASE_BAR_HEIGHT}
              rx={3}
              className="fill-none stroke-foreground"
              strokeWidth={1.5}
            />
          ) : null}
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
        <ChartKey
          items={bars.map((bar) => ({
            swatch: <span className={cn('inline-block size-2 rounded-full', PHASE_STYLE[bar.phase].swatch)} />,
            label: `${bar.label} ${bar.startDay === bar.endDay ? bar.startDay : `${bar.startDay}–${bar.endDay}`}`,
          }))}
        />
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

  const values = measured.map((entry) => entry.error);
  const domain = paddedDomain(values, 1);
  const bars = backtestBars(values, BAR_BOX, domain);
  const zeroY = projectY(0, domain, BAR_BOX);
  const centers = bars.map((bar) => bar.x + bar.width / 2);
  const scrub = useScrub(bars.length, (userX) => nearestIndex(userX, centers));
  const selected = scrub.active === null ? null : (measured[scrub.active] ?? null);

  if (measured.length === 0) {
    return (
      <div className={className}>
        <EmptyChart chart="forecast-error" title="How close past estimates were" finding={finding} />
      </div>
    );
  }

  return (
    <div className={className}>
      <ChartFrame
        chart="forecast-error"
        title="How close past estimates were"
        finding={finding}
        readout={
          <ScrubLine idle="Tap, hover or use ← → to read a cycle's miss.">
            {selected
              ? `Cycle ${selected.index + 1} · ${selected.actual} days against ${selected.predicted} predicted · ${
                  selected.error > 0 ? '+' : ''
                }${selected.error}`
              : undefined}
          </ScrubLine>
        }
      >
        <svg
          ref={scrub.svgRef}
          viewBox={`0 0 ${BAR_BOX.width} ${BAR_BOX.height}`}
          className={PLOT_CLASS}
          fontSize={TICK_SIZE}
          role="img"
          tabIndex={0}
          aria-label={`How close past estimates were. ${finding}`}
          {...scrub.handlers}
        >
          <line
            x1={BAR_BOX.inset}
            y1={zeroY}
            x2={BAR_BOX.width - BAR_BOX.inset}
            y2={zeroY}
            className="stroke-border"
            strokeWidth={1}
          />

          {bars.map((bar, index) => (
            <rect
              key={`${measured[index]!.index}`}
              // Zero is "landed exactly", which drew a zero-height rectangle and
              // so vanished: two of the six cycles on the seeded history were
              // worth 0 and neither was visible. It is drawn as a stub on the
              // line instead — the value it represents is the line itself.
              x={bar.x}
              y={bar.height === 0 ? zeroY - ZERO_BAR_HEIGHT / 2 : bar.y}
              width={bar.width}
              height={bar.height === 0 ? ZERO_BAR_HEIGHT : bar.height}
              rx={2}
              className={bar.value >= 0 ? 'fill-primary' : 'fill-muted-foreground'}
            />
          ))}

          {scrub.active !== null ? (
            <rect
              x={bars[scrub.active]!.x}
              y={Math.min(bars[scrub.active]!.y, zeroY) - 2}
              width={bars[scrub.active]!.width}
              height={Math.max(bars[scrub.active]!.height, ZERO_BAR_HEIGHT) + 4}
              rx={3}
              className="fill-none stroke-foreground"
              strokeWidth={1.5}
            />
          ) : null}

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

        {/* "on the average" used to be drawn inside the plot, beside the zero
            line, where it landed on the tallest bar. The two colours were also
            never explained anywhere; they are the two directions of the miss. */}
        <ChartKey
          items={[
            { swatch: <span className="inline-block h-0 w-4 border-t border-border" />, label: 'on the average' },
            { swatch: <span className="inline-block size-2 rounded-xs bg-primary" />, label: 'later than predicted' },
            {
              swatch: <span className="inline-block size-2 rounded-xs bg-muted-foreground" />,
              label: 'earlier than predicted',
            },
          ]}
        />
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

  const domain: Domain = paddedDomain(values, 0.15);
  const points = seriesPoints(values, LINE_BOX, domain);
  const scrub = useScrub(points.length, (userX) => nearestIndex(userX, points.map((point) => point.x)));
  const selected = scrub.active === null ? null : (series[scrub.active] ?? null);

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

  const first = points[0]!;
  const last = points[points.length - 1]!;
  const activePoint = scrub.active === null ? null : (points[scrub.active] ?? null);

  return (
    <div className={className}>
      <ChartFrame
        chart="temperature"
        title="Basal temperature"
        finding={finding}
        readout={
          <ScrubLine idle="Tap, hover or use ← → to read a reading.">
            {selected ? `${shortLabel(selected.date)} · ${selected.temperatureC} °C` : undefined}
          </ScrubLine>
        }
      >
        <svg
          ref={scrub.svgRef}
          viewBox={`0 0 ${LINE_BOX.width} ${LINE_BOX.height}`}
          className={PLOT_CLASS}
          fontSize={TICK_SIZE}
          role="img"
          tabIndex={0}
          aria-label={`Basal temperature. ${finding}`}
          {...scrub.handlers}
        >
          <line
            x1={LINE_BOX.inset}
            y1={LINE_BOX.height - LINE_BOX.inset}
            x2={LINE_BOX.width - LINE_BOX.inset}
            y2={LINE_BOX.height - LINE_BOX.inset}
            className="stroke-border"
            strokeWidth={1}
          />
          {activePoint !== null ? (
            <line
              x1={activePoint.x}
              y1={LINE_BOX.inset}
              x2={activePoint.x}
              y2={LINE_BOX.height - LINE_BOX.inset}
              className="stroke-muted-foreground"
              strokeWidth={1}
              strokeDasharray="2 2"
            />
          ) : null}
          <path d={seriesPath(points)} fill="none" className="stroke-primary" strokeWidth={2} />
          {points.map((point) => (
            <circle key={point.index} cx={point.x} cy={point.y} r={2.5} className="fill-primary" />
          ))}
          {activePoint !== null ? (
            <circle
              cx={activePoint.x}
              cy={activePoint.y}
              r={5.5}
              className="fill-none stroke-primary"
              strokeWidth={2}
            />
          ) : null}
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
