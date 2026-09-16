'use client';

/**
 * The list of habit cards, plus reordering.
 *
 * Reordering uses Pointer Events rather than HTML5 drag-and-drop, because
 * drag-and-drop does not exist on touch: the grip captures the pointer, the list
 * tracks which card the finger is over and reorders live, and the final order is
 * handed to the caller to persist. The same handle also moves a habit with
 * Arrow Up / Arrow Down, so the ordering is reachable without a pointing device
 * — which a drag-only affordance never is.
 */
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { HabitRow } from './HabitRow';
import type { DateOnly, Habit } from '@/lib/types';

export interface HabitListProps {
  habits: Habit[];
  today: DateOnly;
  weekStartsOn: number;
  windowLabel: string;
  timeFormat: '12h' | '24h';
  /** True while a check-in for the tapped habit is in flight. */
  pending?: boolean;
  onCheckIn: (habit: Habit, change: { count?: number | null; delta?: number }) => void;
  onEdit: (habit: Habit) => void;
  /** Resolves true when the new order was saved, false when it must be undone. */
  onReorder: (orderedIds: string[]) => Promise<boolean>;
}

export function HabitList({
  habits,
  today,
  weekStartsOn,
  windowLabel,
  timeFormat,
  pending = false,
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
  const ordered = useMemo(() => {
    const byId = new Map(habits.map((habit) => [habit.id, habit]));
    return ids.map((id) => byId.get(id)).filter((habit): habit is Habit => habit !== undefined);
  }, [habits, ids]);

  function startDrag(habit: Habit, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    dragRef.current = { id: habit.id, order: [...ids] };
    setLocalOrder([...ids]);
    setDragId(habit.id);
  }

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
    <div ref={containerRef}>
      {ordered.map((habit, index) => (
        <div key={habit.id} data-habit-id={habit.id}>
          <HabitRow
            habit={habit}
            today={today}
            weekStartsOn={weekStartsOn}
            windowLabel={windowLabel}
            timeFormat={timeFormat}
            pending={pending}
            dragging={dragId === habit.id}
            onCheckIn={(change) => onCheckIn(habit, change)}
            onEdit={() => onEdit(habit)}
            onGripPointerDown={(event) => startDrag(habit, event)}
            onMoveBy={(delta) => moveBy(index, delta)}
            canMoveUp={index > 0}
            canMoveDown={index < ids.length - 1}
          />
        </div>
      ))}
    </div>
  );
}
