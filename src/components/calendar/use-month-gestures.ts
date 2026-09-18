'use client';

/**
 * The month surface's two gestures, and the one rule that tells them apart.
 *
 * The month grid shares a single surface with two orthogonal gestures:
 *
 *   · **Vertical** — the grid's height follows the finger, shrinking the month
 *     down to the one week that holds the selected day (the collapse the old
 *     chevron button used to do), and expanding back to all six.
 *   · **Horizontal** — the whole paging track translates with the finger, and on
 *     release either commits a page or snaps back. Sideways travel moves the
 *     track sideways and nothing else: the two axes never share an offset (see
 *     "One horizontal unit" below).
 *
 * ## The axis rule
 *
 * A gesture commits to an axis on the **first 6px of pointer travel**
 * (`AXIS_LOCK_PX`): whichever of `|dx|` and `|dy|` is larger wins, and the
 * gesture never changes its mind. That is how every native pager decides, and
 * it is the only way the two can share a surface without fighting — a gesture
 * that re-decides halfway reads as broken. Ties (a perfectly diagonal flick)
 * go to horizontal, matching the dominant-looking direction of travel.
 *
 * The lock also keeps the height drag from stealing a vertical scroll and the
 * paging drag from stealing the agenda's list: until the axis is locked we do
 * not capture the pointer and do not call `preventDefault`, and the grid's
 * `touch-action` is `none`, so *touch* pans on this surface belong to the
 * gesture, never to the page.
 *
 * ## The track
 *
 * The pager is a track three viewports wide holding `prev | current | next`, and
 * the current month is the middle panel. Its settled `x` is therefore `-width`,
 * which the renderer writes as `-100% / 3` — the transform React always renders,
 * so the settled DOM can never keep a drag's pixel offset. The gesture only ever
 * moves that one number:
 *
 *     x = -width   current month fills the viewport (settled)
 *     x → 0        the finger dragged right, the previous month comes in
 *     x → -2·width the finger dragged left, the next month comes in
 *
 * Because the neighbour is already painted at the same scale and alignment,
 * there is nothing to fade in on arrival: a committed page slides the rest of
 * the way into place and then re-bases (below), rather than being swapped in
 * behind a transition. The slide is cross-faded on top of that movement — see
 * "The cross-fade" below.
 *
 * ## One horizontal unit: the month
 *
 * A horizontal drag means one thing, and it means it on both shapes of the grid:
 * **the track moves sideways by one page, and a page is one month.** Expanded,
 * that is the six-week lattice sliding to the month either side. Collapsed, it is
 * the *same* slide: the clip is one week tall, but all three panels are still the
 * full lattice, so the neighbouring month's identical week row is already painted
 * beside the current one and simply slides in. One page is therefore the clip's
 * width at pointerdown whether or not the grid is collapsed, and a committed
 * swipe always reports a month delta through `onPage`.
 *
 * That is the fix for the gesture that used to read as vertical. A collapsed drag
 * once rolled the strip *down* one row — a seven-day step — 1:1 with the finger,
 * so a sideways swipe slid the whole lattice up or down the screen, and the
 * further the finger travelled sideways the further the numbers travelled
 * vertically. A horizontal finger may move things horizontally and nothing else;
 * the vertical axis belongs to the height drag alone. Nothing else about the
 * gesture changed: the same 1:1 tracking, the same 40%-or-a-flick commit rule,
 * the same live title and the same selection frozen until the release.
 *
 * What the roll used to reach — the adjacent week — is still reachable where it
 * belongs: the arrow keys move the selection a week, and dragging down expands
 * the month again.
 *
 * The month title follows the finger in both shapes now, for the same reason:
 * the month under the finger is the month the grid is showing, collapsed or not.

 * ## The cross-fade
 *
 * The outgoing month fades out as the incoming one fades in, on top of the
 * slide. That fade is *scrubbed by the finger* — its opacity is a function of
 * how far the drag has carried the track — so it is painted by the same `paint()`
 * that moves the track, and the panels' settled opacity is what the renderer
 * shows at rest. A one-shot enter/exit keyframe (which is what
 * `tw-animate-css`'s `fade-in`/`fade-out` are) cannot follow a pointer, which is
 * why the fade shares the movement's mechanism instead of being an animation
 * played on top of it.
 *
 * Each panel's opacity is its distance from the centre of the viewport, measured
 * in pages: the settled month is at 1, a full page away is at 0, and halfway
 * through a drag both are at 0.5. That holds collapsed too — there the fade
 * plays on the one visible row of each panel.

 * The gesture also *reports* which page is centred (`onPagePreview`), so the
 * toolbar's month name can follow the finger: a title that still named the old
 * month while the new month's numbers slid past would be the same lie as the
 * grid appearing out of nowhere. Only the title follows; the selection and the
 * agenda below it move on commit, never mid-drag.
 *
 * ## Why the values are written to the DOM directly
 *
 * The track must follow the pointer frame by frame, not jump to a snapped value
 * through a CSS transition. So the drag writes `height` (the viewport) and
 * `transform` (the track) straight to the two nodes; React only re-renders once,
 * when the gesture settles, and renders exactly the value the settle already
 * painted. A CSS transition is never involved — the release "animation" is a
 * short rAF tween under our own easing.
 *
 * ## Paging threshold
 *
 * A page commits when the drag crossed 40% of the grid's width **or** the
 * release velocity exceeded 0.5px/ms over at least 30px of travel; otherwise
 * the lattice springs back. Distance alone makes a slow drag feel unresponsive,
 * and velocity alone lets a two-sample twitch page — a long flick needs neither
 * to be big nor to be fast, but it does need to be a flick.
 *
 * A committed page first finishes sliding (the tween the finger was in the
 * middle of) and only then hands the new month to `onPage`. The caller
 * re-renders the track keyed on the page, which re-applies the settled `-100%/3`
 * base in the same frame the new panels arrive — so the month the user dragged
 * to is the one already on screen, and neither axis accumulates an offset.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { MONTH_ROWS, clamp } from './geometry';
import type { CalendarInteraction } from './types';

/**
 * One week row's height, in px.
 *
 * The month is a fixed six of these: the server always pads the window to six
 * whole weeks, so the expanded height can never change between months and the
 * collapse maths needs no measuring.
 */
