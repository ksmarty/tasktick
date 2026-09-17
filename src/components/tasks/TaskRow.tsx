'use client';

/**
 * The signature iOS list row.
 *
 * Leading edge: a real 24px checkbox inside a 44px touch target. Body: the title
 * and the derived meta line, which opens the editor. Behind it: a swipe-left
 * reveals Complete/Delete. A long press either lifts the row for reordering (on
 * touch) or offers the extra actions (on a mouse) — never both, so a finger drag
 * is never mistaken for a context menu.
 *
 * A pinned task carries a pin glyph beside its title, which is the one mark the
 * row adds to say "this one was pinned deliberately": it belongs on the name,
 * not down in the meta line where the derived facts live.
 *
 * ## The drag grip
 *
 * A grip is only drawn where a pointer can actually use it. It used to be
 * unconditional, which cost every row 44px of title width on a phone in exchange
 * for an affordance a finger cannot grab — the width is what made
 * "Reply to the design review thread" ellipsise. Which input the device has is a
 * capability question, not a width one: an iPad is wide and has no pointer, a
 * small laptop window is narrow and has one, so this is a `(hover: hover) and
 * (pointer: fine)` test rather than a breakpoint. Long-press-to-lift still works
 * on touch because that path is driven by `pointerType`, not by the grip.
 */
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { Ban, Check, GripVertical, Pin, Trash } from 'lucide-react';
import { ActionSheet, type ActionSheetAction } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMediaQuery } from '@/lib/store';
import type { Task } from '@/lib/types';
import { DueDateLabel, TaskMeta } from './TaskMeta';

