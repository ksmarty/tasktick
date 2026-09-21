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
 * ## The colour: the app's own completion hue, not a second create button
 *
 * It used to be `bg-secondary`, which in Celestial Sapphire is a surface token —
 * `oklch(0.97 0 0)` in light mode and `oklch(0.269 0 0)` in dark. Those are the
 * *card* colours: a pale/near-white disc on a white page (1.09:1 against it) and
 * a dark grey one on a dark page (1.00:1). Measured, that is not a control at
 * all; it is the surface it sits on, which is exactly what "just grey and
 * doesn't stand out" was reporting.
 *
 * There is no spare accent hue to spend here. `--primary` is the action button
 * directly below (near-black, or the user's chosen accent), and `--destructive`
 * is the swipe row's *Delete* — an Undo painted red would read as a second
 * Delete. So the colour is `--chart-2`, which is already this app's completion
 * colour: the swipe action's **Complete** button is `bg-chart-2`, and the
 * pomodoro draws its completion check with `text-chart-2`. The control only ever
 * appears in the middle of the completion flow, so wearing the colour the app
 * already uses for "done" ties it to the action it reverses — "about the tick you
 * just made, tap to take it back" — rather than to the create button above it.
 * The two discs are also told apart by hue in both themes: light is teal
 * `#009689` against near-black primary, dark is green `#00bc7d` against
 * near-white primary. The hue does not move with the accent preference either,
 * so it keeps saying the same thing whatever the user has themed `--primary` to.
 * (The one place it gets close is an accent of teal or green, where the pair
 * becomes a hue-family pair — which is the relationship the swipe Complete
 * button already has with those accents.)
 *
 * The glyph is `text-background`, which is the *polarity-correct* ink rather
 * than a hard-coded white: measured contrast of the glyph on the disc is
 * **3.66:1 in light mode** (white on `#009689`) and **8.03:1 in dark** (`#0a0a0a`
 * on `#00bc7d`). Both clear the 3:1 a 24px icon needs; a hard-coded `text-white`
 * (the swipe button's own choice) would have been 2.46:1 in dark mode.
 *
 * ## It arrives, it gets one pulse, it leaves the way it came
 *
 * The 2s window has three beats and each is stated once:
 *
 *  - **Entrance** — a spring from `scale 0.6`, 14px lower and transparent. Sampled
 *    frame by frame on the deployed build: 0.63 at 67ms, 0.85 at 101ms, through
 *    1.00 at ~156ms, a **1.023 peak at ~210ms**, settled by ~340ms. A ~2%
 *    overshoot is not a bounce anyone watches; it is what keeps the arrival from
 *    reading as a linear tween — and it costs 0.34s of a 2s window. It is an
 *    entrance, not a loop, so it says "here" once and then holds still.
 *  - **Dwell** — one halo ring, 4px outside the disc, expanding to ~1.5× and
 *    fading out over half a second, 0.26s after the entrance so it reads as the
 *    arrival's own ripple rather than a second event. Once, then still.
 *  - **Exit** — the entrance run backwards: down, smaller, transparent, on a
 *    short ease-in. `AnimatePresence` is what keeps it on screen for those
 *    160ms, since the parent clears the task the moment the timer fires or the
 *    Undo is tapped.
 *
 * A press dips the whole stack (`whileTap`, scale 0.9) so the tap has its own
 * feedback even though the control leaves immediately.
 *
 * **All of it is gated on the app's own motion preference**, not the OS query:
 * `useReducedMotion` from `@/lib/motion` folds in the in-app setting and the Low
 * Power Mode inference as well as the media query. Under it the disc is simply
 * *there* — `initial={false}`, a zero-duration exit, no halo and no press dip —
 * so the control is completely static and the 2s window is unchanged.
 *
 * ## Assistive tech
 *
 * The wrapper is a polite live region, so the appearance is announced ("Task
 * completed."), and the button's own name carries the task title so an Undo is
 * never a bare "Undo" to a screen reader. Nothing here duplicates the toast's
 * old live region — there is no toast on this path any more.
 */
import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ResetIcon } from '@svg-animated-icons/react/reset';
import { useReducedMotion } from '@/lib/motion';
import { cn } from '@/lib/utils';

/** How long the control stays after a completion, in ms. */
export const COMPLETION_UNDO_MS = 2000;

/**
 * How far below its resting place the disc starts — and returns to on exit. It
 * comes up out of the tab bar's band, which is the direction the eye expects a
 * bottom-anchored control to arrive from.
 */
const UNDO_TRAVEL_PX = 14;

/**
 * The entrance spring. Stiff, so the disc is most of the way there in 100ms and
 * settled inside 350ms: measured peak 1.023 at ~210ms (see the file doc), which
 * is enough to stop the arrival reading as a tween and short enough that the
 * window it lives in is not spent animating.
 */
const UNDO_ENTRANCE = { type: 'spring', stiffness: 560, damping: 26, mass: 0.7 } as const;

/** How long the leave takes, in seconds — the entrance, mirrored. */
const UNDO_EXIT_SECONDS = 0.16;

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
   * render — depending on it would restart the 2s countdown on every render and
   * the control would outlive its window.
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

  const reduceMotion = useReducedMotion();

  return (
    /*
     * Keyed on the task, so a second completion inside the first one's window
     * replaces the disc (exit then entrance) instead of mutating it in place,
     * and so an Undo that brings the *same* task back is a fresh arrival.
     */
    <AnimatePresence>
      {task ? (
        <motion.div
          key={task.id}
          aria-live="polite"
          /*
           * Directly above the action button, sharing its right-hand gutter.
           *
           * It used to sit at the screen's left edge as a small pill, which put it
           * as far as possible from the thumb that had just ticked the task off. The
           * action button is the place a thumb already is, so the Undo stacks on it.
           * The `5.5rem` clears the band: the pill is 60px tall sitting 2px off the
           * bottom, so anything less would overlap it.
           */
          className={cn(
            'fixed right-gutter bottom-[calc(env(safe-area-inset-bottom,0px)_+_5.5rem)] z-appbar',
            className,
          )}
          initial={reduceMotion ? false : { opacity: 0, y: UNDO_TRAVEL_PX, scale: 0.6 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={
            reduceMotion
              ? { opacity: 0, transition: { duration: 0 } }
              : {
                  opacity: 0,
                  y: UNDO_TRAVEL_PX,
                  scale: 0.6,
                  transition: { duration: UNDO_EXIT_SECONDS, ease: 'easeIn' },
                }
          }
          transition={reduceMotion ? { duration: 0 } : UNDO_ENTRANCE}
          whileTap={reduceMotion ? undefined : { scale: 0.9 }}
        >
          <span className="sr-only">Task completed. </span>
          {/*
           * The dwell beat: one ring, 4px outside the disc, opening to ~1.5× and
           * gone in half a second. It is the only thing that moves after the
           * entrance, deliberately — an attention cue that repeats reads as a
           * nag on a control whose whole life is two seconds.
           *
           * Drawn *under* the button and out of the pointer's way: the button is
           * the only hit target, and the ring is decoration.
           */}
          {reduceMotion ? null : (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute -inset-1 rounded-full border-2 border-chart-2"
              initial={{ opacity: 0.7, scale: 1 }}
              animate={{ opacity: 0, scale: 1.5 }}
              transition={{ duration: 0.5, delay: 0.26, ease: 'easeOut' }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              onUndo();
              onDismiss();
            }}
            aria-label={`Undo completing ${task.title}`}
            className={cn(
              /*
               * The same 56px circle the action button is, so the pair reads as one
               * stack, but in the completion hue rather than `bg-primary` — see the
               * file doc for the measurement and the reasoning. No text: the
               * accessible name carries the task title, which is what a bare
               * "Undo" could not.
               */
              'inline-flex size-14 shrink-0 items-center justify-center rounded-full',
              'bg-chart-2 text-background shadow-lg',
              'outline-none focus-visible:ring-2 focus-visible:ring-ring',
            )}
          >
            {/*
             * The animated set's own revert glyph — an arrow that loops back on
             * itself, which spins counter-clockwise once on hover (see the icon
             * conventions). Sized in `em` because that is the vendored icon's own
             * API: `text-2xl` is the 24px the previous `size-6` lucide glyph was.
             */}
            <ResetIcon className="text-2xl" />
          </button>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
