'use client';

/**
 * The signature list row.
 *
 * Leading edge: a shadcn `Checkbox` inside its own 44px touch target. Body: a
 * button whose first line carries the title, the pin and the trailing due date,
 * and whose second line is the derived meta (`TaskMeta`). Behind the row a
 * swipe-left reveals Complete, Pin/Unpin and Delete. A long press either lifts
 * the row for reordering (on touch) or — on a pointer that can hover — right-click opens a
 * shadcn `ContextMenu` of the extra actions; never both, so a finger drag is
 * never mistaken for a context menu.
 *
 * ## The completion beat, and why the row now folds out instead of vanishing
 *
 * Ticking a task moves it out of this section in the same commit — `visibleTasks`
 * filters completed work out of `/tasks`, and the Today agenda moves the row into
 * its "Completed today" bucket — so the row used to blink out of existence with
 * no transition at all, and the rows below it jumped up by its height. The row's
 * own `exit` transition is what fixes that: its height animates to zero as it
 * fades, so the list closes the gap *continuously* rather than after the fact (a
 * plain fade would only postpone the jump). No `layout` animation is involved on
 * purpose — animating the collapsing height moves the siblings for free, where
 * `layout` would put a measured transform on every row in the list and re-measure
 * them all on every frame of the animation.
 *
 * `AnimatePresence` lives in `TaskListSection`, around the task rows of one
 * section's `<ul>`, so a row removed from the data stays mounted for the length
 * of this exit. That placement is what copes with the section move: a row leaving
 * this section animates out *here* while the same task, as a new row in another
 * section's list, animates in there — one `AnimatePresence` per section, no
 * shared-element trickery across two cards, and the section's count and the
 * row's own leaving animation are decided in the same commit.
 *
 * Three cases are deliberately distinguished:
 *
 *  - **A one-off completion** gets the whole beat: the checkbox pop (below),
 *    a 3% shrink and the fold. That is the "finished" animation.
 *  - **A recurring task gets no beat.** Ticking one does not finish it — the
 *    series rolls forward to its next occurrence, and the row it will occupy on
 *    that date is not this row. So it is not given a completion animation at
 *    all: no pop, no shrink, just the fold that closes the gap.
 *  - **Anything else that removes a row** (a swipe-Delete, a filter that no
 *    longer matches) folds out the same way, with no completion beat — it is a
 *    row leaving, not a task finishing.
 *
 * The return path is `AnimatePresence`'s own: a task that comes back inside the
 * Undo window is re-added under the same key, which cancels the exit mid-flight
 * and animates the row back to its resting height — so a complete-then-undo
 * gesture never fights the departure it interrupted.
 *
 * ## The press highlight is a region, not the button
 *
 * The hover/press accent used to be painted by the content button itself, so it
 * covered the button's whole 44px-tall, nearly-full-width box — a slab rather
 * than a highlight. The affordance is now an `aria-hidden` span positioned
 * inside that button (`inset-x-1.5 inset-y-1`), so it is 12px narrower and 8px
 * shorter than before while the button keeps its `min-h-11` 44px touch target
 * untouched. The span is driven by the button's own `group/row-content` state
 * (`group-hover`/`group-active`), so hover on a pointer and press on a finger
 * both still light it up.
 *
 * ## The swipe reveals as it goes
 *
 * The action trio used to sit parked outside the card until a release decided
 * the swipe, so a drag moved the row over the bare card and the buttons were
 * painted in afterwards. The trio now rides the same `offsetX` the row does —
 * `translateX(SWIPE_ACTION_WIDTH + offsetX)` — so all three move 1:1 with the
 * finger from the first pixel past the axis lock and the buttons are on screen
 * for the whole drag. Release snapshots the same way it always did: past half
 * the trio's width it settles open, otherwise it snaps back, and the 200ms
 * transition is disabled only while the finger is down.
 *
 * The Pin/Unpin action is the third of those buttons, between Complete and the
 * destructive Delete. Its label tracks the task: it reads "Pin" while the task
 * is loose and "Unpin" once it is pinned, so the same gesture both does and
 * undoes the pin.
 *
 * The long-press lift and the horizontal swipe still share the row without
 * fighting: the axis lock at `GESTURE_SLOP_PX` decides once, a vertical gesture
 * hands the row back to the scroller, and the lift keeps the pointer captured.
 *
 * ## The pin marker is on the section header now
 *
 * A pinned task used to carry a pin glyph beside its title. It was one glyph per
 * row saying the same thing every time, so it moved to the "Pinned" section
 * header, where it is stated once (see `TaskListSection`). What stays on the row
 * is the accessible half: an `sr-only` "Pinned", placed *outside* the `Open …`
 * button because that button's `aria-label` overrides its contents in the
 * accessible-name computation — a marker inside it would be announced to nobody.
 * A pinned row is therefore still identifiable to a screen reader without the
 * glyph, and the swipe/context actions still name themselves Pin/Unpin.
 *
 * ## The list colour
 *
 * The section used to paint a 4px coloured stripe down its leading edge, then a
 * single dot in the section header. The stripe is back, but per row and on the
 * row's own leading edge: the colour belongs to the task you are looking at, not
 * to the group it happens to sit in, and it is the thing the eye uses to scan a
 * mixed list. The header dot is gone, so the two do not repeat each other — see
 * `TaskListSection`. The strip is a positioned span rather than a left border so
 * the text keeps the section header's axis.
 *
 * ## The drag grip
 *
 * A grip is only drawn where a pointer can actually use it. Which input the
 * device has is a capability question, not a width one, so this is a
 * `(hover: hover) and (pointer: fine)` test rather than a breakpoint.
 * Long-press-to-lift still works on touch because that path is driven by
 * `pointerType`, not by the grip, and the full-screen action sheet is on a
 * `ContextMenu` that is only mounted for a pointer that can open it — otherwise
 * Radix's own touch long-press would race this row's lift.
 */
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { motion } from 'framer-motion';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { CrossCircledIcon } from '@svg-animated-icons/react/cross-circled';
import { DragHandleDots1Icon } from '@svg-animated-icons/react/drag-handle-dots-1';
import { DrawingPinIcon } from '@svg-animated-icons/react/drawing-pin';
import { SewingPinIcon } from '@svg-animated-icons/react/sewing-pin';
import { useMediaQuery } from '@/lib/store';
import { accentHex } from '@/lib/colors';
import { useReducedMotion } from '@/lib/motion';
import type { AccentColor, Task } from '@/lib/types';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { DueDateLabel, TaskMeta } from './TaskMeta';

