'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CalendarItem } from '@/lib/types';
import {
  LONG_PRESS_MS,
  MOUSE_DRAG_SLOP_PX,
  PRESS_SLOP_PX,
  dragToCellDelta,
  dragToStartMinute,
  minutesToPixels,
  type DayAxis,
} from './geometry';
import type { CalendarInteraction, RescheduleTarget } from './types';

export interface DragInit {
  /** The block's start, minutes from midnight (0 for an all-day item). */
  startMinute: number;
  durationMinutes: number;
  /** Flat index of the block's own cell in the visible range. */
  cellIndex: number;
}

export interface DragGhost {
  item: CalendarItem;
  target: RescheduleTarget;
  /** Raw pointer position, used for the floating time label. */
  clientX: number;
  clientY: number;
  /** Snapped pixel offset to translate the lifted block by. */
  offsetX: number;
  offsetY: number;
  label: string;
}

export interface ItemDragConfig {
  /** Height of one hour row in px, or 0 when time is not draggable. */
  hourHeight: number;
  /** The element a drag may not leave, and the source of the cell geometry. */
  gridRef: React.RefObject<HTMLElement | null>;
  /**
   * The element a drag must stay inside, when that is larger than the cell grid.
   * The week view's all-day strip sits above the timed grid, so a drag that
   * starts there would otherwise be cancelled by its own bounds test.
   */
  boundsRef?: React.RefObject<HTMLElement | null>;
  /** Shared gesture flags, so a paging swipe can stand down during a drag. */
  interaction: CalendarInteraction;
  /** Cell lattice for day movement; omit for a view with a single cell. */
  axis?: (init: DragInit) => DayAxis | null;
  /** Floating label text for the current snapped target. */
  formatLabel: (item: CalendarItem, target: RescheduleTarget) => string;
  /** Called once, on a successful drop. */
  onDrop: (item: CalendarItem, target: RescheduleTarget) => void;
}

interface DragSession {
  item: CalendarItem;
  init: DragInit;
  axis: DayAxis | null;
  pointerId: number;
  pointerType: string;
  element: HTMLElement;
  startX: number;
  startY: number;
  armed: boolean;
  timer: number | null;
  target: RescheduleTarget;
  listeners: {
    move: (event: PointerEvent) => void;
    up: (event: PointerEvent) => void;
    cancel: () => void;
    keydown: (event: KeyboardEvent) => void;
  };
}

/**
 * Pointer-Event drag-to-reschedule.
 *
 * Deliberately not HTML5 drag-and-drop: `draggable` never fires on iOS Safari,
 * so a Home Screen install would lose the whole gesture.
 *
 * The two halves of the contract this hook exists to satisfy:
 *
 *   · A vertical drag on the grid must still scroll the page, so the pointer is
 *     only captured *after* the drag is armed — by a ~250ms press, or
 *     immediately for a mouse (where there is no scroll gesture to protect and
 *     instant dragging is what a pointer expects). Until it is armed, a finger
 *     that travels past the slop cancels the press instead.
 *   · A drag that leaves the grid, or that the user aborts with Escape, is
 *     cancelled outright rather than committed to a half-visible slot.
 *
 * The arithmetic — snapping and cell clamping — lives in `./geometry`, so
 * `tests/calendar-drag.test.ts` covers the code that actually ships.
 */
