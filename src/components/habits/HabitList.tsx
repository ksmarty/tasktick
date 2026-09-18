'use client';

/**
 * The habit card, plus reordering.
 *
 * The card follows the task list's in-card header shape: the group name is the
 * card's first row, with the habit count and a collapse chevron on its trailing
 * edge. There is no real grouping in the habit data, so this is one "Habits"
 * card rather than invented categories.
 *
 * ## Why the reorder is still hand-rolled
 *
 * The GodUI `reorder-list` was evaluated for this list and deliberately not
 * adopted. It drives its drag from `pointerdown` with `touch-none` on every
 * item, which is the one thing this list cannot have: the card sits inside the
 * shell's scroll pane, so a finger that lands on a row must still scroll the
 * page. Its gesture is also unconditional, whereas this list only lifts a row
 * after a 320ms long press, and it has no keyboard path — while the grip's
 * Arrow Up / Arrow Down reorder is part of the behaviour being preserved.
 * Swapping the gesture layer would have meant rewriting exactly the parts that
 * cannot be verified without a device, so the proven implementation stays and
 * only its rendering changed.
 *
 * Reordering uses Pointer Events rather than HTML5 drag-and-drop, because
 * drag-and-drop does not exist on touch. There are two ways in, and they are
 * never both on screen at once:
 *
 *   - **touch** — press and hold the row body and it lifts; keep holding and
 *     move it over a neighbour and the list reorders live. Movement before the
 *     timer fires is treated as a scroll and cancels the pick-up, so the list
 *     still scrolls normally.
 *   - **pointer** — a grip fades in on hover (and on keyboard focus), and moves
 *     the focused habit with Arrow Up / Arrow Down.
 *
 * The final order is handed to the caller to persist, and is rolled back when
 * that write fails.
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDownIcon } from '@svg-animated-icons/react/chevron-down';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { HabitRow } from './HabitRow';
import type { CheckInChange } from './period';
import type { DateOnly, Habit } from '@/lib/types';

/** How long a finger has to rest on a card before it is being dragged. */
const LONG_PRESS_MS = 320;
/** Movement past this before the timer fires means "scroll", not "pick up". */
const LONG_PRESS_SLOP_PX = 8;
/**
 * How long the rows keep their entrance animation.
 *
 * The column's longest delay plus its animation is a little over half a second,
 * so that covers every row; after that the entrance is dropped and the list is
 * inert for the rest of its life.
 */
const ROW_STAGGER_MS = 600;
/** The row entrance: a short rise and fade, staggered by row index. */
const ROW_ENTER_DURATION = 0.32;
const ROW_STAGGER_STEP = 0.04;
const ROW_STAGGER_MAX = 0.24;

export interface HabitListProps {
  habits: Habit[];
  /** The day the rows check in for, chosen by the page's week strip. */
  date: DateOnly;
  today: DateOnly;
  /** Id of the habit whose check-in is in flight, if any. */
  pendingId?: string | null;
  onCheckIn: (habit: Habit, change: CheckInChange) => void;
  onEdit: (habit: Habit) => void;
  /** Resolves true when the new order was saved, false when it must be undone. */
  onReorder: (orderedIds: string[]) => Promise<boolean>;
}

