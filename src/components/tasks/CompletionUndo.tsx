'use client';

/**
 * The completion Undo — a small control at the screen's left edge, not a toast.
 *
 * ## Why it is here and not on the row
 *
 * The natural place for this control is where the finger already is: the row's
 * leading checkbox on the left. That is where the user just tapped, and an
 * affordance there needs no reach at all. It cannot live there, though, because
 * completing a task *removes its row*: the Tasks list filters completed work out
 * optimistically (`visibleTasks`), so an in-row control would be unmounted in
 * the same commit that raised it. The Today agenda moves the row into a
 * different bucket. Either way the control would vanish under the thumb before
 * it could be used.
 *
 * So it is a screen-level control, anchored to the **left** edge — the same side
 * the checkbox column is on, so the eye that just watched the tick finds the
 * undo where that column was — and sitting in the band the toast used to occupy,
 * just above the bottom nav. On this one-handed phone screen that is the thumb's
 * resting zone, and it is deliberately *not* where the toast was centred: a
 * left-anchored 1.2s window reads as a small correction, not a banner.
 *
 * ## The 1.2s window is short, so the control is small and the timer is exact
 *
 * The window is the user's own 1.2s. That is only usable if the control is
 * legible at a glance and the timer is cleaned up: the timeout is cleared when
 * the control is dismissed, when the task changes and when the screen unmounts,
 * so it can never fire against a control that is already gone, and navigating
 * away takes the timer with the component.
 *
 * ## Assistive tech
 *
 * The wrapper is a polite live region, so the appearance is announced ("Task
 * completed."), and the button's own name carries the task title so an Undo is
 * never a bare "Undo" to a screen reader. Nothing here duplicates the toast's
 * old live region — there is no toast on this path any more.
 */
import { useEffect, useRef } from 'react';
import { Undo2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/** How long the control stays after a completion, in ms. */
export const COMPLETION_UNDO_MS = 1200;

export interface CompletionUndoTask {
  id: string;
  title: string;
}

export interface CompletionUndoProps {
  /** The task that was just completed; `null` hides the control. */
  task: CompletionUndoTask | null;
  /** Puts the task back. Called before `onDismiss`. */
  onUndo: () => void;
  /** Closes the window: the timer, the Undo tap, or a navigation. */
  onDismiss: () => void;
  className?: string;
}

export function CompletionUndo({ task, onUndo, onDismiss, className }: CompletionUndoProps) {
  /*
   * `onDismiss` is read through a ref so the timer effect can depend only on the
   * task. Callers pass it inline, and an inline callback is a new function every
   * render — depending on it would restart the 1.2s countdown on every render
   * and the control would outlive its window.
   */
  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  });

  useEffect(() => {
    if (!task) return;
    const timer = window.setTimeout(() => dismissRef.current(), COMPLETION_UNDO_MS);
    // Runs when the task changes, the user taps Undo, or the screen unmounts —
    // the one place the timer is cleared, so it cannot fire late.
    return () => window.clearTimeout(timer);
  }, [task]);

  if (!task) return null;

  return (
    <div
      aria-live="polite"
      className={cn(
        'fixed left-gutter bottom-[calc(env(safe-area-inset-bottom,0px)_+_5.5rem)] z-appbar',
        'animate-in fade-in duration-100',
        className,
      )}
    >
      <span className="sr-only">Task completed. </span>
      <button
        type="button"
        onClick={() => {
          onUndo();
          onDismiss();
        }}
        aria-label={`Undo completing ${task.title}`}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border bg-card px-2.5 py-1 text-xs font-medium text-foreground shadow-sm',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <Undo2 className="size-3.5" aria-hidden />
        Undo
      </button>
    </div>
  );
}