export function useItemDrag(config: ItemDragConfig): {
  ghost: DragGhost | null;
  begin: (item: CalendarItem, event: ReactPointerEvent<HTMLButtonElement>, init: DragInit) => void;
} {
  const [ghost, setGhost] = useState<DragGhost | null>(null);
  const configRef = useRef(config);
  configRef.current = config;
  const sessionRef = useRef<DragSession | null>(null);

  const finish = useCallback((commit: boolean) => {
    const session = sessionRef.current;
    if (!session) return;
    sessionRef.current = null;

    if (session.timer !== null) window.clearTimeout(session.timer);
    window.removeEventListener('pointermove', session.listeners.move);
    window.removeEventListener('pointerup', session.listeners.up);
    window.removeEventListener('pointercancel', session.listeners.cancel);
    window.removeEventListener('keydown', session.listeners.keydown);
    try {
      if (session.element.hasPointerCapture(session.pointerId)) {
        session.element.releasePointerCapture(session.pointerId);
      }
    } catch {
      /* The pointer is already gone; nothing to release. */
    }

    configRef.current.interaction.dragging = false;
    setGhost(null);

    if (commit && session.armed) {
      configRef.current.interaction.suppressClick = true;
      // Released in case the pointer came up outside the block, so the flag can
      // never swallow the user's next tap.
      window.setTimeout(() => {
        configRef.current.interaction.suppressClick = false;
      }, 400);
      configRef.current.onDrop(session.item, session.target);
    }
  }, []);

  // A drag in flight must not outlive the grid that owns it.
  useEffect(() => () => finish(false), [finish]);

  const begin = useCallback(
    (item: CalendarItem, event: ReactPointerEvent<HTMLButtonElement>, init: DragInit) => {
      const { interaction } = configRef.current;
      if (item.readonly || sessionRef.current) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;

      const session: DragSession = {
        item,
        init,
        axis: configRef.current.axis?.(init) ?? null,
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        element: event.currentTarget,
        startX: event.clientX,
        startY: event.clientY,
        armed: false,
        timer: null,
        target: { dayDelta: 0, startMinute: init.startMinute },
        listeners: {
          move: () => undefined,
          up: () => undefined,
          cancel: () => undefined,
          keydown: () => undefined,
        },
      };

      const arm = () => {
        if (sessionRef.current !== session || session.armed) return;
        session.armed = true;
        interaction.dragging = true;
        try {
          session.element.setPointerCapture(session.pointerId);
        } catch {
          /* Best effort: the window listeners keep tracking either way. */
        }
        setGhost(buildGhost(session, session.startX, session.startY, configRef.current));
      };

      const move = (pointer: PointerEvent) => {
        if (sessionRef.current !== session) return;
        const dx = pointer.clientX - session.startX;
        const dy = pointer.clientY - session.startY;

        if (!session.armed) {
          const travelled = Math.hypot(dx, dy);
          if (session.pointerType === 'mouse') {
            if (travelled > MOUSE_DRAG_SLOP_PX) arm();
          } else if (travelled > PRESS_SLOP_PX) {
            // A finger that moved this far is scrolling the grid, not lifting.
            finish(false);
            return;
          }
        }
        if (!session.armed) return;

        const bounds = configRef.current.boundsRef ?? configRef.current.gridRef;
        const gridRect = bounds.current?.getBoundingClientRect() ?? null;
        if (gridRect) {
          const outside =
            pointer.clientX < gridRect.left ||
            pointer.clientX > gridRect.right ||
            pointer.clientY < gridRect.top ||
            pointer.clientY > gridRect.bottom;
          if (outside) {
            finish(false);
            return;
          }
        }

        session.target = resolveTarget(session, dx, dy, configRef.current);
        pointer.preventDefault();
        setGhost(buildGhost(session, pointer.clientX, pointer.clientY, configRef.current));
      };

      session.listeners = {
        move,
        up: () => finish(true),
        cancel: () => finish(false),
        keydown: (keyboard: KeyboardEvent) => {
          if (keyboard.key === 'Escape') finish(false);
        },
      };

      window.addEventListener('pointermove', session.listeners.move);
      window.addEventListener('pointerup', session.listeners.up);
      window.addEventListener('pointercancel', session.listeners.cancel);
      window.addEventListener('keydown', session.listeners.keydown);
      session.timer = window.setTimeout(arm, LONG_PRESS_MS);
      sessionRef.current = session;
    },
    [finish],
  );

  return { ghost, begin };
}

/** Snapped, clamped target for the current pointer offset. */
function resolveTarget(session: DragSession, dx: number, dy: number, config: ItemDragConfig): RescheduleTarget {
  const dayDelta = session.axis ? dragToCellDelta(dx, dy, session.axis) : 0;
  if (config.hourHeight <= 0) return { dayDelta, startMinute: session.init.startMinute };

  return {
    dayDelta,
    startMinute: dragToStartMinute({
      startMinute: session.init.startMinute,
      deltaY: dy,
      hourHeight: config.hourHeight,
      durationMinutes: session.init.durationMinutes,
    }),
  };
}

/** Pixel offset that puts the lifted block exactly on its snapped target. */
function dragOffsets(
  session: DragSession,
  config: ItemDragConfig,
): { offsetX: number; offsetY: number } {
  let offsetX = 0;
  let offsetY = 0;

  if (session.axis && session.axis.columns > 0) {
    const { columns, cellWidth, rowHeight, index } = session.axis;
    const landed = index + session.target.dayDelta;
    offsetX = ((landed % columns) - (index % columns)) * cellWidth;
    offsetY = (Math.floor(landed / columns) - Math.floor(index / columns)) * rowHeight;
  }

  if (config.hourHeight > 0) {
    offsetY += minutesToPixels(session.target.startMinute - session.init.startMinute, config.hourHeight);
  }

  return { offsetX, offsetY };
}

function buildGhost(session: DragSession, clientX: number, clientY: number, config: ItemDragConfig): DragGhost {
  const { offsetX, offsetY } = dragOffsets(session, config);

  return {
    item: session.item,
    target: session.target,
    clientX,
    clientY,
    offsetX,
    offsetY,
    label: config.formatLabel(session.item, session.target),
  };
}