/** Width of the revealed Complete + Delete pair (2 × 76px). */
export const SWIPE_ACTION_WIDTH = 152;
/** How long a press must last before it lifts the row or opens the actions. */
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
  listName?: string | null;
  /** Ticks the task off, or un-ticks it when it is already done. */
  onToggle: (task: Task) => void;
  /** Opens the editor sheet. */
  onOpen: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onWontDo?: (task: Task) => void;
  /** Writes are unavailable (offline). */
  disabled?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: (task: Task) => void;
  drag?: TaskRowDrag | null;
  /** Drops the separator under the last row of a group. */
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
  listName,
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
  const [actionsOpen, setActionsOpen] = useState(false);

  const contentRef = useRef<HTMLDivElement>(null);
  const gesture = useRef({ x: 0, y: 0, active: false, axis: null as null | 'x' | 'y', timer: 0, lifted: false });

  const completed = task.status === 'completed';
  const wontDo = task.status === 'wont_do';
  const closed = completed || wontDo;
  const draggable = Boolean(drag?.draggable) && !selectionMode && !disabled;
  // Resolved after hydration (the server snapshot is `false`), so touch never
  // flashes a grip it cannot use.
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
    const close = () => {
      setRevealed(false);
      setOffsetX(0);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [revealed]);

  function closeReveal() {
    setRevealed(false);
    setOffsetX(0);
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
      if (event.pointerType === 'mouse') {
        setActionsOpen(true);
        return;
      }
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
    }

    state.active = false;
    state.axis = null;
  }

  const actions: ActionSheetAction[] = [
    {
      label: completed ? 'Mark as not done' : 'Complete',
      icon: Check,
      onSelect: () => onToggle(task),
    },
  ];
  if (onWontDo && !wontDo) {
    actions.push({ label: "Mark as won't do", icon: Ban, onSelect: () => onWontDo(task) });
  }
  if (onDelete) {
    actions.push({ label: 'Delete', icon: Trash, destructive: true, onSelect: () => onDelete(task) });
  }

  const lifted = Boolean(drag?.isLifted);

  return (
    <li
      ref={ref}
      className={cn(
        'relative',
        // The lifted row must paint over its siblings, so the raised z-index has
        // to live on the list item rather than only on its content.
        lifted && 'z-20',
        last && 'rounded-b-ios-md',
        first && 'rounded-t-ios-md',
        className,
      )}
    >
      {drag?.dropEdge === 'before' ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 z-30 h-0.5 bg-tint" />
      ) : null}
      {drag?.dropEdge === 'after' ? (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 z-30 h-0.5 bg-tint" />
      ) : null}

      {/*
       * Revealed by a swipe-left; kept mounted so the reveal can animate.
       *
       * These actions sit UNDER the row content, which is why they are invisible
       * in the common case — but only because the row paints over them. At the
       * card's rounded corners the parent clips the row's background and the
       * buttons show through as red and green crescents. `aria-hidden` does not
       * help: it removes them from the accessibility tree, not from the screen.
       *
       * So they are translated fully out of the card until the row is actually
       * revealed. That removes the artefact and makes the reveal slide in from
       * the edge, which is how a native swipe action behaves anyway.
       */}
      <div
        aria-hidden={!revealed}
        className={cn(
          'absolute inset-y-0 right-0 flex transition-transform duration-200 ease-ios-out',
          revealed ? 'translate-x-0' : 'pointer-events-none translate-x-full',
        )}
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
          className="flex min-h-11 items-center justify-center bg-success text-subhead font-semibold text-on-tint pressable disabled:opacity-40"
          style={{ width: SWIPE_ACTION_WIDTH / 2 }}
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
            className="flex min-h-11 items-center justify-center bg-danger text-subhead font-semibold text-on-tint pressable disabled:opacity-40"
            style={{ width: SWIPE_ACTION_WIDTH / 2 }}
          >
            Delete
          </button>
        ) : null}
      </div>

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
          transition: gesture.current.axis === 'x' || lifted ? 'none' : 'transform 220ms var(--ease-ios)',
          touchAction: 'pan-y',
        }}
        className={cn(
          // No background of its own: the card is the surface, so a translucent
          // one reads as a single grouped list rather than N white slices. The
          // lifted row needs its own solid paint, since it travels over others.
          'relative flex min-h-11 items-center gap-3 px-4',
          first && 'rounded-t-ios-md',
          last && 'rounded-b-ios-md',
          lifted ? 'z-20 bg-elevated shadow-ios-lg' : 'z-10',
          !disabled && !selectionMode && 'pressable-row',
          disabled && 'opacity-60',
          // Hairline inset to the title column: 16px gutter + 24px circle + 12px gap.
          !last &&
            'after:pointer-events-none after:absolute after:bottom-0 after:right-0 after:left-13 after:h-px after:bg-separator',
        )}
      >
        <button
          type="button"
          role="checkbox"
          aria-checked={completed ? true : wontDo ? 'mixed' : false}
          aria-label={completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}
          disabled={disabled}
          onClick={toggle}
          className="-ml-2.5 flex size-11 shrink-0 items-center justify-center disabled:opacity-40"
        >
          <span
            aria-hidden
            className={cn(
              'flex size-6 items-center justify-center rounded-full border-[1.5px] transition-colors duration-150 ease-ios',
              completed && 'border-tint bg-tint text-on-tint',
              wontDo && 'border-dashed border-separator-opaque text-tertiary',
              !closed && 'border-separator-opaque text-tint',
              justCompleted && 'animate-pop',
            )}
          >
            {completed ? <Check className="size-4 stroke-[3]" aria-hidden /> : null}
            {wontDo ? <Ban className="size-4" aria-hidden /> : null}
          </span>
        </button>

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
          className="flex min-h-11 min-w-0 flex-1 flex-col justify-center py-1.5 text-left"
        >
          {/*
           * The title, with the due date pinned to the row's trailing edge.
           *
           * The wrap is the point: the date is `shrink-0` and the title grows
           * into whatever is left, so the two share the line whenever the title
           * fits beside the date (which is how a short row reads in the
           * reference), and when it does not, the *date* wraps to its own
           * right-aligned line rather than the title ellipsising to make room
           * for it.
           *
           * `grow`, not `flex-1`: `flex-1` sets `flex-basis: 0`, which makes the
           * title's hypothetical width zero, so flexbox never sees a line that
           * cannot fit and the date never wraps — the title just ellipsises.
           * `flex-basis: auto` is what lets the wrap happen.
           */}
          <span className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
            <span
              className={cn(
                // Every px the checkbox and the (pointer-only) grip do not need,
                // minus what the date reserves at the trailing edge.
                'min-w-0 grow truncate text-body',
                completed && 'text-secondary line-through',
                wontDo && 'text-tertiary line-through',
              )}
            >
              {task.title}
            </span>
            {task.isPinned ? (
              <span className="inline-flex shrink-0 items-center text-tint">
                <Pin className="size-3.5" strokeWidth={2.25} aria-hidden />
                <span className="sr-only">Pinned</span>
              </span>
            ) : null}
            <DueDateLabel task={task} zone={zone} timeFormat={timeFormat} className="ml-auto" />
          </span>
          <TaskMeta task={task} listName={listName} className="mt-0" />
        </button>

        {selectionMode ? (
          <span
            aria-hidden
            className={cn(
              'flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px]',
              selected ? 'border-tint bg-tint text-on-tint' : 'border-separator-opaque',
            )}
          >
            {selected ? <Check className="size-4 stroke-[3]" aria-hidden /> : null}
          </span>
        ) : gripVisible ? (
          // The grip is the pointer drag handle: keeping the HTML5 drag here and
          // not on the whole row leaves the row free for the swipe gesture.
          <span
            draggable
            onDragStart={(event) => drag?.onDragStart(event)}
            onDragEnd={(event) => drag?.onDragEnd(event)}
            aria-hidden
            className="-mr-2 flex size-8 shrink-0 cursor-grab items-center justify-center text-tertiary transition-colors ease-ios hover:text-secondary active:cursor-grabbing"
          >
            <GripVertical className="size-4" strokeWidth={2} />
          </span>
        ) : null}
      </div>

      <ActionSheet
        open={actionsOpen}
        onOpenChange={setActionsOpen}
        title={task.title}
        actions={actions}
      />
    </li>
  );
}