export const MONTH_ROW_PX = 36;
export const MONTH_EXPANDED_PX = MONTH_ROWS * MONTH_ROW_PX;
export const MONTH_COLLAPSED_PX = MONTH_ROW_PX;

/** Pointer travel (px) before the gesture commits to an axis. */
export const AXIS_LOCK_PX = 6;

/** Fraction of the grid's width a horizontal drag must cross to page. */
const PAGE_COMMIT_FRACTION = 0.4;

/** Release speed (px/ms) at or above which a long-enough flick commits a page. */
const PAGE_FLICK_VELOCITY = 0.5;

/**
 * Travel (px) a flick still needs before it may commit on speed alone.
 *
 * Velocity is read from the pointer samples, so a tiny twitch between two
 * events can look fast; without a floor, a flick was paging on a 10px move.
 */
const PAGE_FLICK_MIN_PX = 30;

/** Duration of the release settle. */
const SETTLE_MS = 220;

type Axis = 'x' | 'y';

interface Session {
  pointerId: number;
  startX: number;
  startY: number;
  /** `null` until the first slop decides the whole gesture's axis. */
  axis: Axis | null;
  /** Viewport height when the gesture began. */
  startHeight: number;
  /** Track `x` when the gesture began — its settled base in practice. */
  startTranslateX: number;
  /** Viewport width when the gesture began: one page, and the drag's clamp. */
  width: number;
  lastX: number;
  lastY: number;
  lastT: number;
  velocityX: number;
  velocityY: number;
}

export interface MonthGestureOptions {
  /**
   * Pages the period: `-1` the previous month, `+1` the next. Called by a
   * committed swipe in both shapes of the grid — see "One horizontal unit".
   */
  onPage: (delta: number) => void;
  /**
   * Retained, **never called**.
   *
   * A collapsed page used to be one *week* — a vertical roll of the strip — and
   * that roll is exactly the motion that made a horizontal swipe read as
   * vertical, so the collapsed page is a month now and a committed swipe goes to
   * `onPage` in both shapes (see "One horizontal unit"). The option stays
   * declared, and ignored, only because `MonthGrid` still passes it and an
   * optional property that the type does not declare is excess-property error;
   * it disappears from here once `MonthGrid` drops the handler.
   */
  onPageWeek?: (delta: 1 | -1) => void;
  /**
   * The month the drag is currently showing, as a page delta from the anchor.
   *
   * Called while the finger is down, the moment the offset puts a different
   * panel at the centre of the viewport — the title is a label for the thing
   * under the finger, so it cannot wait for the release. `0` means the anchor's
   * own month is centred again.
   */
  onPagePreview?: (delta: -1 | 0 | 1) => void;
  /** Row index (0-based) that holds the selected day. */
  focusRow: number;
  /** Shared gesture flags, so an item drag stops the surface gesture. */
  interaction: CalendarInteraction;
}