export function HabitList({
  habits,
  date,
  today,
  pendingId = null,
  onCheckIn,
  onEdit,
  onReorder,
}: HabitListProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;

  /** Local order while dragging or after a keyboard move, before the refetch. */
  const [localOrder, setLocalOrder] = useState<string[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const dragRef = useRef<{ id: string; order: string[] } | null>(null);
  /** Swallows the click that a completed drag would otherwise deliver. */
  const swallowClickRef = useRef(false);
  const [collapsed, setCollapsed] = useState(false);

  /**
   * The rows lay themselves down once, when the list first appears.
   *
   * The entrance animation plays whenever a row mounts — and a check-in
   * re-renders this list (the optimistic patch, then the refetch), which must
   * not replay the entrance. Leaving the flag on would already be enough for
   * that, but collapsing and expanding the card remounts the rows and would
   * replay it, so the flag is cleared once the animation has run. "Animate in"
   * then means "on the first mount" and nothing else.
   */
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    if (!entering) return;
    const timer = window.setTimeout(() => setEntering(false), ROW_STAGGER_MS);
    return () => window.clearTimeout(timer);
  }, [entering]);

  // A fetch that adds or removes a habit invalidates the local order — except
  // mid-drag, and except when the list still holds exactly the same habits (which
  // is what a refresh after a successful reorder looks like).
  useEffect(() => {
    setLocalOrder((current) => {
      if (!current || dragRef.current) return current;
      const incoming = habits.map((habit) => habit.id);
      const sameSet = current.length === incoming.length && current.every((id) => incoming.includes(id));
      return sameSet ? current : null;
    });
  }, [habits]);

  /** Applies an order locally, then keeps it only if the write succeeded. */
  async function commit(next: string[]) {
    setLocalOrder(next);
    const saved = await reorderRef.current(next);
    if (!saved) setLocalOrder(null);
  }

  const ids = useMemo(() => localOrder ?? habits.map((habit) => habit.id), [habits, localOrder]);
  const idsRef = useRef(ids);
  idsRef.current = ids;

  const ordered = useMemo(() => {
    const byId = new Map(habits.map((habit) => [habit.id, habit]));
    return ids.map((id) => byId.get(id)).filter((habit): habit is Habit => habit !== undefined);
  }, [habits, ids]);

  function startDrag(habit: Habit, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    swallowClickRef.current = false;
    dragRef.current = { id: habit.id, order: [...ids] };
    setLocalOrder([...ids]);
    setDragId(habit.id);
  }

  /**
   * Arms the touch reorder. A long press on the row body lifts it; a scroll, a
   * short tap, or a press that starts on a control does not.
   */
  const armLongPress = useCallback((habit: Habit, event: ReactPointerEvent<HTMLElement>) => {
    // A fresh press always re-arms click handling for whatever comes next, so a
    // swallowed drag click can never leak into the following tap.
    swallowClickRef.current = false;

    // Mouse users get the grip instead, so a click never turns into a drag.
    if (event.pointerType === 'mouse') return;
    const target = event.target;
    if (target instanceof HTMLElement) {
      const control = target.closest('button, a, input, textarea, select');
      // A press that starts on a real control belongs to that control. The row
      // body is a button too (a tap opens the editor), but holding it must still
      // lift the card, so it is the one button exempt from that rule.
      if (control && !control.hasAttribute('data-habit-body')) return;
    }

    const startX = event.clientX;
    const startY = event.clientY;
    const order = [...idsRef.current];
    let timer = 0;

    function stopWatching() {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', cancel);
      window.removeEventListener('pointercancel', cancel);
    }
    function cancel() {
      stopWatching();
    }
    function onMove(move: PointerEvent) {
      if (
        Math.abs(move.clientX - startX) > LONG_PRESS_SLOP_PX ||
        Math.abs(move.clientY - startY) > LONG_PRESS_SLOP_PX
      ) {
        cancel();
      }
    }

    timer = window.setTimeout(() => {
      stopWatching();
      swallowClickRef.current = true;
      dragRef.current = { id: habit.id, order };
      setLocalOrder(order);
      setDragId(habit.id);
      navigator.vibrate?.(8);
    }, LONG_PRESS_MS);

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', cancel);
    window.addEventListener('pointercancel', cancel);
  }, []);

  // While a card is lifted, the pane must not scroll under the finger: the drag
  // reads `clientY`, so a moving viewport would fight the reorder. Cancelling
  // `touchmove` is what does the real work — the browser hands a gesture to its
  // scroller on the first move, and fires `pointercancel` at the same moment,
  // which would end the drag before it moved.
  useEffect(() => {
    if (!dragId) return;
    // The shell's scroll pane is the `<main>` (`AppShell` owns it); the old
    // `.scroll-pane` hook is kept as a fallback so the lock never silently
    // stops working if that changes again.
    const pane = containerRef.current?.closest<HTMLElement>('main, .scroll-pane');
    if (pane) pane.style.overflowY = 'hidden';

    const onTouchMove = (event: TouchEvent) => {
      if (dragRef.current) event.preventDefault();
    };
    document.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });

    return () => {
      if (pane) pane.style.overflowY = '';
      document.removeEventListener('touchmove', onTouchMove, { capture: true });
    };
  }, [dragId]);

  useEffect(() => {
    if (!dragId) return;

    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const container = containerRef.current;
      if (!drag || !container) return;

      const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-habit-id]'));
      const over = cards.find((card) => {
        const rect = card.getBoundingClientRect();
        return event.clientY >= rect.top && event.clientY <= rect.bottom;
      });
      const targetId = over?.dataset.habitId;
      if (!targetId || targetId === drag.id) return;

      const from = drag.order.indexOf(drag.id);
      const to = drag.order.indexOf(targetId);
      if (from < 0 || to < 0 || from === to) return;

      const next = [...drag.order];
      next.splice(from, 1);
      next.splice(to, 0, drag.id);
      drag.order = next;
      setLocalOrder(next);
    };

    const onEnd = () => {
      const drag = dragRef.current;
      dragRef.current = null;
      setDragId(null);
      if (drag) void commit(drag.order);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onEnd);
    window.addEventListener('pointercancel', onEnd);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onEnd);
      window.removeEventListener('pointercancel', onEnd);
    };
  }, [dragId]);

  function moveBy(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    const next = [...ids];
    [next[index], next[target]] = [next[target], next[index]];
    void commit(next);
  }

  return (
    <div
      ref={containerRef}
      // Running order is a drag gesture's business only; the tap that ends it
      // must not also toggle a check-in.
      onClickCapture={(event) => {
        if (swallowClickRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
    >
      <section
        aria-label="Habits"
        className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground"
      >
        {/* The in-card header, the same shape the task list's groups use: the
            name, then the count and the chevron as quiet trailing marks. */}
        <div
          className={cn(
            'flex min-h-12 items-center justify-between gap-2 pr-2 pl-row',
            !collapsed && 'border-b border-border',
          )}
        >
          <h2 className="min-w-0 truncate text-base font-semibold">Habits</h2>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setCollapsed((value) => !value)}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? 'Expand' : 'Collapse'} habits`}
            className="gap-2 px-2 text-muted-foreground"
          >
            <span aria-hidden className="text-xs font-medium">
              {habits.length}
            </span>
            <span className="sr-only">{`${habits.length} habit${habits.length === 1 ? '' : 's'}`}</span>
            <ChevronDownIcon
              className={cn('size-4 transition-transform duration-200', collapsed && '-rotate-90')}
            />
          </Button>
        </div>

        <AnimatePresence initial={false}>
          {collapsed ? null : (
            <motion.div
              key="habit-rows"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              className="overflow-hidden"
            >
              <div role="list">
                {ordered.map((habit, index) => (
                  <motion.div
                    key={habit.id}
                    data-habit-id={habit.id}
                    initial={entering ? { opacity: 0, y: 6 } : false}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      duration: ROW_ENTER_DURATION,
                      ease: 'easeOut',
                      delay: entering ? Math.min(index * ROW_STAGGER_STEP, ROW_STAGGER_MAX) : 0,
                    }}
                    className={cn(index > 0 && 'border-t border-border')}
                  >
                    <HabitRow
                      habit={habit}
                      date={date}
                      today={today}
                      pending={pendingId === habit.id}
                      dragging={dragId === habit.id}
                      onRowPointerDown={(event) => armLongPress(habit, event)}
                      onCheckIn={(change) => onCheckIn(habit, change)}
                      onEdit={() => onEdit(habit)}
                      onGripPointerDown={(event) => startDrag(habit, event)}
                      onMoveBy={(delta) => moveBy(index, delta)}
                      canMoveUp={index > 0}
                      canMoveDown={index < ids.length - 1}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </div>
  );
}