/** Width of the revealed Complete + Pin/Unpin + Delete trio (3 × 76px, i.e. `w-57`). */
export const SWIPE_ACTION_WIDTH = 228;
/** How long a press must last before it lifts the row. */
const LONG_PRESS_MS = 550;
/** Movement that cancels a long press and decides the gesture axis. */
const GESTURE_SLOP_PX = 8;
/** True only on a device whose primary input can hover and point precisely. */
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/**
 * How long a row takes to fold out of the list, in seconds.
 *
 * Short on purpose: it is the slot between the tap and the list settling, and the
 * user is usually already looking at the next row. The curve is the same
 * `cubic-bezier(0.32, 0.72, 0, 1)` the swipe settle uses, so a row leaving and a
 * swipe snapping back move with one another.
 */
const ROW_EXIT_SECONDS = 0.24;
/** The ease the row leaves and returns on — the swipe's own settle curve. */
const ROW_EASE = [0.32, 0.72, 0, 1] as const;

/** Reorder wiring, supplied by `TaskListSection`. */
export interface TaskRowDrag {
  draggable: boolean;
  isLifted: boolean;
  /** Vertical offset of the lifted row, so it follows the finger. */
  liftOffset: number;
  /** Where the drop indicator is drawn for this row. */
  dropEdge: 'before' | 'after' | null;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onLiftStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onLiftMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onLiftEnd: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface TaskRowProps {
  task: Task;
  zone: string;
  timeFormat: '12h' | '24h';
  /** Ticks the task off, or un-ticks it when it is already done. */
  onToggle: (task: Task) => void;
  /** The list's colour, drawn as the strip on the row's leading edge. */
  accent?: AccentColor | null;
  /** Opens the task's detail sheet. */
  onOpen: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onWontDo?: (task: Task) => void;
  /** Pins the task to the top of the list, or unpins it when already pinned. */
  onPin?: (task: Task) => void;
  /** Writes are unavailable (offline). */
  disabled?: boolean;
  drag?: TaskRowDrag | null;
  /** Rounds the bottom corner of the last row, so its strip follows the card. */
  last?: boolean;
  /** Squares the top of the first row's press region (it is not at a corner). */
  first?: boolean;
  /**
   * The row is outside the Today section, so its trailing label is the date
   * rather than a clock time. The section knows this; the row does not (see
   * `TaskListSection`).
   */
  showDate?: boolean;
  className?: string;
  ref?: Ref<HTMLLIElement>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function TaskRow({
  task,
  zone,
  timeFormat,
  onToggle,
  accent,
  onOpen,
  onDelete,
  onWontDo,
  onPin,
  disabled = false,
  drag,
  last = false,
  first = false,
  showDate = false,
  className,
  ref,
}: TaskRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  /**
   * True while a horizontal drag is being tracked, so both the row and the
   * action pair paint the finger's position with no transition in the way.
   */
  const [swiping, setSwiping] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const gesture = useRef({ x: 0, y: 0, active: false, axis: null as null | 'x' | 'y', timer: 0, lifted: false });

  const reduceMotion = useReducedMotion();
  const completed = task.status === 'completed';
  const wontDo = task.status === 'wont_do';
  const draggable = Boolean(drag?.draggable) && !disabled;
  // Resolved after hydration, so touch never flashes a grip it cannot use.
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const gripVisible = draggable && finePointer;

  // The pop needs to end, or the next render keeps the row mid-animation.
  useEffect(() => {
    if (!justCompleted) return;
    const timer = window.setTimeout(() => setJustCompleted(false), 320);
    return () => window.clearTimeout(timer);
  }, [justCompleted]);

  // A press that outlives the component must not touch a detached node.
  useEffect(() => () => window.clearTimeout(gesture.current.timer), []);

  // A click anywhere else, or a scroll, puts the revealed actions away.
  useEffect(() => {
    if (!revealed) return;
    const close = () => closeReveal();
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [revealed]);

  function closeReveal() {
    setRevealed(false);
    setOffsetX(0);
    setSwiping(false);
  }

  function cancelLongPress() {
    if (gesture.current.timer) {
      window.clearTimeout(gesture.current.timer);
      gesture.current.timer = 0;
    }
  }

  function toggle() {
    if (disabled) return;
    /*
     * The pop is the "task finished" beat, so a recurring task does not get it:
     * its tick rolls the series forward to the next occurrence rather than
     * completing anything (see the file doc, and `TasksView`/`TodayView`, which
     * suppress the Undo for the same reason).
     */
    if (!completed && !task.recurrenceRule) setJustCompleted(true);
    onToggle(task);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled) return;
    if (revealed) {
      closeReveal();
      return;
    }
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    const state = gesture.current;
    state.x = event.clientX;
    state.y = event.clientY;
    state.active = true;
    state.axis = null;
    state.lifted = false;
    state.timer = 0;

    if (!draggable || !drag) return;
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      // The extra actions are the pointer's long press and live on the
      // `ContextMenu` above; this timer is the touch lift only.
      if (event.pointerType === 'mouse') return;
      state.lifted = true;
      contentRef.current?.setPointerCapture(event.pointerId);
      drag.onLiftStart(event);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (!state.active) return;

    if (state.lifted) {
      drag?.onLiftMove(event);
      return;
    }

    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;

    if (state.axis === null) {
      if (Math.abs(dx) < GESTURE_SLOP_PX && Math.abs(dy) < GESTURE_SLOP_PX) return;
      state.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      cancelLongPress();
      if (state.axis === 'y') {
        // The user is scrolling the list, not the row.
        state.active = false;
        return;
      }
      contentRef.current?.setPointerCapture(event.pointerId);
    }

    if (state.axis === 'x') {
      const base = revealed ? -SWIPE_ACTION_WIDTH : 0;
      setSwiping(true);
      setOffsetX(clamp(base + dx, -SWIPE_ACTION_WIDTH, 0));
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    cancelLongPress();

    if (state.lifted) {
      state.active = false;
      state.lifted = false;
      drag?.onLiftEnd(event);
      return;
    }

    if (state.axis === 'x') {
      const open = offsetX <= -SWIPE_ACTION_WIDTH / 2;
      setRevealed(open);
      setOffsetX(open ? -SWIPE_ACTION_WIDTH : 0);
      setSwiping(false);
    }

    state.active = false;
    state.axis = null;
  }

  const lifted = Boolean(drag?.isLifted);

  /*
   * The row's own presence animation, as props on the `<li>`.
   *
   * This is only ever played by the `AnimatePresence` in `TaskListSection`: a row
   * that mounts into a section the presence wrapper has already seen (the same
   * task arriving in "Completed today", or coming back from an Undo) grows in from
   * zero height, and one that leaves folds to zero. Rows present at that
   * wrapper's first render — every row on a tab switch — are suppressed by its
   * `initial={false}`, so a list still paints in one frame rather than drawing
   * itself row by row.
   *
   * Under the app's motion preference the row is simply there and simply gone:
   * `initial={false}`, a zero-duration exit. The global clamp in `globals.css`
   * only covers the OS query, so this component has to honour the in-app setting
   * itself, which is why the decision comes from `@/lib/motion`.
   */
  const presence = reduceMotion
    ? {
        initial: false as const,
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: { duration: 0 } },
        transition: { duration: 0 },
      }
    : {
        initial: { opacity: 0, height: 0 },
        animate: { opacity: 1, height: 'auto' as const },
        exit: {
          opacity: 0,
          height: 0,
          // Only a task that actually finished shrinks as it goes. A recurring
          // task that rolled forward — or any other row being removed — folds
          // away without the completion flourish.
          ...(task.recurrenceRule ? {} : { scale: 0.97 }),
          transition: {
            height: { duration: ROW_EXIT_SECONDS, ease: ROW_EASE },
            opacity: { duration: ROW_EXIT_SECONDS * 0.6, ease: 'easeIn' as const },
            scale: { duration: ROW_EXIT_SECONDS, ease: 'easeIn' as const },
          },
        },
        // The return path (and the arrival path): the same curve, no overshoot,
        // so a row coming back from an Undo does not bounce into place.
        transition: { duration: ROW_EXIT_SECONDS, ease: ROW_EASE },
      };

  const row = (
    <div
      ref={contentRef}
      onDragOver={(event) => drag?.onDragOver(event)}
      onDrop={(event) => drag?.onDrop(event)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        transform: `translate(${offsetX}px, ${lifted ? (drag?.liftOffset ?? 0) : 0}px)`,
        transition: swiping || lifted ? 'none' : 'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)',
        touchAction: 'pan-y',
      }}
      className={cn(
        // No background of its own: the card is the surface, so a translucent
        // one reads as a single grouped list rather than N white slices. The
        // lifted row needs its own solid paint, since it travels over others.
        'relative z-10 flex min-h-11 w-full items-center gap-1 pl-row pr-1.5',
        lifted && 'z-20 bg-card shadow-xl',
        disabled && 'opacity-60',
      )}
    >
      {/*
       * The list's colour, as a 4px strip on the row's own leading edge. It is
       * a positioned span rather than a left border so it never shifts the text
       * axis off the section header's (see `TaskListSection`), and it sits
       * inside the row so the swipe/lift transform carries it along.
       */}
      {accent ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 w-1"
          style={{ backgroundColor: accentHex(accent) }}
        />
      ) : null}

      <motion.span
        className="-ml-3 grid size-11 shrink-0 place-items-center"
        animate={justCompleted && !reduceMotion ? { scale: [0.82, 1.12, 1] } : { scale: 1 }}
        transition={{ duration: 0.32, ease: 'easeInOut' }}
      >
        <Checkbox
          checked={wontDo && !completed ? 'indeterminate' : completed}
          disabled={disabled}
          aria-label={completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}
          // The native `indeterminate` state is announced as mixed, but the
          // explicit attribute is what the old row exposed; keep it.
          aria-checked={completed ? true : wontDo ? 'mixed' : false}
          onCheckedChange={toggle}
          // `size-5` is 20px, the title's `text-base leading-tight` line box, so
          // the tick and the words it ticks are the same height.
          className={cn('size-5 border-foreground/25', wontDo && !completed && 'opacity-60')}
        />
      </motion.span>

      <button
        type="button"
        onClick={() => {
          if (disabled) return;
          // A tap on a swiped-open row just puts the actions away, the way iOS does.
          if (revealed) {
            closeReveal();
            return;
          }
          onOpen(task);
        }}
        aria-label={`Open ${task.title}`}
        // `-ml-2` cancels the 4px track gap and the button's own 4px left
        // padding, so the title begins 12px from the checkbox glyph — the same
        // 12px that separates the glyph from the colour strip. Without it the
        // title sat 20px out, the wide gap the row was reported for.
        className="group/row-content relative -ml-2 flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/*
         * The press/hover highlight, inset inside the button rather than
         * painted by it, so it reads as a region and not a slab. The button
         * keeps its own 44px box, and the children below are positioned so they
         * paint (and hit-test) over this layer.
         *
         * On the first row the highlight squares off its top edge
         * (`rounded-t-none`). Rounding only the left corners would leave the
         * shape lopsided — square top-left against round top-right and
         * bottom-left — whereas squaring the whole top edge reads as a band
         * that begins flush with the section's top, the grouped-list treatment.
         */}
        <span
          aria-hidden
          className={cn(
            // The press accent is suppressed during a swipe: a drag is a gesture,
            // not a press, and the highlight firing under the finger read as the
            // row being selected.
            'pointer-events-none absolute inset-x-1.5 inset-y-1 rounded-md bg-accent/0 transition-colors group-hover/row-content:bg-accent/30',
            !swiping && 'group-active/row-content:bg-accent/50',
            first && 'rounded-t-none',
          )}
        />
        {/*
         * The title, with the due date pinned to the row's trailing edge.
         *
         * The title is one line, ellipsised. It briefly wrapped, on the
         * argument that a task list is where you read what the task is and
         * cutting the one word that distinguishes two similar tasks ("Reply to
         * the design re…") defeats the point. That is overruled here: `truncate`
         * is the deliberate treatment, because a stable, short row is what keeps
         * a long list scannable, and a title that wraps makes rows different
         * heights and drops the due date out of line. The date does not shrink;
         * the title takes whatever width is left and ellipsises rather than
         * pushing it away.
         *
         * The content column and the due date are the button's two children, so
         * the date is centred against the *row* rather than against the title.
         * Inside the title's own row it could only ever be centred against the
         * title: on a row whose title is one line while its meta line makes the
         * row two, the date's own centre sat ~10px above the row's. Measured
         * after: 0.0px against the row on both shapes.
         */}
        <span className="relative flex min-w-0 flex-1 flex-col items-stretch gap-0">
          <span className="relative flex w-full min-w-0 items-center gap-x-1">
            <span
              className={cn(
                'min-w-0 flex-1 truncate text-base leading-tight',
                completed && 'text-muted-foreground line-through',
                wontDo && 'text-muted-foreground/70 line-through',
              )}
            >
              {task.title}
            </span>
          </span>
          <TaskMeta task={task} className="relative" />
        </span>
        <DueDateLabel
          task={task}
          zone={zone}
          timeFormat={timeFormat}
          showDate={showDate}
          className="shrink-0 self-center"
        />
      </button>