export interface MonthGestures {
  /** True when the grid is settled on the one-week strip. */
  collapsed: boolean;
  /** Settled viewport height the renderer must apply. */
  viewportHeight: number;
  /** Settled vertical offset of the lattice, in px (negative when collapsed). */
  contentOffsetY: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  /** The three-month paging track: the node the horizontal offset lives on. */
  trackRef: React.RefObject<HTMLDivElement | null>;
  /** Collapses or expands, keyboard- and click-reachable. */
  toggle: () => void;
  /** Spread onto the element that owns the whole month surface. */
  handlers: {
    onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => void;
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  };
}

export function useMonthGestures({
  onPage,
  onPagePreview,
  focusRow,
  interaction,
}: MonthGestureOptions): MonthGestures {
  const [collapsed, setCollapsed] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<Session | null>(null);
  /** Set when a drag ends, so the click that follows it cannot select a day. */
  const suppressClickRef = useRef(false);
  const heightRef = useRef(MONTH_EXPANDED_PX);
  const translateRef = useRef(0);
  /** The last measured page width, so `paint` can place the cross-fade. */
  const pageWidthRef = useRef(0);
  /** The page delta last announced to `onPagePreview`, so it is only called on change. */
  const previewRef = useRef<-1 | 0 | 1>(0);
  const frameRef = useRef<number | null>(null);

  // Read through a ref so the pointer handlers never close over stale props.
  const optionsRef = useRef({ onPage, onPagePreview, focusRow });
  optionsRef.current = { onPage, onPagePreview, focusRow };

  /**
   * Which month the drag is showing: the panel holding the viewport's centre.
   *
   * Half a page is where the boundary between two panels crosses the centre of
   * the screen, so that is the instant the incoming month becomes the one on
   * screen — and therefore the one the title should name.
   */
  const previewPage = useCallback((travel: number, width: number) => {
    const next: -1 | 0 | 1 = travel <= -width / 2 ? 1 : travel >= width / 2 ? -1 : 0;
    if (previewRef.current === next) return;
    previewRef.current = next;
    optionsRef.current.onPagePreview?.(next);
  }, []);

  const stopFrame = useCallback(() => {
    if (frameRef.current !== null) {
      window.cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
    }
  }, []);

  useEffect(() => stopFrame, [stopFrame]);

  /** One page, measured rather than assumed: the track is three of these wide. */
  const pageWidth = useCallback(() => {
    const width = viewportRef.current?.getBoundingClientRect().width ?? 0;
    if (width > 0) pageWidthRef.current = width;
    return width;
  }, []);

  /**
   * The cross-fade: how opaque each page of the track is, by distance from the
   * centre of the viewport, measured in pages.
   *
   * At rest the track sits at `x = -width`, so page 1 (the current one) is at
   * distance 0 and therefore opaque, and the two neighbours are a full page away
   * and therefore invisible. As the finger carries the track, the incoming page
   * closes that distance and fades in while the outgoing one opens it and fades
   * out — both at 0.5 halfway through a drag. Painted on the *panel*, so the
   * sliding content is what fades, never the surface around it.
   */
  const paintFade = useCallback((track: HTMLElement, translateX: number) => {
    const width = pageWidthRef.current;
    if (width <= 0) return;
    const panels = track.children;
    for (let index = 0; index < panels.length; index += 1) {
      const page = panels[index] as HTMLElement;
      const opacity = clamp(1 - Math.abs(index * width + translateX) / width, 0, 1);
      page.style.opacity = opacity.toFixed(3);
    }
  }, []);

  /**
   * Writes the live height, horizontal offset and page cross-fade.
   *
   * The vertical offset is derived from the height alone, so the strip always
   * lands on the selected week: at full height the track is unmoved, and as it
   * collapses the track slides up by `focusRow` rows. Height is written by the
   * vertical drag and by nothing else — a horizontal drag repaints the height it
   * started with, which is what keeps the two axes from coupling. It is the
   * *track* that moves, so all three months stay aligned with each other while
   * the finger is down.
   */
  const paint = useCallback(
    (height: number, translateX: number) => {
      heightRef.current = height;
      translateRef.current = translateX;

      const viewport = viewportRef.current;
      if (viewport) viewport.style.height = `${height}px`;

      const track = trackRef.current;
      if (!track) return;
      const span = MONTH_EXPANDED_PX - MONTH_COLLAPSED_PX;
      const progress = span > 0 ? clamp((MONTH_EXPANDED_PX - height) / span, 0, 1) : 0;
      const focusRow = optionsRef.current.focusRow;
      const offsetY = -focusRow * MONTH_ROW_PX * progress;
      track.style.transform = `translate3d(${translateX.toFixed(1)}px, ${offsetY.toFixed(1)}px, 0)`;
      paintFade(track, translateX);
    },
    [paintFade],
  );

  /**
   * Short rAF tween to a settled height and horizontal offset.
   *
   * `onDone` runs after the final paint, which is what lets a committed page
   * finish its slide before the caller swaps in the new month — and, because the
   * final paint is the last thing written to the DOM before the re-render, the
   * swap is invisible.
   */
  const settle = useCallback(
    (toHeight: number, toTranslateX: number, onDone?: () => void) => {
      stopFrame();
      const fromHeight = heightRef.current;
      const fromX = translateRef.current;
      const height = clamp(toHeight, MONTH_COLLAPSED_PX, MONTH_EXPANDED_PX);
      const next = height === MONTH_COLLAPSED_PX;

      const finish = () => {
        frameRef.current = null;
        paint(height, toTranslateX);
        setCollapsed((current) => (current === next ? current : next));
        onDone?.();
      };

      const reduced =
        typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (reduced || (fromHeight === height && fromX === toTranslateX)) {
        finish();
        return;
      }

      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / SETTLE_MS);
        const eased = 1 - (1 - t) ** 3;
        paint(fromHeight + (height - fromHeight) * eased, fromX + (toTranslateX - fromX) * eased);
        if (t < 1) frameRef.current = window.requestAnimationFrame(step);
        else finish();
      };
      frameRef.current = window.requestAnimationFrame(step);
    },
    [paint, stopFrame],
  );

  /**
   * A resize changes what "one page" is, so the settled base is re-measured
   * rather than left at the previous width's pixel value.
   */
  useEffect(() => {
    const onResize = () => {
      if (sessionRef.current) return;
      const width = pageWidth();
      if (width > 0) paint(heightRef.current, -width);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paint, pageWidth]);

  const toggle = useCallback(() => {
    settle(collapsed ? MONTH_EXPANDED_PX : MONTH_COLLAPSED_PX, -pageWidth());
  }, [collapsed, pageWidth, settle]);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      // A new press always abandons the previous gesture: a tap-release outside
      // the surface never delivers a pointerup here.
      sessionRef.current = null;
      suppressClickRef.current = false;
      if (interaction.dragging) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if ((event.target as HTMLElement | null)?.closest('[data-item-block]')) return;

      const viewport = viewportRef.current;
      if (!viewport) return;
      stopFrame();

      const rect = viewport.getBoundingClientRect();
      // Re-base before tracking: a committed page remounts the track at its
      // settled offset and a resize moves that offset, so the gesture starts
      // from the measured centre instead of the last painted pixel value.
      pageWidthRef.current = rect.width;
      paint(rect.height, -rect.width);
      previewPage(0, rect.width);
      sessionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        axis: null,
        startHeight: rect.height,
        startTranslateX: -rect.width,
        width: rect.width,
        lastX: event.clientX,
        lastY: event.clientY,
        lastT: event.timeStamp,
        velocityX: 0,
        velocityY: 0,
      };
    },
    [interaction, paint, stopFrame],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      const dx = event.clientX - session.startX;
      const dy = event.clientY - session.startY;

      if (!session.axis) {
        if (Math.hypot(dx, dy) < AXIS_LOCK_PX) return;
        session.axis = Math.abs(dx) >= Math.abs(dy) ? 'x' : 'y';
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* Best effort: the window keeps delivering either way. */
        }
      }

      const dt = Math.max(1, event.timeStamp - session.lastT);
      session.velocityX = (event.clientX - session.lastX) / dt;
      session.velocityY = (event.clientY - session.lastY) / dt;
      session.lastX = event.clientX;
      session.lastY = event.clientY;
      session.lastT = event.timeStamp;

      if (session.axis === 'y') {
        // Down is positive: the bottom edge moves with the finger, so the
        // height grows by exactly the travel and the strip follows it. The
        // track keeps whatever horizontal position it was settled on.
        paint(clamp(session.startHeight + dy, MONTH_COLLAPSED_PX, MONTH_EXPANDED_PX), translateRef.current);
      } else {
        /*
         * The track moves with the finger, 1:1. A page is one viewport width in
         * both shapes — collapsed, the neighbouring month's identical week row
         * is already painted beside this one — which is also the clamp: there is
         * no month beyond the two neighbours the track holds. The height is the
         * one the gesture found, untouched: a sideways finger writes no vertical
         * offset. The title follows the same number.
         */
        const x = clamp(session.startTranslateX + dx, -2 * session.width, 0);
        paint(heightRef.current, x);
        previewPage(x + session.width, session.width);
      }
      event.preventDefault();
    },
    [paint],
  );

  const endSession = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      sessionRef.current = null;

      try {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
      } catch {
        /* The pointer is already gone. */
      }

      if (!session.axis) return;
      // The click the browser fires after a drag must not select a day or open
      // an item; the capture handler on the surface eats it.
      suppressClickRef.current = true;

      if (session.axis === 'y') {
        const middle = (MONTH_EXPANDED_PX + MONTH_COLLAPSED_PX) / 2;
        const travelled = Math.abs(heightRef.current - session.startHeight);
        const flick = Math.abs(session.velocityY) > PAGE_FLICK_VELOCITY && travelled > PAGE_FLICK_MIN_PX;
        const target =
          flick && !cancelled
            ? session.velocityY < 0
              ? MONTH_COLLAPSED_PX
              : MONTH_EXPANDED_PX
            : heightRef.current > middle
              ? MONTH_EXPANDED_PX
              : MONTH_COLLAPSED_PX;
        settle(target, -session.width);
        return;
      }

      /*
       * How far the finger carried the pager off its settled base, in px, and how
       * far one page of travel is: one clip width, collapsed or not, because a
       * page is a month in both shapes (see "One horizontal unit"). The commit
       * rule is unchanged — 40% of a page, or a flick that carried at least
       * `PAGE_FLICK_MIN_PX`.
       *
       * Negative travel is a leftward drag: the next month.
       */
      const travel = translateRef.current + session.width;
      const flicked = Math.abs(session.velocityX) > PAGE_FLICK_VELOCITY && Math.abs(travel) > PAGE_FLICK_MIN_PX;
      const crossed = Math.abs(travel) > session.width * PAGE_COMMIT_FRACTION;

      if (!cancelled && (crossed || flicked)) {
        const delta = travel < 0 ? 1 : -1;
        // Slide the incoming month the rest of the way in, then re-render with it
        // as the middle panel. The caller's remount re-applies the settled base,
        // so the pixel offset never survives the page — and the preview resets in
        // the same commit, so the title cannot flicker back. Collapsed, that
        // remount is also what moves the strip onto the new month's week row.
        settle(heightRef.current, delta > 0 ? -2 * session.width : 0, () => {
          optionsRef.current.onPage(delta);
          previewPage(0, session.width);
        });
        return;
      }
      // A drag that ends under the halfway point never changed the title; one
      // abandoned past it (a cancelled gesture) gets it put back.
      previewPage(0, session.width);
      settle(heightRef.current, -session.width);
    },
    [previewPage, settle],
  );

  const handlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => endSession(event, false),
    onPointerCancel: (event: ReactPointerEvent<HTMLDivElement>) => endSession(event, true),
    onClickCapture: (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!suppressClickRef.current) return;
      suppressClickRef.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return {
    collapsed,
    viewportHeight: collapsed ? MONTH_COLLAPSED_PX : MONTH_EXPANDED_PX,
    contentOffsetY: collapsed ? -focusRow * MONTH_ROW_PX : 0,
    viewportRef,
    trackRef,
    toggle,
    handlers,
  };
}
