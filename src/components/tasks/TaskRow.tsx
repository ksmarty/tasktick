'use client';

/**
 * The signature list row.
 *
 * Leading edge: a shadcn `Checkbox` inside its own 44px touch target. Body: a
 * button whose first line carries the title, the pin and the trailing due date,
 * and whose second line is the derived meta (`TaskMeta`). Behind the row a
 * swipe-left reveals Complete and Delete. A long press either lifts the row for
 * reordering (on touch) or — on a pointer that can hover — right-click opens a
 * shadcn `ContextMenu` of the extra actions; never both, so a finger drag is
 * never mistaken for a context menu.
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
 * The Complete/Delete pair used to sit parked outside the card until a release
 * decided the swipe, so a drag moved the row over the bare card and the buttons
 * were painted in afterwards. The pair now rides the same `offsetX` the row
 * does — `translateX(SWIPE_ACTION_WIDTH + offsetX)` — so both move 1:1 with the
 * finger from the first pixel past the axis lock and the buttons are on screen
 * for the whole drag. Release snapshots the same way it always did: past half
 * the pair's width it settles open, otherwise it snaps back, and the 200ms
 * transition is disabled only while the finger is down.
 *
 * The long-press lift and the horizontal swipe still share the row without
 * fighting: the axis lock at `GESTURE_SLOP_PX` decides once, a vertical gesture
 * hands the row back to the scroller, and the lift keeps the pointer captured.
 *
 * A pinned task carries a pin glyph beside its title, which is the one mark the
 * row adds to say "this one was pinned deliberately": it belongs on the name,
 * not down in the meta line where the derived facts live.
 *
 * ## The list colour
 *
 * The section used to paint a 4px coloured stripe down its leading edge. It is
 * an 8px dot in the section header now (see `TaskListSection`): the same "which
 * list" signal, on a card that is otherwise pure contrast, which is what lets
 * Celestial Sapphire be the monochrome palette it is.
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
import { motion, useReducedMotion } from 'framer-motion';
import { CheckIcon } from '@svg-animated-icons/react/check';
import { CrossCircledIcon } from '@svg-animated-icons/react/cross-circled';
import { DragHandleDots1Icon } from '@svg-animated-icons/react/drag-handle-dots-1';
import { DrawingPinIcon } from '@svg-animated-icons/react/drawing-pin';
import { useMediaQuery } from '@/lib/store';
import type { Task } from '@/lib/types';
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

/** Width of the revealed Complete + Delete pair (2 × 76px, i.e. `w-38`). */
export const SWIPE_ACTION_WIDTH = 152;
/** How long a press must last before it lifts the row. */
const LONG_PRESS_MS = 550;
/** Movement that cancels a long press and decides the gesture axis. */
const GESTURE_SLOP_PX = 8;
/** True only on a device whose primary input can hover and point precisely. */
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

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
  /** Opens the editor dialog. */
  onOpen: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onWontDo?: (task: Task) => void;
  /** Writes are unavailable (offline). */
  disabled?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: (task: Task) => void;
  drag?: TaskRowDrag | null;
  /** Rounds the bottom corner of the last row of a card. */
  last?: boolean;
  /** Rounds the top corner of the first row of a card. */
  first?: boolean;
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
  onOpen,
  onDelete,
  onWontDo,
  disabled = false,
  selectionMode = false,
  selected = false,
  onSelect,
  drag,
  last = false,
  first = false,
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
  const draggable = Boolean(drag?.draggable) && !selectionMode && !disabled;
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
    if (!completed) setJustCompleted(true);
    onToggle(task);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || selectionMode) return;
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
        'relative z-10 flex min-h-11 w-full items-center gap-1 px-row',
        lifted && 'z-20 bg-card shadow-xl',
        disabled && 'opacity-60',
      )}
    >
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
          if (selectionMode) onSelect?.(task);
          else onOpen(task);
        }}
        aria-pressed={selectionMode ? selected : undefined}
        aria-label={selectionMode ? `${selected ? 'Deselect' : 'Select'} ${task.title}` : `Open ${task.title}`}
        className="group/row-content relative flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {/*
         * The press/hover highlight, inset inside the button rather than
         * painted by it, so it reads as a region and not a slab. The button
         * keeps its own 44px box, and the children below are positioned so they
         * paint (and hit-test) over this layer.
         */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1.5 inset-y-1 rounded-md bg-accent/0 transition-colors group-hover/row-content:bg-accent/30 group-active/row-content:bg-accent/50"
        />
        {/*
         * The title, with the due date pinned to the row's trailing edge.
         *
         * The title is allowed to wrap, and the date does not shrink. The
         * previous version had `truncate` here, which sets `white-space: nowrap`
         * — so a long title could never wrap, could never push the date down,
         * and simply ellipsised. A task list is where you go to read what the
         * task is; cutting the one word that distinguishes two similar tasks
         * ("Reply to the design re…") defeats the point of the list.
         *
         * The content column and the due date are the button's two children, so
         * the date is centred against the *row* rather than against the title.
         * Inside the title's own row it could only ever be centred against the
         * title: on a row whose title is one line while its meta line makes the
         * row two, the date's own centre sat ~10px above the row's. Measured
         * after: 0.0px against the row on both shapes.
         */}
        <span className="relative flex min-w-0 flex-1 flex-col items-stretch gap-0">
          <span className="relative flex w-full min-w-0 flex-wrap items-center gap-x-1 gap-y-0">
            <span
              className={cn(
                'min-w-0 flex-1 text-base leading-tight',
                completed && 'text-muted-foreground line-through',
                wontDo && 'text-muted-foreground/70 line-through',
              )}
            >
              {task.title}
            </span>
            {task.isPinned ? (
              <span className="inline-flex shrink-0 items-center text-primary">
                <DrawingPinIcon className="text-sm" aria-hidden />
                <span className="sr-only">Pinned</span>
              </span>
            ) : null}
          </span>
          <TaskMeta task={task} className="relative" />
        </span>
        <DueDateLabel
          task={task}
          zone={zone}
          timeFormat={timeFormat}
          className="shrink-0 self-center"
        />
      </button>

      {selectionMode ? (
        <span
          aria-hidden
          className={cn(
            'grid size-6 shrink-0 place-items-center rounded-md border',
            selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input',
          )}
        >
          {selected ? <CheckIcon className="text-base" /> : null}
        </span>
      ) : gripVisible ? (
        // The grip is the pointer drag handle: keeping the HTML5 drag here and
        // not on the whole row leaves the row free for the swipe gesture.
        <span
          draggable
          onDragStart={(event: DragEvent<HTMLElement>) => drag?.onDragStart(event)}
          onDragEnd={(event: DragEvent<HTMLElement>) => drag?.onDragEnd(event)}
          aria-hidden
          className="-mr-2 flex w-8 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground/60 active:cursor-grabbing"
        >
          <DragHandleDots1Icon className="text-sm" />
        </span>
      ) : null}
    </div>
  );

  return (
    <li
      ref={ref}
      className={cn(
        'relative isolate overflow-hidden',
        first && 'rounded-t-xl',
        last && 'rounded-b-xl',
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
       * buttons show through as red and green crescents. So they are translated
       * fully out of the card until the row is actually revealed.
       *
       * They ride the row's own `offsetX` — the pair is exactly
       * `SWIPE_ACTION_WIDTH` wide, so `SWIPE_ACTION_WIDTH + offsetX` is 100%
       * parked at rest, 0 when open, and the finger's position in between. That
       * is what makes them appear *during* the drag instead of after the
       * release, while a settled swipe still ends at exactly 0 or 100%.
       */}
      <div
        aria-hidden={!revealed}
        className="absolute inset-y-0 right-0 z-0 flex w-38"
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
    </li>
  );
}