      {/*
       * The pin marker as text, not the glyph: the glyph now lives once, on the
       * "Pinned" section header (see `TaskListSection`), while this keeps a
       * pinned row identifiable to a screen reader. It is deliberately outside
       * the `Open …` button — that button's `aria-label` overrides its contents
       * in the accessible-name computation, so a marker inside it is announced
       * to nobody; out here it is exposed in reading order.
       */}
      {task.isPinned ? <span className="sr-only">Pinned</span> : null}

      {gripVisible ? (
        // The grip is the pointer drag handle: keeping the HTML5 drag here and
        // not on the whole row leaves the row free for the swipe gesture.
        <span
          draggable
          onDragStart={(event: DragEvent<HTMLElement>) => drag?.onDragStart(event)}
          onDragEnd={(event: DragEvent<HTMLElement>) => drag?.onDragEnd(event)}
          aria-hidden
          className="-mr-1 flex w-8 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 active:cursor-grabbing"
        >
          <DragHandleDots1Icon className="text-sm" />
        </span>
      ) : null}
    </div>
  );

  return (
    <motion.li
      ref={ref}
      {...presence}
      className={cn(
        // Only the last row sits on the card's corner, so only it rounds. The
        // first row's strip must stay square: it is mid-card, under the header.
        'relative isolate overflow-hidden',
        last && 'rounded-b-lg',
        className,
      )}
    >
      {drag?.dropEdge === 'before' ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 bg-primary" />
      ) : null}
      {drag?.dropEdge === 'after' ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-0.5 bg-primary" />
      ) : null}

      {/*
       * Revealed by a swipe-left; kept mounted so the reveal can animate.
       *
       * These actions sit UNDER the row content, which is why they are invisible
       * in the common case — but only because the row paints over them. At the
       * card's rounded corners the parent clips the row's background and the
       * buttons show through as coloured crescents. So they are translated
       * fully out of the card until the row is actually revealed.
       *
       * They ride the row's own `offsetX` — the trio is exactly
       * `SWIPE_ACTION_WIDTH` wide, so `SWIPE_ACTION_WIDTH + offsetX` is 100%
       * parked at rest, 0 when open, and the finger's position in between. That
       * is what makes them appear *during* the drag instead of after the
       * release, while a settled swipe still ends at exactly 0 or 100%.
       */}
      <div
        aria-hidden={!revealed}
        className="absolute inset-y-0 right-0 z-0 flex w-57"
        style={{
          transform: `translateX(${SWIPE_ACTION_WIDTH + offsetX}px)`,
          transition: swiping ? 'none' : 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)',
          pointerEvents: revealed ? 'auto' : 'none',
        }}
      >
        <button
          type="button"
          tabIndex={revealed ? 0 : -1}
          disabled={disabled}
          aria-label={`Complete ${task.title}`}
          onClick={() => {
            closeReveal();
            toggle();
          }}
          className="flex-1 bg-chart-2 text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
        >
          Complete
        </button>
        {onPin ? (
          <button
            type="button"
            tabIndex={revealed ? 0 : -1}
            disabled={disabled}
            aria-label={task.isPinned ? `Unpin ${task.title}` : `Pin ${task.title}`}
            onClick={() => {
              closeReveal();
              onPin(task);
            }}
            className="flex flex-1 items-center justify-center gap-1 bg-primary text-sm font-semibold text-primary-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
          >
            {task.isPinned ? (
              <SewingPinIcon className="text-sm" aria-hidden />
            ) : (
              <DrawingPinIcon className="text-sm" aria-hidden />
            )}
            {task.isPinned ? 'Unpin' : 'Pin'}
          </button>
        ) : null}
        {onDelete ? (
          <button
            type="button"
            tabIndex={revealed ? 0 : -1}
            disabled={disabled}
            aria-label={`Delete ${task.title}`}
            onClick={() => {
              closeReveal();
              onDelete(task);
            }}
            className="flex-1 bg-destructive text-sm font-semibold text-white outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-50"
          >
            Delete
          </button>
        ) : null}
      </div>

      {/*
       * The extra actions, on the desktop's own gesture. Radix opens this on the
       * `contextmenu` event, which a mouse reaches with a right click and a
       * keyboard reaches with the context-menu key or Shift+F10 — so the row's
       * actions are finally keyboard-reachable, which the MUI long-press menu
       * never was. Mounted only for a pointer that can hover: on touch the long
       * press is the lift gesture, and Radix's own touch long-press would race it.
       */}
      {finePointer ? (
        <ContextMenu>
          <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onSelect={() => onToggle(task)}>
              {completed ? (
                <CrossCircledIcon className="text-sm" aria-hidden />
              ) : (
                <CheckIcon className="text-sm" aria-hidden />
              )}
              {completed ? 'Mark as not done' : 'Complete'}
            </ContextMenuItem>
            {onWontDo && !wontDo ? (
              <ContextMenuItem onSelect={() => onWontDo(task)}>
                <CrossCircledIcon className="text-sm" aria-hidden />
                Mark as won&apos;t do
              </ContextMenuItem>
            ) : null}
            {onPin ? (
              <ContextMenuItem onSelect={() => onPin(task)}>
                {task.isPinned ? (
                  <SewingPinIcon className="text-sm" aria-hidden />
                ) : (
                  <DrawingPinIcon className="text-sm" aria-hidden />
                )}
                {task.isPinned ? 'Unpin' : 'Pin to top'}
              </ContextMenuItem>
            ) : null}
            {onDelete ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem variant="destructive" onSelect={() => onDelete(task)}>
                  Delete
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : (
        row
      )}
    </motion.li>
  );
}
